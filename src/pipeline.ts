import { GPUNode } from "./nodes/kinds/base.ts";
import type { GPUComputeNode } from "./nodes/kinds/compute-node.ts";
import type { GPURenderNode } from "./nodes/kinds/render-node.ts";
import { PARTICLE_SIZE } from "./particles/particleLayout.ts";

interface PipelineOptions {
    particleCount: number;
    renderWidth: number;
    renderHeight: number;
    particleTextureFormat: GPUTextureFormat;
}

export class Pipeline {
    device: GPUDevice;
    ctx: GPUCanvasContext;
    computeNodes: GPUComputeNode[] = [];
    renderNodes: GPURenderNode[] = [];

    particleCount: number;
    particleA!: GPUBuffer;
    particleB!: GPUBuffer;

    renderTexture!: GPUTexture;
    renderTextureView!: GPUTextureView;
    renderTextureFormat: GPUTextureFormat;
    renderTextureWidth: number;
    renderTextureHeight: number;

    baseOpacity: number;
    randomSeed: number;

    frameIndex = 0;
    private nodeListeners: Array<() => void> = [];
    private initialized = false;

    get currentParticleBuffer() {
        return this.particleA;
    }

    constructor(device: GPUDevice, ctx: GPUCanvasContext, opts: PipelineOptions) {
        this.device = device;
        this.ctx = ctx;
        this.particleCount = opts.particleCount;
        this.baseOpacity = 0.0002;
        this.renderTextureFormat = opts.particleTextureFormat;
        // The accumulation target renders at 2x resolution for better quality
        this.renderTextureWidth = opts.renderWidth * 2;
        this.renderTextureHeight = opts.renderHeight * 2;
        // Seed all random-dependent nodes; default to start time for deterministic runs.
        this.randomSeed = (Date.now() >>> 0) || 1;
        
        // Persistent offscreen float texture (accumulation)
        this.renderTexture = device.createTexture({
            size: { width: this.renderTextureWidth, height: this.renderTextureHeight },
            format: this.renderTextureFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
            sampleCount: 1,
        });

        // This view stays constant - we DO NOT recreate it each frame
        this.renderTextureView = this.renderTexture.createView();
    }

    addNode(node: GPUNode) {
        if (node.stage === "compute") {
            this.computeNodes.push(node as GPUComputeNode);
        } else if (node.stage === "render") {
            this.renderNodes.push(node as GPURenderNode);
        }
        this._emitNodesChanged();
    }

    async addNodeAndInit(node: GPUNode) {
        this.addNode(node);
        if (this.initialized) {
            await node.init(this.device, this._contextStatic());
        }
    }

    removeNode(node: GPUNode) {
        if (node.stage === "compute") {
            this.computeNodes = this.computeNodes.filter((n) => n !== node);
        } else if (node.stage === "render") {
            this.renderNodes = this.renderNodes.filter((n) => n !== node);
        }
        this._emitNodesChanged();
    }

    moveNode(node: GPUNode, direction: number) {
        const arr = node.stage === "compute" ? this.computeNodes : this.renderNodes;
        const idx = arr.indexOf(node as any);
        if (idx < 0) return;
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= arr.length) return;
        [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
        this._emitNodesChanged();
    }

    /**
     * Replace the current compute/render node lists with new ones.
     * If the pipeline was already initialized, the new nodes are initialized immediately.
     * Emits a nodes-changed event and resets accumulation frame index.
     */
    async setNodes(computeNodes: GPUComputeNode[], renderNodes: GPURenderNode[]) {
        // Init first so the currently running frame continues using the old nodes
        // until the new ones are fully ready. This avoids transient undefined buffers.
        if (this.initialized) {
            const ctx = this._contextStatic();
            for (const node of [...computeNodes, ...renderNodes]) {
                await node.init(this.device, ctx);
            }
        }

        this.computeNodes = computeNodes;
        this.renderNodes = renderNodes;

        if (this.initialized) {
            // Start accumulation over after topology/params change
            this.frameIndex = 0;
        }
        this._emitNodesChanged();
    }

    onNodesChanged(cb: () => void) {
        this.nodeListeners.push(cb);
    }

    async init() {
        const bufferSize = this.particleCount * PARTICLE_SIZE;

        this.particleA = this.device.createBuffer({
            label: "pipeline.particles.a",
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        this.particleB = this.device.createBuffer({
            label: "pipeline.particles.b",
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });

        for (const node of this.computeNodes) {
            await node.init(this.device, this._contextStatic());
        }
        for (const node of this.renderNodes) {
            await node.init(this.device, this._contextStatic());
        }
        this.initialized = true;
    }

    /**
     * Static context used during init().
     * Anything related to the swapchain belongs in the dynamic context.
     */
    private _contextStatic() {
        return {
            device: this.device,
            queue: this.device.queue,
            particleSrc: this.particleA,
            particleDst: this.particleB,
            particleCount: this.particleCount,
            particleRenderTexture: this.renderTextureView,
            frameIndex: this.frameIndex,
            deltaTime: 0,
            randomSeed: this.randomSeed,
        };
    }

    /**
     * Dynamic per-frame context.
     * Canvas view MUST be refreshed every frame, because GPUTexture returned from canvas is transient.
     */
    private _contextFrame(dt: number) {
        return {
            device: this.device,
            queue: this.device.queue,
            particleSrc: this.particleA,
            particleDst: this.particleB,
            particleCount: this.particleCount,
            renderWidth: this.ctx.canvas.width,
            renderHeight: this.ctx.canvas.height,
            baseOpacity: this.baseOpacity,

            // Persistent offscreen HDR accumulation texture
            particleRenderTarget: this.renderTextureView,

            // UPDATED EVERY FRAME
            canvasView: this.ctx.getCurrentTexture().createView(),

            frameIndex: this.frameIndex,
            deltaTime: dt,
            randomSeed: this.randomSeed,
        };
    }

    frame(dt: number) {
        const encoder = this.device.createCommandEncoder();
        const ctx = this._contextFrame(dt);
    
        // 1. compute nodes
        for (const node of this.computeNodes) {
            const didWrite = node.record(encoder, ctx);
            if (didWrite === false) {
                continue;
            }
            // 2. swap after each compute step that produced output
            [this.particleA, this.particleB] = [this.particleB, this.particleA];
            ctx.particleSrc = this.particleA;
            ctx.particleDst = this.particleB;
        }
    
        // 3. render nodes
        for (const node of this.renderNodes) {
            node.record(encoder, ctx);
        }
    
        this.device.queue.submit([encoder.finish()]);
        this.frameIndex++;
    }

    /**
     * Resize the HDR accumulation target to match a new render size (canvas size).
     * Also resets the accumulation frameIndex so the next frame clears properly.
     */
    resizeRenderTarget(renderWidth: number, renderHeight: number) {
        const targetWidth = renderWidth * 2;
        const targetHeight = renderHeight * 2;

        const sameSize =
            targetWidth === this.renderTextureWidth &&
            targetHeight === this.renderTextureHeight;
        if (sameSize) return;

        try { this.renderTexture?.destroy?.(); } catch (err) { console.warn(err); }

        this.renderTextureWidth = targetWidth;
        this.renderTextureHeight = targetHeight;

        this.renderTexture = this.device.createTexture({
            size: { width: targetWidth, height: targetHeight },
            format: this.renderTextureFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
            sampleCount: 1,
        });
        this.renderTextureView = this.renderTexture.createView();

        // Reset accumulation since dimensions changed
        this.frameIndex = 0;
    }

    /** Recreate particle buffers and restart frame counter (does not touch node params/UI). */
    resetSimulation() {
        const bufferSize = this.particleCount * PARTICLE_SIZE;
        try { this.particleA?.destroy?.(); } catch (err) { console.warn(err); }
        try { this.particleB?.destroy?.(); } catch (err) { console.warn(err); }

        this.particleA = this.device.createBuffer({
            label: "pipeline.particles.a",
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        this.particleB = this.device.createBuffer({
            label: "pipeline.particles.b",
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });

        this.frameIndex = 0;
    }

    /** Change particle count, recreate buffers, and reset accumulation. */
    setParticleCount(count: number) {
        const clamped = Math.max(1, Math.floor(count));
        if (clamped === this.particleCount) return;
        this.particleCount = clamped;
        this.resetSimulation();
    }

    /** Update base opacity (alpha multiplier stored on particles) and restart accumulation. */
    setBaseOpacity(opacity: number) {
        const clamped = Math.max(0, opacity);
        this.baseOpacity = clamped;
        // Reset accumulation to avoid mixing states across opacity changes
        this.frameIndex = 0;
    }

    /** Set global random seed used by all stochastic nodes and restart simulation. */
    setRandomSeed(seed?: number) {
        const next = (seed ?? Date.now()) >>> 0;
        // Avoid zero seed to keep xor/shift RNGs from degenerating.
        this.randomSeed = next === 0 ? 1 : next;
        this.resetSimulation();
    }

    private _emitNodesChanged() {
        for (const cb of this.nodeListeners) {
            try {
                cb();
            } catch (err) {
                console.error("node listener error", err);
            }
        }
    }

    /**
     * Read back the HDR accumulation texture as a tightly-packed Float32Array.
     * Returns width/height plus RGBA float data in row-major order.
     */
    async readHDRTexture() {
        const width = this.renderTextureWidth;
        const height = this.renderTextureHeight;
        const bytesPerPixel = 16; // rgba32float
        const unpaddedBytesPerRow = width * bytesPerPixel;
        const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
        const paddedSize = paddedBytesPerRow * height;

        const readBuffer = this.device.createBuffer({
            label: "pipeline.readHDR.readback",
            size: paddedSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const encoder = this.device.createCommandEncoder();
        encoder.copyTextureToBuffer(
            { texture: this.renderTexture },
            {
                buffer: readBuffer,
                bytesPerRow: paddedBytesPerRow,
                rowsPerImage: height,
            },
            { width, height, depthOrArrayLayers: 1 }
        );
        this.device.queue.submit([encoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const mapped = readBuffer.getMappedRange();

        const floats = new Float32Array(width * height * 4);
        const mappedBytes = new Uint8Array(mapped);

        for (let y = 0; y < height; y++) {
            const rowOffset = y * paddedBytesPerRow;
            const row = mappedBytes.slice(rowOffset, rowOffset + unpaddedBytesPerRow);
            const rowFloats = new Float32Array(row.buffer);
            floats.set(rowFloats, y * width * 4);
        }

        readBuffer.unmap();
        readBuffer.destroy();

        return { width, height, data: floats };
    }
}