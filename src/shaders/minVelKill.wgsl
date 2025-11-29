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

struct Params { minVel : f32 };
@group(0) @binding(2)
var<uniform> P : Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    let total = arrayLength(&src.particles);
    if (i >= total) { return; }

    let s = src.particles[i];
    var d = s;

    if (s.alive == 0u) {
        dst.particles[i] = s;
        return;
    }

    if (length(s.velocity) < P.minVel) {
        d.alive = 0u;
        d.needsRespawn = 1u;
    }

    dst.particles[i] = d;
}
