import { perspectiveMatrix } from "../utils/perspectiveMatrix.ts";
import { lookAt } from "../utils/perspectiveMatrix.ts";
import { GPURenderNode } from "./kinds/render-node.ts";

export type RenderBokehParticlesParams = {
  view: [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
  ];
  projection: [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
  ];
  screenSize: [number, number];
  radius: number;
}

export class RenderBokehParticlesNode extends GPURenderNode {
  static shaderPath: string = "/src/shaders/renderBokehParticles.wgsl";
  paramBuffer!: GPUBuffer;

  radius: number = 1.0;

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      label: "renderBokehParticles.params",
      size: 4 * 16 * 2 + 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
    const params = new Float32Array([...view, ...proj, ctx.renderWidth, ctx.renderHeight, this.radius, 0]);
    ctx.queue.writeBuffer(this.paramBuffer, 0, params);
  };

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
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        }],
      },
      primitive: { topology: "triangle-strip" },
    });
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    // Guard: skip if not initialized yet
    if (!this.paramBuffer || !this.pipeline) return;

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
        loadOp: ctx.accumulationFrameIndex === 0 ? "clear" : "load",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: "store",
      }],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4, ctx.particleCount);
    pass.end();
  }
}


