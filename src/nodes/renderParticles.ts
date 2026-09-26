import { perspectiveMatrix } from "../utils/perspectiveMatrix.ts";
import { multiplyMat4 } from "../utils/math.ts";
import { lookAt } from "../utils/perspectiveMatrix.ts";
import { GPURenderNode } from "./kinds/render-node.ts";
import { HotShader, loadShaderModule } from "../shaders/loadShader.ts";

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
  
  renderMode: "points" | "splats" = "points";
  cameraPosition = [5, 5, 5];
  cameraTarget = [0, 0, 0];
  fovDegrees = 45;
  focusDistance = Math.sqrt(75);
  fStop = 2.8;
  depthOfField = false;
  metersPerUnit = 1;
  splatSigma = 0.6; // standard deviation in HDR target pixels
  maxSplatSigma = 16;
  private pipelineKey = "";
  private readonly uniforms = new Float32Array(40);

  /** Includes only settings that change accumulated radiance. */
  imageSignature() {
    return JSON.stringify([this.renderMode, this.blendMode, this.cameraPosition,
      this.cameraTarget, this.fovDegrees, this.focusDistance, this.fStop,
      this.depthOfField, this.metersPerUnit, this.splatSigma, this.maxSplatSigma]);
  }

  // Particle render resources
  paramBuffer!: GPUBuffer;
  private device!: GPUDevice;
  
  // Fade pass resources
  fadeShader?: HotShader;
  private fadePipeline!: GPURenderPipeline;
  private fadeParamBuffer!: GPUBuffer;
  private fadeBindGroup!: GPUBindGroup;

  async onPipelineReady(device: GPUDevice, _ctx: any) {
    this.device = device;
    
    // MVP + view matrices, viewport/sigma and lens parameters (160 bytes)
    this.paramBuffer = device.createBuffer({
      label: "renderParticles.params",
      size: 4 * 40,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    // Fade pass param buffer (fade alpha)
    this.fadeParamBuffer = device.createBuffer({
      label: "renderParticles.fadeParams",
      size: 4, // single f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    // Initialize fade pipeline
    await this.initFadePipeline(device);
  }
  
  private async initFadePipeline(device: GPUDevice) {
    const fadeShader = await loadShaderModule(device, "/src/shaders/fade.wgsl");
    this.fadeShader = fadeShader;
    
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
    this.pipelineKey = `${this.renderMode}/${this.blendMode}`;
    const blendConfig = this.getBlendConfig();
    
    return device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: this.renderMode === "splats" ? "vs_splat" : "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: "rgba32float",
          blend: blendConfig,
        }],
      },
      primitive: { topology: this.renderMode === "splats" ? "triangle-strip" : "point-list" },
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
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
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
    const aspect = ctx.renderTextureWidth / ctx.renderTextureHeight;
    const fov = Math.max(1, Math.min(170, this.fovDegrees));
    const proj = perspectiveMatrix(fov, aspect, 0.1, 500);
    const [x, y, z] = this.cameraPosition;
    let [tx, ty, tz] = this.cameraTarget;
    if (Math.hypot(x-tx, y-ty, z-tz) < 1e-6) tz = z-1;
    const vertical = Math.hypot(x-tx, z-tz) < 1e-6;
    const view = lookAt({x,y,z}, {x:tx,y:ty,z:tz}, vertical ? {x:0,y:0,z:1} : {x:0,y:1,z:0});
    this.uniforms.set(multiplyMat4(proj, view), 0);
    this.uniforms.set(view, 16);
    const focalMM = 24 / (2 * Math.tan(fov * Math.PI / 360));
    this.uniforms.set([ctx.renderTextureWidth, ctx.renderTextureHeight,
      Math.max(0.25, this.splatSigma), Math.max(0.25, Math.min(64, this.maxSplatSigma))], 32);
    const unitsMM = Math.max(0.0001, this.metersPerUnit) * 1000;
    this.uniforms.set([focalMM, Math.max(focalMM+0.001, this.focusDistance*unitsMM),
      this.depthOfField ? Math.max(0.1, this.fStop) : 0, unitsMM], 36);
    ctx.queue.writeBuffer(this.paramBuffer, 0, this.uniforms);
  };

  record(encoder: GPUCommandEncoder, ctx: any) {
    // Guard: skip if resources aren't ready yet
    if (!this.paramBuffer || !this.pipeline) {
      return;
    }
    
    if (this.pipelineKey !== `${this.renderMode}/${this.blendMode}`) {
      this.pipeline = this.createRenderPipeline(this.device, this.shader.module!);
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
        loadOp = ctx.accumulationFrameIndex === 0 ? "clear" : "load";
        needsFadePass = ctx.accumulationFrameIndex > 0;
        break;
      case "accumulate":
      default:
        // Only clear on first frame, then accumulate
        loadOp = ctx.accumulationFrameIndex === 0 ? "clear" : "load";
        break;
    }
    
    // Trail mode: run fade pass first to darken existing content
    if (needsFadePass && this.fadePipeline && ctx.accumulationFrameIndex > 0) {
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

    const bindGroup = this.bindGroup(ctx.device, this.pipeline, [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: this.paramBuffer } },
      ]);

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
    if (this.renderMode === "splats") pass.draw(4, ctx.particleCount);
    else pass.draw(ctx.particleCount);
    pass.end();
  }
  
  /**
   * Build UI controls for this node.
   */
  buildUI(pane: any) {
    pane.addBinding(this, "renderMode", {label: "Particle shape", options: {Points: "points", Gaussian: "splats"}});
    const camera = pane.addFolder({title: "Camera & focus", expanded: false});
    for (const key of ["cameraPosition", "cameraTarget"] as const) {
      const v = this[key];
      const state = {x:v[0], y:v[1], z:v[2]};
      const label = key === "cameraPosition" ? "Eye" : "Target";
      camera.addBinding(state, "x", {label: `${label} X`}).on("change", () => {this[key][0] = state.x;});
      camera.addBinding(state, "y", {label: `${label} Y`}).on("change", () => {this[key][1] = state.y;});
      camera.addBinding(state, "z", {label: `${label} Z`}).on("change", () => {this[key][2] = state.z;});
    }
    camera.addBinding(this, "fovDegrees", {label:"Vertical FOV", min:1, max:170});
    camera.addBinding(this, "depthOfField", {label:"Depth of field"});
    camera.addBinding(this, "focusDistance", {label:"Focus distance", min:0.01, max:100});
    camera.addBinding(this, "fStop", {label:"F-stop", min:0.7, max:32});
    camera.addBinding(this, "metersPerUnit", {label:"Meters per unit", min:0.001, max:10});
    camera.addBinding(this, "splatSigma", {label:"Sharp sigma (px)", min:0.25, max:8});
    camera.addBinding(this, "maxSplatSigma", {label:"Blur limit (px)", min:0.25, max:64});
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
