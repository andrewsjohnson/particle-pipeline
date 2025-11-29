import { GPUComputeNode } from "./kinds/compute-node.ts";

export class SpawnSphereNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/spawnSphere.wgsl";
  paramBuffer!: GPUBuffer;

  origin: [number, number, number] = [0, 0, 0];
  radius: number = 1.0;

  updateParams(ctx: any) {
    const params = new Float32Array([
      this.origin[0],
      this.origin[1],
      this.origin[2],
      this.radius,
    ]);
    ctx.queue.writeBuffer(this.paramBuffer, 0, params);
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      size: 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
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
