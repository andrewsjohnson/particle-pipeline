import { type Vec3, safeNormalize, subVec3, cross, dot } from "./math.ts";

export function perspectiveMatrix(fov: number, aspect: number, near: number, far: number) {
    const f = 1 / Math.tan(fov/2);
    return new Float32Array([
        f/aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, far/(near - far), -1,
       0, 0, (far * near)/(near - far), 0,
    ]);
}

export function lookAt(position: Vec3, target: Vec3, up: Vec3) {
    const z = safeNormalize(subVec3(position, target));   // backward
    const x = safeNormalize(cross(up, z));                // right
    const y = cross(z, x);                            // up true
  
    return new Float32Array([
      x.x, y.x, z.x, 0,
      x.y, y.y, z.y, 0,
      x.z, y.z, z.z, 0,
      -dot(x, position),
      -dot(y, position),
      -dot(z, position),
      1,
    ]);
  }
  


  