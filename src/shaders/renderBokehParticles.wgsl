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
    view : mat4x4<f32>,
    projection : mat4x4<f32>,
    screenWidth : f32,
    screenHeight : f32,
    radius : f32,
    _pad0: f32,
};

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv  : vec2<f32>,
    @location(1) col : vec4<f32>,
    @location(2) coc : f32,
};

@vertex
fn vs_main(
    @builtin(vertex_index) vId : u32,
    @builtin(instance_index) pId : u32
) -> VSOut {
    let p = src.particles[pId];
    var o: VSOut;

    // quad
    let QUAD = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0)
    );
    let q = QUAD[vId];

    // 1. world → view space
    let wpos = vec4<f32>(p.position, 1.0);
    let vpos = params.view * wpos;

    // 2. convert desired pixel size → view plane units
    //    (pixel offset → NDC → view offset)
    let focusDepth = -7.0;
    let coc = abs(vpos.z - focusDepth) * params.radius;
    let px = coc / params.screenWidth;
    let py = coc / params.screenWidth;

    // offset direction = camera local axes (x,y in view space)
    let vOffset = vec3<f32>(q.x * px * vpos.z, q.y * py * vpos.z, 0.0);

    o.coc = coc;

    // 3. apply view-plane offset
    let vBillboard = vec4<f32>(vpos.xyz + vOffset, 1.0);

    // 4. project
    o.pos = params.projection * vBillboard;

    o.uv = q * 0.5 + 0.5;
    let alpha = p.color.a * p.opacityScale;
    o.col = vec4<f32>(p.color.rgb * alpha, alpha);
    return o;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    let screenCenter = vec2<f32>(0.5,0.0);
    let blades = 6.0;
    let ringStrength = 1.5;

    // uv [-1..1]
    let r = in.uv * 2.0 - 1.0;
    let r2 = dot(r, r);

    // --- aperture polygon ---
    // blades define how circular the bokeh is
    let theta = atan2(r.y, r.x);
    let sector = 3.14159 / blades;
    // distance to polygonal limit
    let dist = cos(fract(theta / (2.0*sector)) * 2.0*sector - sector);

    // radial distance
    let rad = sqrt(r2);

    // mask for polygon
    if (rad > dist) { discard; }

    // --- edge bright ring (donut) ---
    // lenses brighten edges due to aperture clipping
    let edge = smoothstep(0.85, 1.0, rad);
    let ring = 1.0 + edge * ringStrength;
    // --- cat-eye distortion (off-axis) ---
    // real bokeh compresses tangentially near screen edges
    let center = vec2<f32>(0.0, 0.0); // NDC center
    let dir = normalize(vec2<f32>(in.uv - center));

    // --- energy conservation ---
    // disc gets dimmer as it gets larger
    let energy = 1.0 / max(in.coc * in.coc, 0.001);

    let alpha = in.col.a * energy * ring;
    return vec4<f32>(in.col.rgb, alpha);
}

