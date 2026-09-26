import { type ToneMap } from "../rendering/color.ts";
import { GPURenderNode } from "./kinds/render-node.ts";

export class CompositeNode extends GPURenderNode {
  presentationOnly = true;
  enabled = true;
  exposureEV = 0;
  whiteBalance = [1, 1, 1];
  toneMap: ToneMap = "aces";
  showClipping = false;
  private readonly uniforms = new Float32Array(8);
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
      // Format changes do not change the uniform/sampler resources.
    }
  }

  setToneMapping(enabled: boolean, device?: GPUDevice) {
    this.applyToneMap = enabled;
    if (device && this.paramBuffer) this.updateParams(device.queue);
  }

  private updateParams(queue: GPUQueue) {
    this.uniforms.set([this.applyToneMap ? 1 : 0, Math.max(-20, Math.min(20, this.exposureEV)),
      this.toneMap === "aces" ? 0 : this.toneMap === "reinhard" ? 1 : 2, this.showClipping ? 1 : 0,
      ...this.whiteBalance.map(value => Math.max(0, value)), 0]);
    queue.writeBuffer(this.paramBuffer, 0, this.uniforms);
  }

  buildUI(pane: any) {
    pane.addBinding(this, "exposureEV", {label:"Exposure (stops)", min:-20, max:20, step:0.1});
    pane.addBinding(this, "toneMap", {label:"Tone mapping", options:{Filmic:"aces", Reinhard:"reinhard", Linear:"linear"}});
    pane.addBinding(this, "showClipping", {label:"Show clipped highlights"});
    const balance = pane.addFolder({title:"White balance", expanded:false});
    const channels = ["Red", "Green", "Blue"];
    for (let i=0;i<3;i++) {
      const state = {gain:this.whiteBalance[i]};
      balance.addBinding(state, "gain", {label:channels[i], min:0.1, max:4, step:0.01})
        .on("change", () => {this.whiteBalance[i]=state.gain;});
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

    // Display flags/exposure and RGB white balance (two vec4s).
    this.paramBuffer = device.createBuffer({
      label: "composite.params",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.updateParams(device.queue);
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    if (!this.enabled) return false;
    if (!this.pipeline) return false;

    this.updateParams(ctx.queue);
    // Bind HDR accumulation texture
    const bindGroup = this.bindGroup(ctx.device, this.pipeline, [
        { binding: 0, resource: ctx.particleRenderTarget }, // HDR float16 texture view
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.paramBuffer } },
      ]);

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
