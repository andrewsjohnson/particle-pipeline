// This is a base compute node that can be used as a starting point for other compute nodes.
import { GPUComputeNode } from "../../nodes/kinds/compute-node.ts";


export class ComputeBaseNode extends GPUComputeNode {
  shaderPath: string = "/src/shaders/compute-base.wgsl";
  paramsBuffer!: GPUBuffer;

  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramsBuffer = device.createBuffer({
      label: "computeBase.params",
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  record(encoder: GPUCommandEncoder, ctx: any) {

    // If you skip this node on any frame
    // you must return false to indicate that the node
    // did not write to the destination buffer
    // so we can skip swapping the ping-pong buffers after this node.
    // IF YOU DO NOT DO THIS, THE SIMULATION WILL BREAK.
    
    const dt = new Float32Array([ctx.deltaTime]);
    ctx.queue.writeBuffer(this.paramsBuffer, 0, dt);

    const bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
        { binding: 2, resource: { buffer: this.paramsBuffer } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / 256));
    pass.end();
    // Return true to indicate that the node wrote to the destination buffer
    // Note: you *must* return true to indicate that the node wrote to the destination buffer
    // If you return early, in cases of nodes that only run on some frames, you must return false to indicate that the node did not write to the destination buffer
    // This is used to determine if the ping-pong buffers should be swapped after this node.
    return true;
  }
}