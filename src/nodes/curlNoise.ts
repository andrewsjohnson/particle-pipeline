import { GPUComputeNode } from "./kinds/compute-node";

export class CurlNoiseNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/curl.wgsl";
  paramBuffer!: GPUBuffer;

  fieldScale: number = 0.6; // field scale
  strength: number = 0.25; // strength of the curl noise
  eps: number = 0.00001; // epsilon value
  octaves: number = 8; // number of octaves
  lacunarity: number = 1.6; // frequency multiplier
  gain: number = 0.5; // amplitude multiplier

  buildUI(pane: any) {
    const p = pane as any;
    p.addBinding(this, "fieldScale", { label: "Field Scale", min: 0, max: 5 });
    p.addBinding(this, "strength", { label: "Strength", min: 0, max: 5 });
    p.addBinding(this, "eps", { label: "Epsilon", min: 0.000001, max: 1.0 });
    p.addBinding(this, "octaves", { label: "Octaves", min: 1, max: 12, step: 1 });
    p.addBinding(this, "lacunarity", { label: "Lacunarity", min: 0.5, max: 4 });
    p.addBinding(this, "gain", { label: "Gain", min: 0, max: 2 });
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      size: 4 * 8,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }  
  
  updateParams(ctx: any) {
    const params = new Float32Array([
      ctx.deltaTime,
      this.fieldScale,
      this.strength,
      this.eps,
      this.octaves,
      this.lacunarity,
      this.gain,
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
