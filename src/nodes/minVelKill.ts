import { GPUComputeNode } from "./kinds/compute-node.ts";

export class MinVelKillNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/minVelKill.wgsl";
  paramBuffer!: GPUBuffer;

  minVel: number = 0.1;

  buildUI(pane: any) {
    const p = pane as any;
    p.addBinding(this, "minVel", { label: "Min Velocity", min: 0, max: 5 });
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      label: "minVelKill.params",
      size: 4 * 1,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  updateParams(ctx: any) {
    const params = new Float32Array([this.minVel]);
    ctx.queue.writeBuffer(this.paramBuffer, 0, params);
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    // Guard: skip if not initialized yet or on first frame
    if (!this.paramBuffer || !this.pipeline || ctx.frameIndex === 0) return false;

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
