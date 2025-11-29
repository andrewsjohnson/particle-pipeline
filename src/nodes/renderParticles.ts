import { perspectiveMatrix } from "../utils/perspectiveMatrix.ts";
import { multiplyMat4 } from "../utils/math.ts";
import { lookAt } from "../utils/perspectiveMatrix.ts";
import { GPURenderNode } from "./kinds/render-node.ts";

export type RenderParticlesParams = {
  mvp: [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
  ];
}

export class RenderParticlesNode extends GPURenderNode {
  static shaderPath: string = "/src/shaders/renderParticles.wgsl";
  paramBuffer!: GPUBuffer;

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      size: 4 * 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  createRenderPipeline(device: GPUDevice, module: GPUShaderModule) {
    return device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: "rgba32float",
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one" },
          },
        }],
      },
      primitive: { topology: "point-list" },
    });
  }
  
  updateParams(ctx: any) {
    const aspect = ctx.renderWidth / ctx.renderHeight;
    const proj = perspectiveMatrix(45, aspect, 0.1, 500);
    const view = lookAt(
      {x: 5, y: 5, z: 5},
      {x: 0, y: 0, z: 0},
      {x: 0, y: 1, z: 0}
    );
    const mvp = multiplyMat4(proj, view);
    const params = new Float32Array(mvp);
    ctx.queue.writeBuffer(this.paramBuffer, 0, mvp);
  };

  record(encoder: GPUCommandEncoder, ctx: any) {
    this.updateParams(ctx);

    const bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: this.paramBuffer } },
      ],
    });

    //
    // PASS
    //
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.particleRenderTarget,
        loadOp: ctx.frameIndex === 0 ? "clear" : "load",
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


