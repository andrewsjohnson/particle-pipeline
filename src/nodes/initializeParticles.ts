import { GPUComputeNode } from "./kinds/compute-node.ts";

export class InitializeParticlesNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/initializeParticles.wgsl";

  onPipelineReady(_device: GPUDevice, _ctx: any) {}

  record(encoder: GPUCommandEncoder, ctx: any) {
    if (ctx.frameIndex !== 0) return false;

    const bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / 256));
    pass.end();
    return true;
  }
}
