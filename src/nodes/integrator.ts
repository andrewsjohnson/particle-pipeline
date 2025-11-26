import { GPUNode } from "./base.ts";

export class IntegratorNode extends GPUNode {
  private pipeline!: GPUComputePipeline;
  private bindGroup!: GPUBindGroup;
  private paramsBuffer!: GPUBuffer;

  async init(device: GPUDevice, ctx: any) {
    const module = device.createShaderModule({
      code: await fetch("/src/shaders/integrator.wgsl").then(r => r.text()),
    });

    this.paramsBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    if (ctx.frameIndex === 0) return;
    const dt = new Float32Array([ctx.deltaTime]);
    ctx.queue.writeBuffer(this.paramsBuffer, 0, dt);

    this.bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
        { binding: 2, resource: { buffer: this.paramsBuffer } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / 256));
    pass.end();
  }
}
