import { GPUComputeNode } from "./kinds/compute-node.ts";

export class ResetVelNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/resetVel.wgsl";

  onPipelineReady(_device: GPUDevice, _ctx: any) {}

  record(encoder: GPUCommandEncoder, ctx: any) {
    // Guard: skip if not initialized yet or on first frame
    if (!this.pipeline || ctx.frameIndex === 0) return false;

    const bindGroup = this.bindGroup(ctx.device, this.pipeline, [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
      ]);

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / 256));
    pass.end();
    return true;
  }
}
