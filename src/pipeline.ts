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
        this.renderTextureFormat = opts.particleTextureFormat;
        // The accumulation target renders at 2x resolution for better quality
        this.renderTextureWidth = opts.renderWidth * 2;
        this.renderTextureHeight = opts.renderHeight * 2;
        
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

    onNodesChanged(cb: () => void) {
        this.nodeListeners.push(cb);
    }

    async init() {
        const bufferSize = this.particleCount * PARTICLE_SIZE;

        this.particleA = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        this.particleB = this.device.createBuffer({
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

            // Persistent offscreen HDR accumulation texture
            particleRenderTarget: this.renderTextureView,

            // UPDATED EVERY FRAME
            canvasView: this.ctx.getCurrentTexture().createView(),

            frameIndex: this.frameIndex,
            deltaTime: dt,
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

    /** Recreate particle buffers and restart frame counter (does not touch node params/UI). */
    resetSimulation() {
        const bufferSize = this.particleCount * PARTICLE_SIZE;
        try { this.particleA?.destroy?.(); } catch (err) { console.warn(err); }
        try { this.particleB?.destroy?.(); } catch (err) { console.warn(err); }

        this.particleA = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        this.particleB = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });

        this.frameIndex = 0;
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