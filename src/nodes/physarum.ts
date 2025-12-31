import { GPUComputeNode } from "./kinds/compute-node.ts";

const WORKGROUP_SIZE = 256;

/**
 * Physarum-inspired field:
 * 1) Clear deposit buffer
 * 2) Agents deposit into a grid (atomic counts)
 * 3) Grid decays + diffuses + adds deposits
 * 4) Agents steer along field gradient
 */
export class PhysarumNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/physarum.wgsl";

  // Grid setup
  readonly gridResolution = 64;
  cellSize = 0.2;
  gridMin: [number, number, number] = [-8, -8, -8];

  // Field params
  depositAmount = 0.012; // contribution per agent per frame
  decay = 0.97; // multiplicative decay
  diffusion = 0.35; // neighbor blend factor

  // Steering params
  steerStrength = 6.0;
  maxSpeed = 4.0;
  fieldScale = 1.3; // scales sampled field gradient before steering

  paramBuffer!: GPUBuffer;
  trailBuffer!: GPUBuffer;
  depositBuffer!: GPUBuffer;

  clearPipeline!: GPUComputePipeline;
  depositPipeline!: GPUComputePipeline;
  fieldPipeline!: GPUComputePipeline;

  private get cellCount() {
    return this.gridResolution * this.gridResolution * this.gridResolution;
  }

  buildUI(pane: any) {
    const p = pane as any;
    p.addBinding(this, "cellSize", { label: "Cell Size", min: 0.05, max: 1.5 });
    p.addBinding(this, "depositAmount", { label: "Deposit", min: 0.001, max: 0.1 });
    p.addBinding(this, "decay", { label: "Decay", min: 0.5, max: 0.999, step: 0.001 });
    p.addBinding(this, "diffusion", { label: "Diffusion", min: 0.0, max: 1.0 });
    p.addBinding(this, "steerStrength", { label: "Steer", min: 0.0, max: 20.0 });
    p.addBinding(this, "maxSpeed", { label: "Max Speed", min: 0.1, max: 20.0 });
    p.addBinding(this, "fieldScale", { label: "Field Scale", min: 0.1, max: 5.0 });
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    const module = this.shader.module!;

    this.clearPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "clearDeposits" },
    });
    this.depositPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "depositAgents" },
    });
    this.fieldPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "updateField" },
    });
    // Base pipeline is for applyPhysarum (entryPoint "main")

    // Cleanup old buffers on hot reload
    try { this.paramBuffer?.destroy?.(); } catch (_e) {}
    try { this.trailBuffer?.destroy?.(); } catch (_e) {}
    try { this.depositBuffer?.destroy?.(); } catch (_e) {}

    this.paramBuffer = device.createBuffer({
      label: "physarum.params",
      size: 4 * 24,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const cellCount = this.cellCount;
    this.trailBuffer = device.createBuffer({
      label: "physarum.trail",
      size: cellCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.depositBuffer = device.createBuffer({
      label: "physarum.deposit",
      size: cellCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Initialize buffers to zero
    device.queue.writeBuffer(this.trailBuffer, 0, new Float32Array(cellCount));
    device.queue.writeBuffer(this.depositBuffer, 0, new Uint32Array(cellCount));
  }

  private updateParams(ctx: any) {
    if (!this.paramBuffer) return false;

    const buf = new ArrayBuffer(4 * 24);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);

    f32[0] = ctx.deltaTime;
    f32[1] = this.cellSize;
    f32[2] = this.depositAmount;
    f32[3] = this.decay;
    f32[4] = this.diffusion;
    f32[5] = this.steerStrength;
    f32[6] = this.fieldScale;
    f32[7] = this.maxSpeed;
    f32[8] = this.gridMin[0];
    f32[9] = this.gridMin[1];
    f32[10] = this.gridMin[2];
    f32[11] = 0.0;

    u32[12] = this.gridResolution;
    // padding
    u32[13] = 0;
    u32[14] = 0;
    u32[15] = 0;

    ctx.queue.writeBuffer(this.paramBuffer, 0, buf);
    return true;
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    if (!this.paramBuffer || !this.trailBuffer || !this.depositBuffer) {
      console.warn("PhysarumNode not initialized; skipping frame.");
      return false;
    }
    if (this.updateParams(ctx) === false) {
      return false;
    }

    const cellCount = this.cellCount;

    // Bind groups
    const clearBG = ctx.device.createBindGroup({
      layout: this.clearPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 3, resource: { buffer: this.paramBuffer } },
        { binding: 4, resource: { buffer: this.depositBuffer } },
      ],
    });

    const depositBG = ctx.device.createBindGroup({
      layout: this.depositPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 3, resource: { buffer: this.paramBuffer } },
        { binding: 4, resource: { buffer: this.depositBuffer } },
      ],
    });

    const fieldBG = ctx.device.createBindGroup({
      layout: this.fieldPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 2, resource: { buffer: this.trailBuffer } },
        { binding: 3, resource: { buffer: this.paramBuffer } },
        { binding: 4, resource: { buffer: this.depositBuffer } },
      ],
    });

    const applyBG = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
        { binding: 2, resource: { buffer: this.trailBuffer } },
        { binding: 3, resource: { buffer: this.paramBuffer } },
      ],
    });

    // 1) clear deposits
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.clearPipeline);
      pass.setBindGroup(0, clearBG);
      pass.dispatchWorkgroups(Math.ceil(cellCount / WORKGROUP_SIZE));
      pass.end();
    }

    // 2) deposit from agents
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.depositPipeline);
      pass.setBindGroup(0, depositBG);
      pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / WORKGROUP_SIZE));
      pass.end();
    }

    // 3) decay + diffuse + add deposits
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.fieldPipeline);
      pass.setBindGroup(0, fieldBG);
      pass.dispatchWorkgroups(Math.ceil(cellCount / WORKGROUP_SIZE));
      pass.end();
    }

    // 4) steer agents
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, applyBG);
      pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / WORKGROUP_SIZE));
      pass.end();
    }

    return true;
  }
}

