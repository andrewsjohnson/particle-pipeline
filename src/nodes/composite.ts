import { GPURenderNode } from "./kinds/render-node";

export class CompositeNode extends GPURenderNode {
  enabled = true;
  targetFormat: GPUTextureFormat = "rgba16float";
  applyToneMap = true;
  sampler!: GPUSampler;
  paramBuffer!: GPUBuffer;
  static shaderPath: string = "/src/shaders/composite.wgsl";

  setTargetFormat(format: GPUTextureFormat, device?: GPUDevice) {
    this.targetFormat = format;
    // Rebuild pipeline if we're already initialized
    if (device && this.shader?.module) {
      this.pipeline = this.createRenderPipeline(device, this.shader.module);
      this.onPipelineReady(device, {});
    }
  }

  setToneMapping(enabled: boolean, device?: GPUDevice) {
    this.applyToneMap = enabled;
    if (device && this.paramBuffer) {
      const data = new Uint32Array([this.applyToneMap ? 1 : 0]);
      device.queue.writeBuffer(this.paramBuffer, 0, data);
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

    // params: applyToneMap (u32)
    this.paramBuffer = device.createBuffer({
      label: "composite.params",
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const data = new Uint32Array([this.applyToneMap ? 1 : 0]);
    device.queue.writeBuffer(this.paramBuffer, 0, data);
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
        { binding: 2, resource: { buffer: this.paramBuffer } },
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
