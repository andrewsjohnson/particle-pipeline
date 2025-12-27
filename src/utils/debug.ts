import { PARTICLE_SIZE } from "../particles/particleLayout";

export async function readGPUBuffer(device: GPUDevice, src: GPUBuffer, size: number) {
    const readBuffer = device.createBuffer({
        label: "debug.readback",
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

const PARTICLE_STRIDE_BYTES = PARTICLE_SIZE;
const PARTICLE_STRIDE_FLOATS = PARTICLE_STRIDE_BYTES / 4;

export function parseParticles(buf: ArrayBuffer, count: number) {
  const f32 = new Float32Array(buf);
  // Intentionally only using f32 view for now; expand if needed for debugging.

  const positions = [];

  for (let i = 0; i < count; i++) {
    const baseFloat = i * PARTICLE_STRIDE_FLOATS;

    const pos = {
      x: f32[baseFloat + 0],
      y: f32[baseFloat + 1],
      z: f32[baseFloat + 2],
    };
    positions.push(pos);
    
    // out.push({
    //   index: i,
      // pos: [
      //   f32[baseFloat + 0],
      //   f32[baseFloat + 1],
      //   f32[baseFloat + 2],
      //   f32[baseFloat + 3],
      // ],
      // x: f32[baseFloat + 0],
      // y: f32[baseFloat + 1],
      // z: f32[baseFloat + 2],
      // vel: [
      //   f32[baseFloat + 4],
      //   f32[baseFloat + 5],
      //   f32[baseFloat + 6],
      //   f32[baseFloat + 7],
      // ],
      // col: [
      //   f32[baseFloat + 8],
      //   f32[baseFloat + 9],
      //   f32[baseFloat + 10],
      //   f32[baseFloat + 11],
      // ],
      // mass: f32[baseFloat + 12],
      // age: f32[baseFloat + 13],
      // lifetime: f32[baseFloat + 14],
      // alive: u32[baseFloat + 15], // read as u32
      // needsRespawn: u32[baseFloat + 16], // read as u32
      // id:    u32[baseFloat + 17], // read as u32
  //   });
  }

  let minDist = Infinity;
  let maxDist = 0;
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    for (let j = 0; j < positions.length; j++) {
      if (i === j) continue;  
      const pos2 = positions[j];
      const dist = Math.sqrt((pos.x - pos2.x) * (pos.x - pos2.x) + (pos.y - pos2.y) * (pos.y - pos2.y) + (pos.z - pos2.z) * (pos.z - pos2.z));
      if (dist < minDist) minDist = dist;
      if (dist > maxDist) maxDist = dist;
    }
  }
  console.log(minDist);
  console.log(maxDist);
  // return out;
}