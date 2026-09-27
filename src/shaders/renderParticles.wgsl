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
var<uniform> params : Params;

struct Params {
    mvp : mat4x4<f32>,
    view : mat4x4<f32>,
    viewport : vec4<f32>, // width, height, sharp sigma, max sigma (target pixels)
    lens : vec4<f32>, // focal length mm, focus mm, f-stop (0 = off), mm/world unit
    sample : vec4<f32>, // pupil XY, sample weight, sampled-lens enabled
    tile : vec4<f32>, // tile origin XY (top-left), full output dimensions
};

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) @interpolate(flat) col : vec4<f32>,
    @location(1) @interpolate(flat) center : vec2<f32>,
    @location(2) @interpolate(flat) sigma : f32,
};

fn tile_clip(clip: vec4<f32>) -> vec4<f32> {
    let scale = params.tile.zw / params.viewport.xy;
    let offset = vec2<f32>(params.tile.z-2.0*params.tile.x-params.viewport.x,
        2.0*params.tile.y+params.viewport.y-params.tile.w) / params.viewport.xy;
    return vec4<f32>(clip.xy * scale + clip.w * offset, clip.zw);
}

@vertex
fn vs_main(@builtin(vertex_index) i : u32) -> VSOut {
    let p = src.particles[i];
    var o : VSOut;

    if (p.alive == 0u || p.needsRespawn == 1u) {
        o.pos = vec4<f32>(2.0, 2.0, 0.0, 1.0);
        o.col = vec4<f32>(0.0);
        return o;
    }

    let world = vec4<f32>(p.position, 1.0);

    // Apply full camera transform
    o.pos = tile_clip(params.mvp * world);
    // Premultiply RGB by alpha so additive blending respects particle opacity
    let alpha = p.color.a * p.opacityScale * params.sample.z;
    o.col = vec4<f32>(p.color.rgb * alpha, alpha);
    return o;
}

// Gaussian approximation to a thin-lens disc, matching its per-axis variance.
@vertex
fn vs_splat(@builtin(vertex_index) corner : u32, @builtin(instance_index) i : u32) -> VSOut {
    let p = src.particles[i];
    var o : VSOut;
    var clip = params.mvp * vec4<f32>(p.position, 1.0);
    if (p.alive == 0u || p.needsRespawn == 1u || clip.w <= 0.0 || clip.z < 0.0 || clip.z > clip.w) {
        o.pos = vec4<f32>(2.0, 2.0, 0.0, 1.0);
        return o;
    }
    let z = max(0.001, -(params.view * vec4<f32>(p.position, 1.0)).z * params.lens.w);
    var radius = 0.0;
    if (params.lens.z > 0.0) {
        let f = params.lens.x;
        let focus = params.lens.y;
        radius = 0.5 * (f / params.lens.z) * f * (z-focus) / (z * (focus-f)) * params.tile.w / 24.0;
    }
    // A lens sample shifts the projection toward the sampled pupil point;
    // all samples coincide at the focus plane, and near/far blur reverses sign.
    var sigma = min(params.viewport.w, sqrt(params.viewport.z * params.viewport.z + radius * radius * 0.25));
    if (params.sample.w > 0.0) {
        clip = vec4<f32>(clip.xy + params.sample.xy * radius * 2.0 / params.tile.zw * clip.w, clip.zw);
        sigma = params.viewport.z;
    }
    clip = tile_clip(clip);
    let q = array<vec2<f32>, 4>(vec2<f32>(-1,-1), vec2<f32>(1,-1), vec2<f32>(-1,1), vec2<f32>(1,1));
    o.pos = clip;
    o.pos = vec4<f32>(clip.xy + q[corner] * (3.0*sigma + 0.5) * 2.0 / params.viewport.xy * clip.w, clip.zw);
    o.center = (clip.xy / clip.w * vec2<f32>(0.5,-0.5) + 0.5) * params.viewport.xy;
    o.sigma = sigma;
    let alpha = p.color.a * p.opacityScale * params.sample.z;
    o.col = vec4<f32>(p.color.rgb * alpha, alpha);
    return o;
}

// Abramowitz-Stegun erf approximation; integrate pixels rather than point-sample
// the Gaussian so small/subpixel splats conserve energy too.
fn erf_approx(v: vec2<f32>) -> vec2<f32> {
    let t = 1.0 / (1.0 + 0.3275911 * abs(v));
    let polynomial = (((((1.061405429*t - 1.453152027)*t) + 1.421413741)*t - 0.284496736)*t + 0.254829592)*t;
    return sign(v) * (1.0 - polynomial * exp(-v*v));
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    if (in.sigma <= 0.0) { return in.col; }
    let delta = in.pos.xy - in.center;
    let lo = clamp(delta-0.5, vec2<f32>(-3.0*in.sigma), vec2<f32>(3.0*in.sigma));
    let hi = clamp(delta+0.5, vec2<f32>(-3.0*in.sigma), vec2<f32>(3.0*in.sigma));
    let integral = 0.5 * (erf_approx(hi/(1.41421356237*in.sigma)) - erf_approx(lo/(1.41421356237*in.sigma)));
    return in.col * (integral.x * integral.y / 0.9946076968);
}
