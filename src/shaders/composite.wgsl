@group(0) @binding(0) 
var hdrTex : texture_2d<f32>;

struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VSOut {
    let quad = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(1.0, 1.0),
    );

    var out : VSOut;
    let uv = quad[vid];
    out.pos = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv = uv;
    return out;
}

fn loadHDR(uv: vec2<f32>) -> vec3<f32> {
    let dims = textureDimensions(hdrTex);
    let coord = vec2<i32>(i32(uv.x * f32(dims.x)), i32(uv.y * f32(dims.y)));
    return textureLoad(hdrTex, coord, 0).xyz;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    //--- Base sample --------------------------------------------------
    let base = loadHDR(in.uv);

    //--- Naive bloom sample ------------------------------------------
    var bloom = vec3<f32>(0.0);
    let radius = 2.0;     // good start for 1M particles
    let samples = 8.0;

    let offsets = array<vec2<f32>, 8>(
        vec2<f32>(-1.0,  0.0),
        vec2<f32>( 1.0,  0.0),
        vec2<f32>( 0.0, -1.0),
        vec2<f32>( 0.0,  1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0),
    );

    for (var i = 0u; i < 8u; i++) {
        let uv2 = in.uv + offsets[i] * (radius / 1000.0);
        bloom += loadHDR(uv2);
    }
    bloom /= samples;

    //--- Add bloom -----------------------------------------------------
    var hdr = base + bloom * 0.8;

    //--- Tone-map (Filmic ACES-ish) -----------------------------------
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    hdr = (hdr * (a*hdr + b)) / (hdr * (c*hdr + d) + e);

    //--- Gamma ---------------------------------------------------------
    hdr = pow(hdr, vec3<f32>(1.0/2.2));

    return vec4<f32>(hdr, 1.0);
}
