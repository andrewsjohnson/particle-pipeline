import { GPUComputeNode } from "./kinds/compute-node";

export class CurlNoiseNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/curl.wgsl";
  paramBuffer!: GPUBuffer;

  fieldScale: number = 1.0;
  strength: number = 0.5;
  eps: number = 1.2;

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      size: 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }  
  
  updateParams(ctx: any) {
    const params = new Float32Array([
      ctx.deltaTime,
      this.fieldScale,
      this.strength,
      this.eps,
    ]);
    ctx.queue.writeBuffer(this.paramBuffer, 0, params);
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
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
