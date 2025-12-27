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

// Source Buffer
@group(0) @binding(0)
var<storage, read> src : ParticleBuffer;

// Destination Buffer
@group(0) @binding(1)
var<storage, read_write> dst : ParticleBuffer;

// Uniforms Buffer (if needed)
struct Params { 
    minMass: f32,
    maxMass: f32,
    seed: u32,
    _pad0: u32,
};

// Uniforms Binding
@group(0) @binding(2)
var<uniform> P : Params;


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
  
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {

    let idx = global_id.x;
    if (idx >= arrayLength(&src.particles)) {
        return;
        // return early if index is out of bounds
    }

    // get particle

    var particle = src.particles[idx];

    // change particle attributes if age is 0
    if (particle.age == 0.0 && particle.alive == 1u) {
        var state: u32 = (idx ^ P.seed ^ 0x1F123BB5u) | 1u;
        var mass = rand_f(&state);
        particle.mass = P.minMass + mass * (P.maxMass - P.minMass);
    }
    // write particle to destination buffer
    // note: you *must* write to the destination buffer

    dst.particles[idx] = particle;
}
  
