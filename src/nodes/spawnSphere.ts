import { GPUNode } from "./base.ts";

export class SpawnSphereNode extends GPUNode {
  private pipeline!: GPUComputePipeline;

  async init(device: GPUDevice, ctx: any) {
    // Load WGSL shader
    const module = device.createShaderModule({
      code: await fetch("/src/shaders/spawnSphere.wgsl").then(r => r.text()),
    });

    // Create compute pipeline
    this.pipeline = device.createComputePipeline({
      layout: "auto",
      compute: {
        module,
        entryPoint: "main",
      },
    });
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    // Run one time only
    if (ctx.frameIndex !== 0) return;

    // Bind **particleSrc**, NOT particleDst.
    // Spawn is the origin of truth.
    // particleSrc -> integrator -> particleDst -> ping-pong
    const bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: ctx.particleDst },
        },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);

    const workgroups = Math.ceil(ctx.particleCount / 256);
    pass.dispatchWorkgroups(workgroups);
    pass.end();

    console.log(
      `%cSpawnSphereNode → generated ${ctx.particleCount} particles`,
      "color:#a0ff6c;font-weight:bold;"
    );
  }
}
