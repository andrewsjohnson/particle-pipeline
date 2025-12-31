import { GPUComputeNode } from "./kinds/compute-node.ts";

const WORKGROUP_SIZE = 256;

/**
 * GPU-side boids that writes velocity deltas.
 * Uses a uniform grid with capped buckets (no global sort) to keep neighbor
 * lookups bounded and avoid O(N^2) scans.
 *
 * Grid resolution and bucket size are fixed at creation time; tweak cellSize /
 * neighborRadius to control locality.
 */
export class FlockingNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/flocking.wgsl";

  // Fixed topology (buffer sizes are derived from these).
  readonly gridResolution = 48;
  readonly bucketSize = 64;

  // Tunable boids params.
  cellSize = 0.25;
  neighborRadius = 0.75;
  separationDistance = 0.3;
  alignmentWeight = 1.0;
  cohesionWeight = 0.6;
  separationWeight = 1.8;
  maxSpeed = 3.5;
  maxForce = 10.0;
  maxNeighbors = 64;
  gridMin: [number, number, number] = [-6, -6, -6];

  // GPU resources.
  paramBuffer!: GPUBuffer;
  gridCounts!: GPUBuffer;
  gridIndices!: GPUBuffer;

  // Extra pipelines per entry point.
  clearPipeline!: GPUComputePipeline;
  binPipeline!: GPUComputePipeline;

  private get cellCount() {
    return this.gridResolution * this.gridResolution * this.gridResolution;
  }

  buildUI(pane: any) {
    const p = pane as any;
    p.addBinding(this, "cellSize", { label: "Cell Size", min: 0.05, max: 2.0 });
    p.addBinding(this, "neighborRadius", {
      label: "Neighbor Radius",
      min: 0.05,
      max: 2.0,
    });
    p.addBinding(this, "separationDistance", {
      label: "Separation Dist",
      min: 0.05,
      max: 2.0,
    });
    p.addBinding(this, "alignmentWeight", { label: "Align W", min: 0, max: 5 });
    p.addBinding(this, "cohesionWeight", { label: "Cohesion W", min: 0, max: 5 });
    p.addBinding(this, "separationWeight", { label: "Separation W", min: 0, max: 5 });
    p.addBinding(this, "maxSpeed", { label: "Max Speed", min: 0, max: 20 });
    p.addBinding(this, "maxForce", { label: "Max Force", min: 0, max: 100 });
    p.addBinding(this, "maxNeighbors", {
      label: "Max Neighbors",
      min: 1,
      max: this.bucketSize,
      step: 1,
    }).on("change", (ev: any) => {
      // Clamp to bucket capacity to avoid reading stale slots.
      this.maxNeighbors = Math.min(ev.value, this.bucketSize);
    });
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    const module = this.shader.module!;

    // Recreate pipelines for each entry point on hot reload.
    this.clearPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "clearGrid" },
    });
    this.binPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "binParticles" },
    });
    // `this.pipeline` is already created for the "main" entry point by the base class.

    // Allocate buffers (destroy old ones if hot reloading).
    try { this.paramBuffer?.destroy?.(); } catch (_e) {}
    try { this.gridCounts?.destroy?.(); } catch (_e) {}
    try { this.gridIndices?.destroy?.(); } catch (_e) {}

    // Uniform buffer (pad to 80 bytes for alignment slack).
    this.paramBuffer = device.createBuffer({
      label: "flocking.params",
      size: 4 * 20,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const cellCount = this.cellCount;
    this.gridCounts = device.createBuffer({
      label: "flocking.gridCounts",
      size: cellCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.gridIndices = device.createBuffer({
      label: "flocking.gridIndices",
      size: cellCount * this.bucketSize * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Ensure counts are zeroed once at init; per-frame clear happens in the compute pass.
    device.queue.writeBuffer(this.gridCounts, 0, new Uint32Array(cellCount));
  }

  private updateParams(ctx: any) {
    if (!this.paramBuffer) {
      console.warn("FlockingNode params buffer not ready; skipping frame.");
      return false;
    }
    const buf = new ArrayBuffer(4 * 20);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);

    const safeNeighbor = Math.max(this.neighborRadius, 0.001);

    f32[0] = ctx.deltaTime;
    f32[1] = this.cellSize;
    f32[2] = safeNeighbor;
    f32[3] = this.maxSpeed;
    f32[4] = this.alignmentWeight;
    f32[5] = this.cohesionWeight;
    f32[6] = this.separationWeight;
    f32[7] = this.maxForce;
    f32[8] = this.gridMin[0];
    f32[9] = this.gridMin[1];
    f32[10] = this.gridMin[2];
    f32[11] = this.separationDistance;

    u32[12] = this.gridResolution;
    u32[13] = this.bucketSize;
    u32[14] = Math.min(this.maxNeighbors, this.bucketSize);
    u32[15] = 0;

    ctx.queue.writeBuffer(this.paramBuffer, 0, buf);
    return true;
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    if (!this.paramBuffer || !this.gridCounts || !this.gridIndices) {
      console.warn("FlockingNode not initialized; skipping frame.");
      return false;
    }
    if (this.updateParams(ctx) === false) {
      return false;
    }

    const cellCount = this.cellCount;

    // Bind groups per pipeline (layouts are entrypoint-specific).
    const clearBindGroup = ctx.device.createBindGroup({
      layout: this.clearPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 2, resource: { buffer: this.paramBuffer } },
        { binding: 3, resource: { buffer: this.gridCounts } },
      ],
    });

    const binBindGroup = ctx.device.createBindGroup({
      layout: this.binPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 2, resource: { buffer: this.paramBuffer } },
        { binding: 3, resource: { buffer: this.gridCounts } },
        { binding: 4, resource: { buffer: this.gridIndices } },
      ],
    });

    const mainBindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
        { binding: 2, resource: { buffer: this.paramBuffer } },
        { binding: 3, resource: { buffer: this.gridCounts } },
        { binding: 4, resource: { buffer: this.gridIndices } },
      ],
    });

    // 1) Clear grid counts.
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.clearPipeline);
      pass.setBindGroup(0, clearBindGroup);
      pass.dispatchWorkgroups(Math.ceil(cellCount / WORKGROUP_SIZE));
      pass.end();
    }

    // 2) Bin particles into the grid buckets.
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.binPipeline);
      pass.setBindGroup(0, binBindGroup);
      pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / WORKGROUP_SIZE));
      pass.end();
    }

    // 3) Apply flocking velocity change.
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, mainBindGroup);
      pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / WORKGROUP_SIZE));
      pass.end();
    }

    return true;
  }
}

