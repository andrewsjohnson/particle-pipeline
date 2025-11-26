export async function readGPUBuffer(device: GPUDevice, src: GPUBuffer, size: number) {
    const readBuffer = device.createBuffer({
        size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(src, 0, readBuffer, 0, size);
    device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const arrayBuffer = readBuffer.getMappedRange().slice(0);
    readBuffer.unmap();

    return arrayBuffer;
}

const PARTICLE_STRIDE_BYTES = 64;
const PARTICLE_STRIDE_FLOATS = PARTICLE_STRIDE_BYTES / 4; // 16

export function parseParticles(buf: ArrayBuffer, count: number) {
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);

  const out: any[] = [];

  for (let i = 0; i < count; i++) {
    const baseFloat = i * PARTICLE_STRIDE_FLOATS;

    out.push({
      index: i,
      pos: [
        f32[baseFloat + 0],
        f32[baseFloat + 1],
        f32[baseFloat + 2],
        f32[baseFloat + 3],
      ],
      vel: [
        f32[baseFloat + 4],
        f32[baseFloat + 5],
        f32[baseFloat + 6],
        f32[baseFloat + 7],
      ],
      col: [
        f32[baseFloat + 8],
        f32[baseFloat + 9],
        f32[baseFloat + 10],
        f32[baseFloat + 11],
      ],
      age: f32[baseFloat + 12],
      lifetime: f32[baseFloat + 13],
      alive: u32[baseFloat + 14], // read as u32
      id:    u32[baseFloat + 15], // read as u32
    });
  }

  return out;
}
