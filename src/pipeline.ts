import { GPUNode } from "./nodes/base.ts";

interface PipelineOptions {
    particleCount: number;
    renderWidth: number;
    renderHeight: number;
    particleTextureFormat: GPUTextureFormat;
}

// Particle layout must be 16-byte aligned per vec3
const PARTICLE_SIZE = 16 + 16 + 16 + 4 + 4 + 4 + 4; // Rough size per particle

export class Pipeline {
    device: GPUDevice;
    ctx: GPUCanvasContext;
    computeNodes: GPUNode[] = [];
    renderNodes: GPUNode[] = [];

    particleCount: number;
    particleA!: GPUBuffer;
    particleB!: GPUBuffer;

    renderTexture!: GPUTexture;
    renderTextureView!: GPUTextureView;

    frameIndex = 0;

    get currentParticleBuffer() {
        return this.particleA;
    }

    constructor(device: GPUDevice, ctx: GPUCanvasContext, opts: PipelineOptions) {
        this.device = device;
        this.ctx = ctx;
        this.particleCount = opts.particleCount;
        
        // Persistent offscreen float texture (accumulation)
        this.renderTexture = device.createTexture({
            size: { width: opts.renderWidth * 2, height: opts.renderHeight * 2 },
            format: opts.particleTextureFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
            sampleCount: 1,
        });

        // This view stays constant - we DO NOT recreate it each frame
        this.renderTextureView = this.renderTexture.createView();
    }

    addNode(node: GPUNode) {
        if (node.stage === "compute") {
            this.computeNodes.push(node);
        } else if (node.stage === "render") {
            this.renderNodes.push(node);
        }
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
}