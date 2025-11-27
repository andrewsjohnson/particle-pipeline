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
struct Params { uniformName: f32, uniformName2: f32 };

// Uniforms Binding
@group(0) @binding(2)
var<uniform> P : Params;


/* UTIL FUNCTIONS GO HERE */
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

    // change particle attributes

    particle.velocity += vec3<f32>(0.0, 1.0, 0.0); // example: move particle up

    // write particle to destination buffer
    // note: you *must* write to the destination buffer

    dst.particles[idx] = particle;
}
  
