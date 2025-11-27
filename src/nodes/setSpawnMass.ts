// This is a base compute node that can be used as a starting point for other compute nodes.

import { loadShaderModule } from "../shaders/loadShader.ts";
import { GPUNode, type GPUNodeStage } from "./base.ts";

interface SetSpawnMassParams {
  minMass: number;
  maxMass: number;
}

/**
 * Params
 * minMass: f32 - Minimum mass
 * maxMass: f32 - Maximum mass
 */ 

const PADDING_VALUE = 0.0;
const DEFAULT_PARAMS: SetSpawnMassParams = {
  minMass: 0.1,
  maxMass: 1.0,
};

export class SetSpawnMassNode extends GPUNode {
  stage: GPUNodeStage = "compute";

  // Compute pipeline
  private pipeline!: GPUComputePipeline;
  private bindGroup!: GPUBindGroup;

  // Uniforms buffer (if needed)
  private paramsBuffer!: GPUBuffer;

  // Params
  params: SetSpawnMassParams;

  constructor(params?: SetSpawnMassParams) {
    super();
    this.params = {...DEFAULT_PARAMS, ...params};
  }

  // Initialize the node, this is called once when the node is created.
  async init(device: GPUDevice, ctx: any) {
    // Load WGSL shader
    const module = await loadShaderModule(device, "/src/shaders/setSpawnMass.wgsl");

    // Create uniforms buffer (if needed)
    this.paramsBuffer = device.createBuffer({
      size: 4 + 4 + 4 + 4,
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
    const params = new Float32Array([
      this.params.minMass,
      this.params.maxMass,
      PADDING_VALUE,
      PADDING_VALUE,
    ])
    ctx.queue.writeBuffer(this.paramsBuffer, 0, params);

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
