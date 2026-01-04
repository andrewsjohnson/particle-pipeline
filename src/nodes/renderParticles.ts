import { perspectiveMatrix } from "../utils/perspectiveMatrix.ts";
import { multiplyMat4 } from "../utils/math.ts";
import { lookAt } from "../utils/perspectiveMatrix.ts";
import { GPURenderNode } from "./kinds/render-node.ts";
import { loadShaderModule } from "../shaders/loadShader.ts";

export type ClearMode = "accumulate" | "clear" | "trail";
export type BlendMode = "additive" | "normal";

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
  
  // Rendering mode properties
  clearMode: ClearMode = "accumulate";
  trailFade: number = 0.02;
  blendMode: BlendMode = "normal";
  
  // Particle render resources
  paramBuffer!: GPUBuffer;
  private device!: GPUDevice;
  
  // Fade pass resources
  private fadePipeline!: GPURenderPipeline;
  private fadeParamBuffer!: GPUBuffer;
  private fadeBindGroup!: GPUBindGroup;

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.device = device;
    
    // Particle params buffer (MVP matrix)
    this.paramBuffer = device.createBuffer({
      label: "renderParticles.params",
      size: 4 * 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    // Fade pass param buffer (fade alpha)
    this.fadeParamBuffer = device.createBuffer({
      label: "renderParticles.fadeParams",
      size: 4, // single f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    // Initialize fade pipeline
    this.initFadePipeline(device);
  }
  
  private async initFadePipeline(device: GPUDevice) {
    const fadeShader = await loadShaderModule(device, "/src/shaders/fade.wgsl");
    
    this.fadePipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: fadeShader.module, entryPoint: "vs_main" },
      fragment: {
        module: fadeShader.module,
        entryPoint: "fs_main",
        targets: [{
          format: "rgba32float",
          blend: {
            // Blend to darken: dst = dst * (1 - srcAlpha) + src * srcAlpha
            // Since src.rgb = 0, this becomes: dst = dst * (1 - fadeAlpha)
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "zero", dstFactor: "one" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
    
    this.fadeBindGroup = device.createBindGroup({
      layout: this.fadePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.fadeParamBuffer } },
      ],
    });
  }

  createRenderPipeline(device: GPUDevice, module: GPUShaderModule) {
    const blendConfig = this.getBlendConfig();
    
    return device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: "rgba32float",
          blend: blendConfig,
        }],
      },
      primitive: { topology: "point-list" },
    });
  }
  
  private getBlendConfig(): GPUBlendState {
    if (this.blendMode === "additive") {
      return {
        color: { srcFactor: "one", dstFactor: "one" },
        alpha: { srcFactor: "one", dstFactor: "one" },
      };
    } else {
      // Normal premultiplied alpha blend
      return {
        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one" },
      };
    }
  }
  
  /**
   * Rebuild the particle render pipeline when blend mode changes.
   * Must be called after changing blendMode.
   */
  setBlendMode(mode: BlendMode) {
    if (mode === this.blendMode) return;
    this.blendMode = mode;
    
    if (this.device && this.shader?.module) {
      this.pipeline = this.createRenderPipeline(this.device, this.shader.module);
    }
  }
  
  /**
   * Set the clear mode for rendering.
   */
  setClearMode(mode: ClearMode) {
    this.clearMode = mode;
  }
  
  /**
   * Set the trail fade amount (0-1).
   * Higher values = faster fade / shorter trails.
   */
  setTrailFade(fade: number) {
    this.trailFade = Math.max(0, Math.min(1, fade));
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
    ctx.queue.writeBuffer(this.paramBuffer, 0, mvp);
  };

  record(encoder: GPUCommandEncoder, ctx: any) {
    // Guard: skip if resources aren't ready yet
    if (!this.paramBuffer || !this.pipeline) {
      return;
    }
    
    this.updateParams(ctx);
    
    // Determine load operation based on clear mode
    let loadOp: GPULoadOp;
    let needsFadePass = false;
    
    switch (this.clearMode) {
      case "clear":
        // Always clear every frame
        loadOp = "clear";
        break;
      case "trail":
        // Load existing content, then apply fade pass
        loadOp = "load";
        needsFadePass = true;
        break;
      case "accumulate":
      default:
        // Only clear on first frame, then accumulate
        loadOp = ctx.frameIndex === 0 ? "clear" : "load";
        break;
    }
    
    // Trail mode: run fade pass first to darken existing content
    if (needsFadePass && this.fadePipeline && ctx.frameIndex > 0) {
      // Update fade alpha uniform
      ctx.queue.writeBuffer(this.fadeParamBuffer, 0, new Float32Array([this.trailFade]));
      
      const fadePass = encoder.beginRenderPass({
        colorAttachments: [{
          view: ctx.particleRenderTarget,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      
      fadePass.setPipeline(this.fadePipeline);
      fadePass.setBindGroup(0, this.fadeBindGroup);
      fadePass.draw(3); // Fullscreen triangle
      fadePass.end();
    }

    const bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: this.paramBuffer } },
      ],
    });

    //
    // PARTICLE RENDER PASS
    //
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.particleRenderTarget,
        loadOp: needsFadePass ? "load" : loadOp, // After fade pass, always load
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        storeOp: "store",
      }],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(ctx.particleCount);
    pass.end();
  }
  
  /**
   * Build UI controls for this node.
   */
  buildUI(pane: any) {
    const state = {
      clearMode: this.clearMode,
      trailFade: this.trailFade,
      blendMode: this.blendMode,
    };
    
    const clearModeOptions = {
      "Accumulate": "accumulate",
      "Clear (every frame)": "clear",
      "Trail": "trail",
    };
    
    const blendModeOptions = {
      "Normal": "normal",
      "Additive": "additive",
    };
    
    pane.addBinding(state, "clearMode", {
      label: "Clear Mode",
      options: clearModeOptions,
    }).on("change", (ev: any) => {
      this.setClearMode(ev.value);
    });
    
    const trailBinding = pane.addBinding(state, "trailFade", {
      label: "Trail Fade",
      min: 0.001,
      max: 0.5,
      step: 0.001,
    }).on("change", (ev: any) => {
      this.setTrailFade(ev.value);
    });
    
    // Show/hide trail fade based on clear mode
    const updateTrailVisibility = () => {
      trailBinding.hidden = state.clearMode !== "trail";
    };
    updateTrailVisibility();
    
    pane.addBinding(state, "blendMode", {
      label: "Blend Mode",
      options: blendModeOptions,
    }).on("change", (ev: any) => {
      this.setBlendMode(ev.value);
    });
    
    // Update trail visibility when clear mode changes
    pane.on("change", () => {
      updateTrailVisibility();
    });
  }
}
