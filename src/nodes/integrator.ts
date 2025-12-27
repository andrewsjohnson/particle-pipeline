import { GPUComputeNode } from "./kinds/compute-node.ts";

export class IntegratorNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/integrator.wgsl";
  paramBuffer!: GPUBuffer;

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      label: "integrator.params",
      size: 4 * 1,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  updateParams(ctx: any) {
    const params = new Float32Array([ctx.deltaTime]);
    ctx.queue.writeBuffer(this.paramBuffer, 0, params);
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    if (ctx.frameIndex === 0) return false;

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
