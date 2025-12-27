export function packParams(
  layout: Record<string, { offset: number; size: number }>,
  spec: Record<string, string>,
  values: Record<string, number | readonly number[]>,
  target: ArrayBuffer
) {
  const view = new DataView(target);

  const getArray = (v: number | readonly number[]) =>
    (Array.isArray(v) ? v : [v]) as readonly number[];

  for (const [name, type] of Object.entries(spec)) {
    const info = layout[name];
    const value = values[name];

    switch (type) {
      case "f32":
        view.setFloat32(info.offset, value as number, true);
        break;

      case "vec2<f32>": {
        const v = getArray(value);
        view.setFloat32(info.offset,     v[0], true);
        view.setFloat32(info.offset + 4, v[1], true);
        break;
      }

      case "vec3<f32>": {
        const v = getArray(value);
        view.setFloat32(info.offset,     v[0], true);
        view.setFloat32(info.offset + 4, v[1], true);
        view.setFloat32(info.offset + 8, v[2], true);
        break;
      }

      case "vec4<f32>": {
        const v = getArray(value);
        view.setFloat32(info.offset,      v[0], true);
        view.setFloat32(info.offset + 4,  v[1], true);
        view.setFloat32(info.offset + 8,  v[2], true);
        view.setFloat32(info.offset + 12, v[3], true);
        break;
      }

      case "mat4x4<f32>": {
        const v = getArray(value);
        for (let i = 0; i < 16; i++) {
          view.setFloat32(info.offset + i * 4, v[i], true);
        }
        break;
      }

      default:
        console.warn(`Unsupported param type ${type}`);
    }
  }
}
