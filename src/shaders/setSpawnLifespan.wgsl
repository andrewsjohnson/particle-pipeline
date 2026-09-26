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

@group(0) @binding(0)
var<storage, read> src : ParticleBuffer;

@group(0) @binding(1)
var<storage, read_write> dst : ParticleBuffer;

struct Params { 
    minLifespan: f32,
    maxLifespan: f32,
    seed: u32,
    _pad0: u32,
};

@group(0) @binding(2)
var<uniform> P : Params;

////////////////////////////////////////////////////////////
// SHARED COUNTER-BASED RANDOMNESS
////////////////////////////////////////////////////////////

// @include random.wgsl
  
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let idx = global_id.x;
    if (idx >= arrayLength(&src.particles)) {
        return;
    }

    var particle = src.particles[idx];

    // Set lifetime when particle is freshly spawned (age == 0)
    if (particle.age == 0.0 && particle.alive == 1u) {
        var state: u32 = particle_seed(idx, P.seed, 0x2A7C9E3Du);
        var t = rand_f(&state);
        particle.lifetime = P.minLifespan + t * (P.maxLifespan - P.minLifespan);
    }

    dst.particles[idx] = particle;
}

