import { HotShader, loadShaderModule } from "../../shaders/loadShader.ts";
  

export abstract class GPUNode {
    abstract stage: GPUNodeStage;
    static shaderPath: string;

    ready = false;
    shader!: HotShader;
    pipeline!: GPUPipelineBase;

    async init(device: GPUDevice, ctx: any) {
        this.ready = false;
        const slf = this.constructor as any;
        const shaderPath = slf.shaderPath;
        
        if (!shaderPath) {
            console.error("Shader path is required for GPU nodes");
            return;
        }

        this.shader = await loadShaderModule(device, shaderPath);

        this.pipeline = this.createPipeline(device, this.shader.module!);
    
        // call node-specific setup
        await this.onPipelineReady(device, ctx);
        this.ready = true;

        // Hot reload
        this.shader.onReload(async (module) => {
            this.ready = false;
            console.log(`🔥 Shader recompiled: ${shaderPath}`);
            this.pipeline = this.createPipeline(device, module);
            this.releaseResources();
            await this.onPipelineReady(device, ctx);
            this.ready = true;
        })
    }

    private releaseResources() {
        for (const resource of Object.values(this)) {
            if (typeof GPUBuffer !== "undefined" && resource instanceof GPUBuffer) resource.destroy();
            if (resource instanceof HotShader && resource !== this.shader) resource.dispose();
        }
    }

    dispose() {
        this.ready = false;
        this.releaseResources();
        this.shader?.dispose();
    }

    /** Must be implement: how to create the pipeline */
    abstract createPipeline(device: GPUDevice, module: GPUShaderModule): GPUPipelineBase;
    
    /** Called after pipeline is created (and after hot reload)
     * use this to create any resources that need to be created
     * after the pipeline is created, like param buffers, samplers, etc.
     */
    abstract onPipelineReady(device: GPUDevice, ctx: any): void | Promise<void>;

    /**
     * Override this for bindGroups + dispatch/draw
     * Return `false` to signal that no writes occurred and ping-pong buffers
     * should not be swapped after this node.
     */
    abstract record(encoder: GPUCommandEncoder, ctx: any): boolean | void;

    /**
     * Optional UI hook for nodes to expose tweakable parameters.
     * Receives a pane/folder-like object (Tweakpane API).
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    buildUI(_pane: any): void {
        // default: no controls
    }
}

export type GPUNodeStage = "compute" | "render";