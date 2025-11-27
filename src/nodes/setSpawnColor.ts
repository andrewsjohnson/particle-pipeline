// This is a base compute node that can be used as a starting point for other compute nodes.

import { loadShaderModule } from "../shaders/loadShader.ts";
import { GPUNode, type GPUNodeStage } from "./base.ts";

interface SetSpawnColorParams {
  saturation: number;
  offset: number;
  scale: number;
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  d: [number, number, number];
}

/**
 * Params
 * saturation: f32 - Saturation of the color
 * offset: f32 - Offset of the color
 * scale: f32 - Scale of the color
 * a: vec3<f32> - Color A
 * b: vec3<f32> - Color B
 * c: vec3<f32> - Color C
 * d: vec3<f32> - Color D
 */ 

const PADDING_VALUE = 0.0;
const DEFAULT_PARAMS: SetSpawnColorParams = {
  saturation: 2.5,
  offset: 0.0,
  scale: 1.0,
  a: [0.5, 0.5, 0.5],
  b: [0.5, 0.5, 0.5],
  c: [1.0, 1.0, 1.0],
  d: [0.0, 0.0, 0.0],
};

export class SetSpawnColorNode extends GPUNode {
  stage: GPUNodeStage = "compute";

  // Compute pipeline
  private pipeline!: GPUComputePipeline;
  private bindGroup!: GPUBindGroup;

  // Uniforms buffer (if needed)
  private paramsBuffer!: GPUBuffer;

  // Params
  params: SetSpawnColorParams;

  constructor(params?: SetSpawnColorParams) {
    super();
    this.params = {...DEFAULT_PARAMS, ...params};
  }

  // Initialize the node, this is called once when the node is created.
  async init(device: GPUDevice, ctx: any) {
    // Load WGSL shader
    const module = await loadShaderModule(device, "/src/shaders/setSpawnColor.wgsl");

    // Create uniforms buffer (if needed)
    this.paramsBuffer = device.createBuffer({
      size: 4 * 4 * 5,
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
      this.params.saturation,
      this.params.offset,
      this.params.scale,
      PADDING_VALUE,
      ...this.params.a,
      PADDING_VALUE,
      ...this.params.b,
      PADDING_VALUE,
      ...this.params.c,
      PADDING_VALUE,
      ...this.params.d,
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
