struct Particle {
    position : vec3<f32>,
    _pad0 : f32,
    velocity : vec3<f32>,
    _pad1 : f32,
    color : vec4<f32>,
    mass : f32,
    age : f32,
    lifetime : f32,
    alive : u32,
    needsRespawn : u32,
    id : u32,
};
  
struct ParticleBuffer { particles : array<Particle> };

@group(0) @binding(0)
var<storage, read> src : ParticleBuffer;

@group(0) @binding(1)
var<storage, read_write> dst : ParticleBuffer;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    let total = arrayLength(&src.particles);
    if (i >= total) { return; }


    var particle = src.particles[i];
    particle.velocity = vec3<f32>(0.0);
    dst.particles[i] = particle;
}
