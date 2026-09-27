/** Deterministic area-uniform aperture samples. Blades=0 is a circular pupil. */
export function apertureSample(index: number, count: number, blades: number, rotationDegrees: number, seed = 0): [number, number] {
  let bits = index >>> 0;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  // Cranley-Patterson shifts avoid alignment with the axes and repeat per seed.
  const u = ((index + 0.5) / count + ((Math.imul(seed, 1664525) >>> 0) / 4294967296)) % 1;
  const v = (bits / 4294967296 + ((Math.imul(seed ^ 0x9e3779b9, 1013904223) >>> 0) / 4294967296)) % 1;
  const rotation = rotationDegrees * Math.PI / 180;
  if (blades < 3) {
    const r = Math.sqrt(u), angle = 2 * Math.PI * v + rotation;
    return [r * Math.cos(angle), r * Math.sin(angle)];
  }
  const sector = u * blades, side = Math.floor(sector), t = sector - side;
  const a = 2 * Math.PI * side / blades + rotation, b = a + 2 * Math.PI / blades;
  const r = Math.sqrt(v);
  return [r * ((1-t)*Math.cos(a)+t*Math.cos(b)), r * ((1-t)*Math.sin(a)+t*Math.sin(b))];
}
