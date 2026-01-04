import { GPUComputeNode } from "./kinds/compute-node.ts";

export class InitializeParticlesNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/initializeParticles.wgsl";

  paramBuffer!: GPUBuffer;

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      label: "initializeParticles.params",
      size: 4 * 8, // 32 bytes (aligned for uniform min size)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  updateParams(ctx: any) {
    const params = new Float32Array([
      ctx.baseOpacity,
      0,
      0,
      0,
      // padding to satisfy 32-byte uniform minimum
      0,
      0,
      0,
      0,
    ]);
    ctx.queue.writeBuffer(this.paramBuffer, 0, params);
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    // Guard: skip if not initialized yet or not first frame
    if (!this.paramBuffer || !this.pipeline || ctx.frameIndex !== 0) return false;

    this.updateParams(ctx);

    const bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
        { binding: 2, resource: { buffer: this.paramBuffer } },
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
