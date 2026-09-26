import { GPUComputeNode } from "./kinds/compute-node.ts";

export class CurlNoiseNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/curl.wgsl";
  paramBuffer!: GPUBuffer;

  mode: "velocity" | "force" | "legacy" = "velocity";
  normalizeField = true;

  fieldScale: number = 0.6; // field scale
  strength: number = 0.25; // strength of the curl noise
  eps: number = 0.001; // epsilon value
  octaves: number = 8; // number of octaves
  lacunarity: number = 1.6; // frequency multiplier
  gain: number = 0.5; // amplitude multiplier

  buildUI(pane: any) {
    const p = pane as any;
    p.addBinding(this, "mode", { label: "Motion", options: { "Follow flow": "velocity", "Apply force": "force", "Legacy per-step": "legacy" } });
    p.addBinding(this, "normalizeField", { label: "Normalize field" });
    p.addBinding(this, "fieldScale", { label: "Field Scale", min: 0, max: 5 });
    p.addBinding(this, "strength", { label: "Strength", min: 0, max: 5 });
    p.addBinding(this, "eps", { label: "Epsilon", min: 0.000001, max: 1.0 });
    p.addBinding(this, "octaves", { label: "Octaves", min: 1, max: 12, step: 1 });
    p.addBinding(this, "lacunarity", { label: "Lacunarity", min: 0.5, max: 4 });
    p.addBinding(this, "gain", { label: "Gain", min: 0, max: 2 });
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      label: "curlNoise.params",
      size: 4 * 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }  
  
  updateParams(ctx: any) {
    if (!this.paramBuffer) {
      console.warn("CurlNoiseNode params buffer not ready; skipping frame.");
      return false;
    }
    const buf = new ArrayBuffer(4 * 16);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    f32[0] = ctx.deltaTime;
    f32[1] = this.fieldScale;
    f32[2] = this.strength;
    f32[3] = this.eps;
    f32[4] = this.octaves;
    f32[5] = this.lacunarity;
    f32[6] = this.gain;
    u32[7] = this.mode === "velocity" ? 0 : this.mode === "force" ? 1 : 2;
    u32[9] = this.normalizeField ? 1 : 0;
    u32[8] = (ctx.randomSeed ?? 1) >>> 0;
    ctx.queue.writeBuffer(this.paramBuffer, 0, buf);
    return true;
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    if (!this.paramBuffer) {
      console.warn("CurlNoiseNode not initialized; skipping frame.");
      return false;
    }
    if (this.updateParams(ctx) === false) {
      return false;
    }

    const bindGroup = this.bindGroup(ctx.device, this.pipeline, [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
        { binding: 2, resource: { buffer: this.paramBuffer } },
      ]);

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / 256));
    pass.end();
    return true;
  }
}
