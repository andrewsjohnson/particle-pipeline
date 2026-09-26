/** Small bounded cache: ping-pong buffers need two entries; replaced resources
 * and pipelines must never reuse bindings from the previous generation. */
export class BindGroupCache {
  private entries: {pipeline: GPUPipelineBase; bindings: GPUBindGroupEntry[]; group: GPUBindGroup}[] = [];

  clear() { this.entries = []; }

  get(device: GPUDevice, pipeline: GPUPipelineBase, bindings: GPUBindGroupEntry[]) {
    const sameResource = (a: GPUBindingResource, b: GPUBindingResource) => {
      if (a === b) return true;
      if ('buffer' in a && 'buffer' in b) {
        return a.buffer === b.buffer && (a.offset ?? 0) === (b.offset ?? 0) && a.size === b.size;
      }
      return false;
    };
    const hit = this.entries.find(entry => entry.pipeline === pipeline &&
      entry.bindings.length === bindings.length && entry.bindings.every((binding, i) =>
        binding.binding === bindings[i].binding && sameResource(binding.resource, bindings[i].resource)));
    if (hit) return hit.group;
    const group = device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: bindings});
    if (this.entries.length >= 8) this.entries.shift();
    this.entries.push({pipeline, bindings: bindings.map(binding => ({...binding,
      resource: 'buffer' in binding.resource ? {...binding.resource} : binding.resource})), group});
    return group;
  }
}
