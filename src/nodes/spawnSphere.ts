import { GPUComputeNode } from "./kinds/compute-node.ts";

export class SpawnSphereNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/spawnSphere.wgsl";
  paramBuffer!: GPUBuffer;

  origin: [number, number, number] = [0, 0, 0];
  radius: number = 1.0;
  baseOpacity: number = 0.0002;
  centerWeight: number = 0.75;

  buildUI(pane: any) {
    const p = pane as any;
    const originObj = { x: this.origin[0], y: this.origin[1], z: this.origin[2] };
    p.addBinding(originObj, "x", { label: "Origin X", min: -10, max: 10 }).on("change", (ev: any) => this.origin[0] = ev.value);
    p.addBinding(originObj, "y", { label: "Origin Y", min: -10, max: 10 }).on("change", (ev: any) => this.origin[1] = ev.value);
    p.addBinding(originObj, "z", { label: "Origin Z", min: -10, max: 10 }).on("change", (ev: any) => this.origin[2] = ev.value);
    p.addBinding(this, "radius", { label: "Radius", min: 0.01, max: 10 });
    p.addBinding(this, "centerWeight", {
      label: "Center Weight",
      min: 0.1,
      max: 4.0,
      step: 0.05,
    });
  }

  updateParams(ctx: any) {
    const params = new Float32Array([
      this.origin[0],
      this.origin[1],
      this.origin[2],
      this.radius,
      this.baseOpacity,
      this.centerWeight,
      // padding to satisfy alignment before next vec3/vec4 fields
      0,
      0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      // extra padding to satisfy 80-byte uniform minimum (20 floats)
      0, 0, 0, 0,
    ]);
    ctx.queue.writeBuffer(this.paramBuffer, 0, params);
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      size: 4 * 20, // 80 bytes (align to min uniform binding size)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    this.baseOpacity = ctx.baseOpacity;
    this.updateParams(ctx);

    const bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: ctx.particleSrc },
        },
        {
          binding: 1,
          resource: { buffer: ctx.particleDst },
        },
        {
          binding: 2,
          resource: { buffer: this.paramBuffer },
        },
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
