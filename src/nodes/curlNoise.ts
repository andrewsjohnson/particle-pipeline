import { loadShaderModule } from "../shaders/loadShader.ts";
import { GPUNode, type GPUNodeStage } from "./base.ts";

export class CurlNoiseNode extends GPUNode {
  stage: GPUNodeStage = "compute";
  private pipeline!: GPUComputePipeline;
  private bindGroup!: GPUBindGroup;
  private paramsBuffer!: GPUBuffer;

  fieldScale = 0.5;
  strength = .5;
  eps = 2; // Set high for swirlies

  async init(device: GPUDevice, ctx: any) {
    const module = await loadShaderModule(device, "/src/shaders/curl.wgsl");

    this.paramsBuffer = device.createBuffer({
      size: 4 + 4 + 4 + 4, 
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    const dt = new Float32Array([ctx.deltaTime, this.fieldScale, this.strength, this.eps]);
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
  }
}
