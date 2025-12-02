import { GPUComputeNode } from "./kinds/compute-node.ts";

export class SetSpawnColorNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/setSpawnColor.wgsl";
  paramBuffer!: GPUBuffer;

  saturation: number = 1.5;
  offset: number = 1.1;
  scale: number = 2.2;
  a: [number, number, number] = [0.5, 0.5, 0.5];
  b: [number, number, number] = [0.5, 0.5, 0.5];
  c: [number, number, number] = [1.0, 1.0, 1.0];
  d: [number, number, number] = [0.0, 0.0, 0.0];

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
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
    this.updateParams(ctx);

    // Create bind group
    // Bind source and destination buffers, and uniforms buffer (if needed)
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
