import { GPUNode, type GPUNodeStage } from "./base";

export abstract class GPURenderNode extends GPUNode {
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