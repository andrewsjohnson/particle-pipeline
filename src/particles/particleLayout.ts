type ParticleField = {
  name: string;
  wgslType: string;
  /**
   * Size contributed by the field in bytes. vec3<f32> is 12, pads are 4, etc.
   */
  size: number;
};

const PARTICLE_FIELDS: ParticleField[] = [
  { name: "position", wgslType: "vec3<f32>", size: 12 },
  { name: "_pad0", wgslType: "f32", size: 4 },
  { name: "velocity", wgslType: "vec3<f32>", size: 12 },
  { name: "_pad1", wgslType: "f32", size: 4 },
  { name: "color", wgslType: "vec4<f32>", size: 16 },
  { name: "mass", wgslType: "f32", size: 4 },
  { name: "age", wgslType: "f32", size: 4 },
  { name: "lifetime", wgslType: "f32", size: 4 },
  { name: "alive", wgslType: "u32", size: 4 },
  { name: "id", wgslType: "u32", size: 4 },
];

export const PARTICLE_SIZE = PARTICLE_FIELDS.reduce((sum, field) => sum + field.size, 0);

const structBody = PARTICLE_FIELDS
  .map((field) => `    ${field.name} : ${field.wgslType},`)
  .join("\n");

export const PARTICLE_STRUCT_WGSL = /* wgsl */ `
struct Particle {
${structBody}
};

struct ParticleBuffer { particles : array<Particle> };
`;

