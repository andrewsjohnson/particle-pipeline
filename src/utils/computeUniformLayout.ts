export function computeUniformLayout(spec: Record<string, string>) {
    let offset = 0;
    const layout: Record<string, { offset: number; size: number }> = {};
  
    for (const [name, type] of Object.entries(spec)) {
      const alignSize = TYPE_ALIGN[type];
      const typeSize = TYPE_SIZE[type];
  
      offset = align(offset, alignSize);
  
      layout[name] = {
        offset,
        size: typeSize,
      };
  
      offset += typeSize;
    }
  
    // vec4 alignment for whole struct
    offset = align(offset, 16);
    return { layout, totalSize: offset };
  }
  
  const TYPE_SIZE: Record<string, number> = {
    "f32": 4,
    "vec2<f32>": 8,
    "vec3<f32>": 16,  // padded
    "vec4<f32>": 16,
    "mat4x4<f32>": 64,
  };
  
  const TYPE_ALIGN: Record<string, number> = {
    "f32": 4,
    "vec2<f32>": 8,
    "vec3<f32>": 16,
    "vec4<f32>": 16,
    "mat4x4<f32>": 16,
  };
  
  /** Align "offset" to boundary "align" */
  function align(offset: number, alignment: number) {
    return Math.ceil(offset / alignment) * alignment;
  }
  