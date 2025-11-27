import { loadShaderModule } from "../shaders/loadShader.ts";
import { GPUNode, type GPUNodeStage } from "./base.ts";

export class SpawnSphereNode extends GPUNode {
  stage: GPUNodeStage = "compute";
  private pipeline!: GPUComputePipeline;
  private sphereBuffer!: GPUBuffer;

  async init(device: GPUDevice, ctx: any) {
    // Load WGSL shader
    const module = await loadShaderModule(device, "/src/shaders/spawnSphere.wgsl");

    // Create compute pipeline
    this.pipeline = device.createComputePipeline({
      layout: "auto",
      compute: {
        module,
        entryPoint: "main",
      },
    });

    this.sphereBuffer = device.createBuffer({
      size: 4 * 4 * 4, // SpawnSphere struct
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    ctx.queue.writeBuffer(this.sphereBuffer, 0, new Float32Array([0, 0, 0, 1]));
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    // Run one time only
    if (ctx.frameIndex !== 0) return false;

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
        {
          binding: 1,
          resource: { buffer: this.sphereBuffer },
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
    return true;
  }
}
