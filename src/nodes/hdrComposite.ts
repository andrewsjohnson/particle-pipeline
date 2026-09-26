import { GPURenderNode } from "./kinds/render-node.ts";

export class HDRCompositeNode extends GPURenderNode {
  presentationOnly = true;
  enabled = true;
  targetFormat: GPUTextureFormat = "rgba16float";
  sampler!: GPUSampler;
  static shaderPath: string = "/src/shaders/hdrComposite.wgsl";

  setTargetFormat(format: GPUTextureFormat, device?: GPUDevice) {
    this.targetFormat = format;
    // Rebuild pipeline if we're already initialized
    if (device && this.shader?.module) {
      this.pipeline = this.createRenderPipeline(device, this.shader.module);
      this.onPipelineReady(device, {});
    }
  }

  /** Create pipeline for fullscreen blit */
  createRenderPipeline(device: GPUDevice, module: GPUShaderModule): GPURenderPipeline {
    return device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [
          {
            format: this.targetFormat,
            // We override WebGPU default blending to simple write
            blend: {
              color: { srcFactor: "one", dstFactor: "zero" },
              alpha: { srcFactor: "one", dstFactor: "zero" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  /** Called after pipeline is created (and after hot reload) */
  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.sampler = device.createSampler({
      minFilter: "linear",
      magFilter: "linear",
      mipmapFilter: "linear",
    });
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    if (!this.enabled) return false;
    if (!this.pipeline) return false;

    // Bind HDR accumulation texture
    const bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: ctx.particleRenderTarget }, // HDR float16 texture view
        { binding: 1, resource: this.sampler },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.canvasView,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: "store",
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6); // full-screen quad
    pass.end();
  }
}
