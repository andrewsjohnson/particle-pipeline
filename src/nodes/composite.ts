// import { GPUNode } from "./base.ts";

// export class CompositeNode extends GPUNode {
//   private pipeline!: GPURenderPipeline;
//   private sampler!: GPUSampler;

//   async init(device: GPUDevice, ctx: any) {
//     const module = device.createShaderModule({
//       code: await fetch("/src/shaders/composite.wgsl").then(r => r.text()),
//     });

//     const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

//     this.pipeline = device.createRenderPipeline({
//       layout: "auto",
//       vertex: { module, entryPoint: "vs_main" },
//       fragment: {
//         module,
//         entryPoint: "fs_main",
//         targets: [{ format: canvasFormat }],
//       },
//       primitive: { topology: "triangle-list" },
//     });

//     // IMPORTANT: rgba16float is NOT filterable without feature
//     this.sampler = device.createSampler({
//       minFilter: "nearest",
//       magFilter: "nearest",
//     });
//   }

//   record(encoder: GPUCommandEncoder, ctx: any) {
//     const bindGroup = ctx.device.createBindGroup({
//       layout: this.pipeline.getBindGroupLayout(0),
//       entries: [
//         // MUST be a textureView, not a texture
//         { binding: 0, resource: ctx.particleRenderTarget },
//         { binding: 1, resource: this.sampler },
//       ],
//     });

//     const pass = encoder.beginRenderPass({
//       colorAttachments: [{
//         view: ctx.canvasView,
//         loadOp: "clear",
//         clearValue: { r: 0, g: 0, b: 0, a: 1 },
//         storeOp: "store",
//       }],
//     });

//     pass.setPipeline(this.pipeline);
//     pass.setBindGroup(0, bindGroup);
//     pass.draw(6); // full screen quad
//     pass.end();
//   }
// }

import { GPUNode } from "./base.ts";

export class CompositeNode extends GPUNode {
  private pipeline!: GPURenderPipeline;
  private sampler!: GPUSampler;

  async init(device: GPUDevice, ctx: any) {
    const module = device.createShaderModule({
      code: await fetch("/src/shaders/composite.wgsl").then(r => r.text()),
    });

    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{ format: canvasFormat, blend: { color: { srcFactor: "one", dstFactor: "zero" }, alpha: { srcFactor: "one", dstFactor: "zero" } } }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.sampler = device.createSampler({
      minFilter: "nearest",
      magFilter: "nearest",
    });

    const layout = this.pipeline.getBindGroupLayout(0);
    console.log("Composite layout =", layout);
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    const bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: ctx.particleRenderTarget },
      ],
    });
  
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.canvasView,
        loadOp: "clear",
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: "store",
      }],
    });
  
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
  }
}

