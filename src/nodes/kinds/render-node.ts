import { GPUNode, type GPUNodeStage } from "./base.ts";

export abstract class GPURenderNode extends GPUNode {
    /** Settings whose changes invalidate previously accumulated pixels. */
    imageSignature(): string { return ""; }
    /** Presentation nodes run once per display refresh, without adding samples. */
    presentationOnly = false;
    declare pipeline: GPURenderPipeline;
    stage: GPUNodeStage = "render";
    static shaderPath: string;

    abstract createRenderPipeline(
        device: GPUDevice,
        module: GPUShaderModule
    ): GPURenderPipeline;

    createPipeline(device: GPUDevice, module: GPUShaderModule): GPURenderPipeline {
        return this.createRenderPipeline(device, module);
    };
};