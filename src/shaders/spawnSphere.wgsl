////////////////////////////////////////////////////////////
// PARTICLE DATA
////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////
// SPAWN INPUT
////////////////////////////////////////////////////////////

struct SpawnSphere {
    origin : vec3<f32>,
    radius : f32,
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
// XOROSHIRO32* — single u32 state
////////////////////////////////////////////////////////////

fn rotl32(x: u32, k: u32) -> u32 {
    return (x << k) | (x >> (32u - k));
}

fn xrs32_next(state: ptr<function, u32>) -> u32 {
    var x = *state;
    x ^= x << 7u;
    x ^= x >> 9u;
    x ^= x << 8u;
    *state = x;
    // star transform
    return rotl32(x * 0x9E3779BBu, 5u);
}

// convert to [0,1)
fn rand_f(state: ptr<function, u32>) -> f32 {
    return f32(xrs32_next(state)) / 4294967295.0;
}


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
// VOLUME-CENTERED DISTRIBUTION: pow(rng, 1.5)
////////////////////////////////////////////////////////////

fn sample_radius(r: f32) -> f32 {
    return pow(r, 1.5);
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
    var state: u32 = idx ^ 0x1F123BB5u;

    let r0 = rand_f(&state);
    let r1 = rand_f(&state);
    let r2 = rand_f(&state);

    let dir   = random_unit_vector(r0, r1);
    let scale = sample_radius(r2);
    let dist  = sphere.radius * scale;

    p.age = 0.0;
    p.position = sphere.origin + dir * dist;
    p.needsRespawn = 0u;
    p.alive = 1u;

    dst.particles[idx] = p;
}
