import { perspectiveMatrix } from "../utils/perspectiveMatrix.ts";
import { GPUNode, type GPUNodeStage } from "./base.ts";
import { multiplyMat4 } from "../utils/math.ts";
import { lookAt } from "../utils/perspectiveMatrix.ts";

export class RenderParticlesNode extends GPUNode {
  stage: GPUNodeStage = "render";
  private pipeline!: GPURenderPipeline;
  private cameraBuffer!: GPUBuffer;

  async init(device: GPUDevice, ctx: any) {
    this.cameraBuffer = device.createBuffer({
        size: 4 * 4 * 4, // mat4x4<f32>
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const module = device.createShaderModule({
      code: await fetch("/src/shaders/renderParticles.wgsl").then(r => r.text()),
    });

    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: "rgba32float",//"rgba16float",
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one" },
            // color: { srcFactor: "one", dstFactor: "one" },
            // alpha: { srcFactor: "one", dstFactor: "one" },
          },
        }],
      },
      primitive: { topology: "point-list" },
    });
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    const aspect = ctx.renderWidth / ctx.renderHeight;
    const projectionMatrix = perspectiveMatrix(45, aspect, 0.1, 500);
    const viewMatrix = lookAt({x: 5, y: 5, z: 5}, {x: 0, y: 0, z: 0}, {x: 0, y: 1, z: 0});

    const mvp = multiplyMat4(projectionMatrix, viewMatrix);
    ctx.queue.writeBuffer(this.cameraBuffer, 0, mvp);

    const bindGroup = ctx.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: ctx.particleSrc } },
            { binding: 1, resource: { buffer: this.cameraBuffer } },
        ],
    });

    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: ctx.particleRenderTarget,
            loadOp: ctx.frameIndex == 0 ? "clear" : "load",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: "store",
        }],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(ctx.particleCount);
    pass.end();
  }
}

