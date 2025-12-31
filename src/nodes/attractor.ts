import { GPUComputeNode } from "./kinds/compute-node.ts";

/**
 * Pulls particles toward an origin when they are beyond a chosen radius.
 * If inside the radius, no force is applied.
 */
export class AttractorNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/attractor.wgsl";

  origin: [number, number, number] = [0, 0, 0];
  maxRadius = 6.0;
  strength = 4.0;
  maxForce = 25.0;

  paramBuffer!: GPUBuffer;

  buildUI(pane: any) {
    const p = pane as any;
    const originObj = { x: this.origin[0], y: this.origin[1], z: this.origin[2] };
    p.addBinding(originObj, "x", { label: "Origin X", min: -20, max: 20 }).on("change", (ev: any) => this.origin[0] = ev.value);
    p.addBinding(originObj, "y", { label: "Origin Y", min: -20, max: 20 }).on("change", (ev: any) => this.origin[1] = ev.value);
    p.addBinding(originObj, "z", { label: "Origin Z", min: -20, max: 20 }).on("change", (ev: any) => this.origin[2] = ev.value);
    p.addBinding(this, "maxRadius", { label: "Radius", min: 0.1, max: 50 });
    p.addBinding(this, "strength", { label: "Strength", min: 0, max: 50 });
    p.addBinding(this, "maxForce", { label: "Max Force", min: 0, max: 200 });
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    try { this.paramBuffer?.destroy?.(); } catch (_e) {}
    this.paramBuffer = device.createBuffer({
      label: "attractor.params",
      size: 4 * 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private updateParams(ctx: any) {
    if (!this.paramBuffer) return false;
    const buf = new ArrayBuffer(4 * 16);
    const f32 = new Float32Array(buf);
    f32[0] = ctx.deltaTime;
    f32[1] = this.strength;
    f32[2] = this.maxRadius;
    f32[3] = this.maxForce;
    f32[4] = this.origin[0];
    f32[5] = this.origin[1];
    f32[6] = this.origin[2];
    f32[7] = 0;
    ctx.queue.writeBuffer(this.paramBuffer, 0, buf);
    return true;
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    if (!this.paramBuffer) {
      console.warn("AttractorNode not initialized; skipping frame.");
      return false;
    }
    if (this.updateParams(ctx) === false) return false;

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

