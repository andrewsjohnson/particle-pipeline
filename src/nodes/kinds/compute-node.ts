import { GPUNode, type GPUNodeStage } from "./base.ts";

export abstract class GPUComputeNode extends GPUNode {
    declare pipeline: GPUComputePipeline;
    stage: GPUNodeStage = "compute";   
    static shaderPath: string;

    createPipeline(
        device: GPUDevice, 
        module: GPUShaderModule
    ) {
        return device.createComputePipeline({
            layout: "auto",
            compute: { module, entryPoint: "main" },
        });
    };
};