import { HotShader, loadShaderModule } from "../../shaders/loadShader";
  

export abstract class GPUNode {
    abstract stage: GPUNodeStage;
    static shaderPath: string;

    shader!: HotShader;
    pipeline!: GPUPipelineBase;

    async init(device: GPUDevice, ctx: any) {
        const slf = this.constructor as any;
        const shaderPath = slf.shaderPath;
        
        if (!shaderPath) {
            console.error("Shader path is required for GPU nodes");
            return;
        }

        this.shader = await loadShaderModule(device, shaderPath);

        this.pipeline = this.createPipeline(device, this.shader.module!);
    
        // call node-specific setup
        this.onPipelineReady(device, ctx);

        // Hot reload
        this.shader.onReload((module) => {
            console.log(`🔥 Shader recompiled: ${shaderPath}`);
            this.pipeline = this.createPipeline(device, module);
            this.onPipelineReady(device, ctx);
        })
    }

    /** Must be implement: how to create the pipeline */
    abstract createPipeline(device: GPUDevice, module: GPUShaderModule): GPUPipelineBase;
    
    /** Called after pipeline is created (and after hot reload)
     * use this to create any resources that need to be created
     * after the pipeline is created, like param buffers, samplers, etc.
     */
    abstract onPipelineReady(device: GPUDevice, ctx: any): void;

    /**
     * Override this for bindGroups + dispatch/draw
     * Return `false` to signal that no writes occurred and ping-pong buffers
     * should not be swapped after this node.
     */
    abstract record(encoder: GPUCommandEncoder, ctx: any): boolean | void;
}

export type GPUNodeStage = "compute" | "render";