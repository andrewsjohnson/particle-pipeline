import { GPUComputeNode } from "./kinds/compute-node.ts";

export type DragMode = "frame" | "time";

/**
 * Applies drag/damping to particle velocities.
 * - Frame mode: velocity *= (1 - drag) each frame (framerate-dependent)
 * - Time mode: velocity *= pow(1 - drag, dt) (framerate-independent)
 * 
 * drag = 0: no effect
 * drag = 1: complete velocity reset
 */
export class DragNode extends GPUComputeNode {
  static shaderPath: string = "/src/shaders/drag.wgsl";

  drag = 1.0;
  mode: DragMode = "frame";

  paramBuffer!: GPUBuffer;

  buildUI(pane: any) {
    const p = pane as any;
    p.addBinding(this, "drag", { label: "Drag", min: 0, max: 1, step: 0.01 });
    p.addBinding(this, "mode", {
      label: "Mode",
      options: { "Frame-based": "frame", "Time-based": "time" },
    });
  }

  onPipelineReady(device: GPUDevice, _ctx: any) {
    try { this.paramBuffer?.destroy?.(); } catch (_e) {}
    this.paramBuffer = device.createBuffer({
      label: "drag.params",
      size: 4 * 4, // drag, dt, mode, padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private updateParams(ctx: any) {
    if (!this.paramBuffer) return false;
    const buf = new ArrayBuffer(4 * 4);
    const view = new DataView(buf);
    view.setFloat32(0, this.drag, true);
    view.setFloat32(4, ctx.deltaTime, true);
    view.setUint32(8, this.mode === "time" ? 1 : 0, true);
    view.setFloat32(12, 0, true); // padding
    ctx.queue.writeBuffer(this.paramBuffer, 0, buf);
    return true;
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    if (!this.pipeline || !this.paramBuffer) {
      console.warn("DragNode not initialized; skipping frame.");
      return false;
    }
    if (ctx.frameIndex === 0) return false;
    if (this.updateParams(ctx) === false) return false;

    const bindGroup = this.bindGroup(ctx.device, this.pipeline, [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
        { binding: 2, resource: { buffer: this.paramBuffer } },
      ]);

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / 256));
    pass.end();
    return true;
  }
}

