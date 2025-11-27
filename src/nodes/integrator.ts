import { loadShaderModule } from "../shaders/loadShader.ts";
import { GPUNode, type GPUNodeStage } from "./base.ts";

export class IntegratorNode extends GPUNode {
  stage: GPUNodeStage = "compute";
  private pipeline!: GPUComputePipeline;
  private bindGroup!: GPUBindGroup;
  private paramsBuffer!: GPUBuffer;


  async init(device: GPUDevice, ctx: any) {
    const module = await loadShaderModule(device, "/src/shaders/integrator.wgsl");

    this.paramsBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    if (ctx.frameIndex === 0) return false;
    const dt = new Float32Array([ctx.deltaTime]);
    ctx.queue.writeBuffer(this.paramsBuffer, 0, dt);

    this.bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
        { binding: 2, resource: { buffer: this.paramsBuffer } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / 256));
    pass.end();
    return true;
  }
}
