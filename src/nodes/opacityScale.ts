import { GPUComputeNode } from "./kinds/compute-node";

export class OpacityScaleNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/opacityScale.wgsl";
  paramBuffer!: GPUBuffer;

  fadeInTime: number = 10.0; // seconds to reach full opacity
  power: number = 2.0; // curve shaping exponent (1 = linear)

  buildUI(pane: any) {
    const p = pane as any;
    p.addBinding(this, "fadeInTime", { label: "Fade In (s)", min: 0, max: 30 });
    p.addBinding(this, "power", { label: "Power", min: 0.5, max: 8 });
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      size: 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  updateParams(ctx: any) {
    const params = new Float32Array([
      this.fadeInTime,
      this.power,
      0,
      0,
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

