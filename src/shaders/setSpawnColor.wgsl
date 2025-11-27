// This is a base compute shader that can be used as a starting point for other compute shaders.

struct Particle {
    position : vec3<f32>,
    _pad0 : f32,
    velocity : vec3<f32>,
    _pad1 : f32,
    color : vec4<f32>,
    age : f32,
    lifetime : f32,
    alive : u32,
    id : u32,
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
    saturation: f32,
    offset: f32,
    scale: f32,
    _pad0: f32,
    a: vec3<f32>,
    _pad1: f32,
    b: vec3<f32>,
    _pad2: f32,
    c: vec3<f32>,
    _pad3: f32,
    d: vec3<f32>,
    _pad4: f32,
};

// Uniforms Binding
@group(0) @binding(2)
var<uniform> P : Params;


/* UTIL FUNCTIONS GO HERE */
fn getParticleDistFromOrigin(particle: Particle) -> f32 {
    return length(particle.position);
}

fn util() {
    /* DO STUFF */
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
        var dist = getParticleDistFromOrigin(particle);
        var rangeOffset = P.saturation * 0.1f;
        dist /= 2.0f;
        dist *= P.scale;
        dist += P.offset;

        var d = vec3<f32>(P.d.x - rangeOffset, P.d.y, P.d.z + rangeOffset);

        particle.color = vec4<f32>(P.a + P.b * cos(6.28318 * (P.c * dist + d)), particle.color.a);
        // particle.color = vec4<f32>(P.saturation, P.saturation, P.saturation, 1.0);
    }
    // write particle to destination buffer
    // note: you *must* write to the destination buffer

    dst.particles[idx] = particle;
}
  
