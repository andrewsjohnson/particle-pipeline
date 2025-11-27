// This is a base compute node that can be used as a starting point for other compute nodes.

import { GPUNode, type GPUNodeStage } from "../../nodes/base.ts";


export class ComputeBaseNode extends GPUNode {
  stage: GPUNodeStage = "compute";

  // Compute pipeline
  private pipeline!: GPUComputePipeline;
  private bindGroup!: GPUBindGroup;

  // Uniforms buffer (if needed)
  private paramsBuffer!: GPUBuffer;

  // Initialize the node, this is called once when the node is created.
  async init(device: GPUDevice, ctx: any) {
    // Load WGSL shader
    const module = device.createShaderModule({
      code: await fetch("/src/shaders/integrator.wgsl").then(r => r.text()),
    });

    // Create uniforms buffer (if needed)
    this.paramsBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create compute pipeline
    this.pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
  }

  // Record the node, this is called every frame.
  record(encoder: GPUCommandEncoder, ctx: any) {

    // Write uniforms to buffer (if needed)
    const dt = new Float32Array([ctx.deltaTime]);
    ctx.queue.writeBuffer(this.paramsBuffer, 0, dt);

    // Create bind group
    // Bind source and destination buffers, and uniforms buffer (if needed)
    this.bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
        { binding: 2, resource: { buffer: this.paramsBuffer } },
      ],
    });

    // Begin compute pass
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    
    // Set bind group
    pass.setBindGroup(0, this.bindGroup);

    // Dispatch workgroups
    pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / 256));

    // End compute pass
    pass.end();

    // Return true to indicate that the node wrote to the destination buffer
    // Note: you *must* return true to indicate that the node wrote to the destination buffer
    // If you return early, in cases of nodes that only run on some frames, you must return false to indicate that the node did not write to the destination buffer
    // This is used to determine if the ping-pong buffers should be swapped after this node.
    return true;
  }
}
