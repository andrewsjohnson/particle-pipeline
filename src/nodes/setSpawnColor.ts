import { GPUComputeNode } from "./kinds/compute-node.ts";

export class SetSpawnColorNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/setSpawnColor.wgsl";
  paramBuffer!: GPUBuffer;

  saturation: number = 1.0;
  offset: number = 0.0;
  scale: number = 1.0;
  a: [number, number, number] = [0.5, 0.5, 0.5];
  b: [number, number, number] = [0.5, 0.5, 0.5];
  c: [number, number, number] = [1.0, 1.0, 1.0];
  d: [number, number, number] = [0.0, 0.1, 0.2];

  buildUI(pane: any) {
    const p = pane as any;
    p.addBinding(this, "saturation", { label: "Saturation", min: 0, max: 2 });
    p.addBinding(this, "offset", { label: "Offset", min: -2, max: 2 });
    p.addBinding(this, "scale", { label: "Scale", min: 0, max: 4 });

    const bindVec3 = (label: string, target: [number, number, number]) => {
      const obj = { vec: { x: target[0], y: target[1], z: target[2] } };
      p.addBinding(obj, "vec", {
        label,
        x: { min: -2, max: 2 },
        y: { min: -2, max: 2 },
        z: { min: -2, max: 2 },
      }).on("change", (ev: any) => {
        target[0] = ev.value.x;
        target[1] = ev.value.y;
        target[2] = ev.value.z;
      });
    };

    bindVec3("A", this.a);
    bindVec3("B", this.b);
    bindVec3("C", this.c);
    bindVec3("D", this.d);
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      label: "setSpawnColor.params",
      size: 4 * 4 * 5,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  updateParams(ctx: any) {
    const params = new Float32Array([
      this.saturation,
      this.offset,
      this.scale,
      0,
      this.a[0], this.a[1], this.a[2], 0,
      this.b[0], this.b[1], this.b[2], 0,
      this.c[0], this.c[1], this.c[2], 0,
      this.d[0], this.d[1], this.d[2], 0,
    ]);
    ctx.queue.writeBuffer(this.paramBuffer, 0, params);
  }

  // Record the node, this is called every frame.
  record(encoder: GPUCommandEncoder, ctx: any) {
    // Guard: skip if not initialized yet
    if (!this.paramBuffer || !this.pipeline) return false;

    this.updateParams(ctx);

    // Create bind group
    // Bind source and destination buffers, and uniforms buffer (if needed)
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
