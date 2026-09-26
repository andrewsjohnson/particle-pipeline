import { GPUComputeNode } from "./kinds/compute-node.ts";

/**
 * Sets the lifetime for particles when they spawn (age == 0).
 * Lifetime is randomized between minLifespan and maxLifespan.
 */
export class SetSpawnLifespanNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/setSpawnLifespan.wgsl";
  paramBuffer!: GPUBuffer;
  minLifespan: number = 1.0;
  maxLifespan: number = 5.0;

  buildUI(pane: any) {
    const p = pane as any;
    p.addBinding(this, "minLifespan", { label: "Min Lifespan", min: 0.1, max: 300 });
    p.addBinding(this, "maxLifespan", { label: "Max Lifespan", min: 0.1, max: 300 }).on("change", () => {
      if (this.maxLifespan < this.minLifespan) this.maxLifespan = this.minLifespan;
    });
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      label: "setSpawnLifespan.params",
      size: 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  updateParams(ctx: any) {
    const buf = new ArrayBuffer(4 * 4);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    f32[0] = this.minLifespan;
    f32[1] = this.maxLifespan;
    u32[2] = (ctx.randomSeed ?? 1) >>> 0;
    ctx.queue.writeBuffer(this.paramBuffer, 0, buf);
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    // Guard: skip if not initialized yet
    if (!this.paramBuffer || !this.pipeline) return false;

    this.updateParams(ctx);

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

