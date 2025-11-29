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
var<uniform> params : Params;

struct Params {
    mvp : mat4x4<f32>,
};

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) col   : vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) i : u32) -> VSOut {
    let p = src.particles[i];
    var o : VSOut;

    // Discard by pushing off-screen
    // if (p.alive == 0u) {
    //     o.pos = vec4<f32>(2.0,2.0,0.0,1.0);
    //     o.col = vec4<f32>(0);
    //     return o;
    // }

    let world = vec4<f32>(p.position, 1.0);

    // Apply full camera transform
    o.pos = params.mvp * world;
    // Premultiply RGB by alpha so additive blending respects particle opacity
    o.col = vec4<f32>(p.color.rgb * p.color.a, p.color.a);
    return o;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    return in.col;
}
