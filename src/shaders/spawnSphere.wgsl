////////////////////////////////////////////////////////////
// PARTICLE DATA
////////////////////////////////////////////////////////////
/// 
struct Particle {
    position : vec3<f32>,
    _pad0 : f32,
    velocity : vec3<f32>,
    _pad1 : f32,
    color : vec4<f32>,
    mass : f32,
    age : f32,
    lifetime : f32,
    opacityScale : f32,
    alive : u32,
    needsRespawn : u32,
    id : u32,
    _pad2 : f32,
};

struct ParticleBuffer { particles : array<Particle> };

////////////////////////////////////////////////////////////
// SPAWN INPUT
////////////////////////////////////////////////////////////

struct SpawnSphere {
    origin : vec3<f32>,
    radius : f32,
    baseOpacity : f32,
    centerWeight : f32,
    seed : u32,
    _pad0 : u32,
    _pad1 : vec2<u32>,
    _pad2 : vec4<f32>,
    _pad3 : vec4<f32>,
    _pad4 : vec2<f32>,
};

// Source Buffer
@group(0) @binding(0)
var<storage, read> src : ParticleBuffer;

// Destination Buffer
@group(0) @binding(1)
var<storage, read_write> dst : ParticleBuffer;

@group(0) @binding(2)
var<uniform> sphere : SpawnSphere;


////////////////////////////////////////////////////////////
// SHARED COUNTER-BASED RANDOMNESS
////////////////////////////////////////////////////////////

// @include random.wgsl


////////////////////////////////////////////////////////////
// UNIFORM DIRECTION ON SPHERE
////////////////////////////////////////////////////////////

fn random_unit_vector(r0: f32, r1: f32) -> vec3<f32> {
    let u  = r0 * 2.0 - 1.0;
    let th = r1 * 6.28318530718; // 2π
    let s  = sqrt(1.0 - u * u);
    return vec3<f32>(s * cos(th), s * sin(th), u);
}

////////////////////////////////////////////////////////////
// Adjustable center weighting: >1 biases toward center, <1 toward edges
////////////////////////////////////////////////////////////

fn sample_radius(r: f32) -> f32 {
    let weight = max(sphere.centerWeight, 0.001);
    return pow(r, weight);
}


////////////////////////////////////////////////////////////
// MAIN COMPUTE
////////////////////////////////////////////////////////////

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    
    let idx = gid.x;
    if (idx >= arrayLength(&src.particles)) {
        return;
    }

    if (src.particles[idx].needsRespawn != 1u) {
        dst.particles[idx] = src.particles[idx];
        return;
    }

    var p = src.particles[idx];

    // seed per particle
    var state: u32 = particle_seed(idx, sphere.seed, 0x1F123BB5u);

    let r0 = rand_f(&state);
    let r1 = rand_f(&state);
    let r2 = rand_f(&state);

    let dir   = random_unit_vector(r0, r1);
    let scale = sample_radius(r2);
    let dist  = sphere.radius * scale;

    p.age = 0.0;
    p.velocity = vec3<f32>(0.0);
    p.opacityScale = 0.0;
    p.color.a = sphere.baseOpacity;
    p.position = sphere.origin + dir * dist;
    p.needsRespawn = 0u;
    p.alive = 1u;

    dst.particles[idx] = p;
}
