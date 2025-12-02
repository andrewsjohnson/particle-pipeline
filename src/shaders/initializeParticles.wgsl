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
  
// Source Buffer
@group(0) @binding(0)
var<storage, read> src : ParticleBuffer;

// Destination Buffer
@group(0) @binding(1)
var<storage, read_write> dst : ParticleBuffer;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {

    let idx = gid.x;
    if (idx >= arrayLength(&src.particles)) {
        return;
    }

    var p = src.particles[idx];

    p.position = vec3<f32>(0.0);
    p.velocity = vec3<f32>(0.0);
    p.color    = vec4<f32>(1.0,1.0,1.0,0.0002);
    p.mass     = 1.0;
    p.age      = 0.0;
    p.lifetime = 100.0;
    p.alive    = 1u;
    p.id       = idx;
    p.needsRespawn = 1u;

    dst.particles[idx] = p;
}
