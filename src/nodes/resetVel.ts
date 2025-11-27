import { loadShaderModule } from "../shaders/loadShader.ts";
import { GPUNode, type GPUNodeStage } from "./base.ts";

export class ResetVelNode extends GPUNode {
  stage: GPUNodeStage = "compute";
  private pipeline!: GPUComputePipeline;
  private bindGroup!: GPUBindGroup;
  
  async init(device: GPUDevice, ctx: any) {
    const module = await loadShaderModule(device, "/src/shaders/resetVel.wgsl");

    this.pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    this.bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / 256));
    pass.end();
    return true;
  }
}
