export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
    return {
        x: a.x - b.x,
        y: a.y - b.y,
        z: a.z - b.z,
    };
}

export function dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

export function safeNormalize(v: Vec3): Vec3 {
    const len = Math.hypot(v.x, v.y, v.z);
    if (len < 1e-6) return { x: 0, y: 0, z: 0 };
    return {
        x: v.x / len,
        y: v.y / len,
        z: v.z / len,
    };
}

export function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
  
    // Column-major multiplication
    // out = a * b
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col * 4 + row] =
          a[0 * 4 + row] * b[col * 4 + 0] +
          a[1 * 4 + row] * b[col * 4 + 1] +
          a[2 * 4 + row] * b[col * 4 + 2] +
          a[3 * 4 + row] * b[col * 4 + 3];
      }
    }
  
    return out;
}
  