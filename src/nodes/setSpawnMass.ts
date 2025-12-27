import { GPUComputeNode } from "./kinds/compute-node.ts";

export class SetSpawnMassNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/setSpawnMass.wgsl";
  paramBuffer!: GPUBuffer;
  minMass: number = 0.1;
  maxMass: number = 1.0;

  buildUI(pane: any) {
    const p = pane as any;
    p.addBinding(this, "minMass", { label: "Min Mass", min: 0, max: 10 });
    p.addBinding(this, "maxMass", { label: "Max Mass", min: 0, max: 10 }).on("change", () => {
      if (this.maxMass < this.minMass) this.maxMass = this.minMass;
    });
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      size: 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  updateParams(ctx: any) {
    const buf = new ArrayBuffer(4 * 4);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    f32[0] = this.minMass;
    f32[1] = this.maxMass;
    u32[2] = (ctx.randomSeed ?? 1) >>> 0;
    ctx.queue.writeBuffer(this.paramBuffer, 0, buf);
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
