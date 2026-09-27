@group(0) @binding(0) 
var hdrTex : texture_2d<f32>;

@group(0) @binding(1)
var hdrSampler : sampler;

struct Params {
    display : vec4<f32>, // SDR enabled, EV, tone map, clipping preview
    balance : vec4<f32>, // RGB gains
}
@group(0) @binding(2)
var<uniform> params : Params;

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
    out.uv = vec2<f32>(uv.x, 1.0-uv.y);
    return out;
}

fn to_srgb(value: vec3<f32>) -> vec3<f32> {
    return select(1.055 * pow(value, vec3<f32>(1.0/2.4))-0.055,
        12.92*value, value <= vec3<f32>(0.0031308));
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    var hdr = max(vec3<f32>(0.0), textureSample(hdrTex, hdrSampler, in.uv).xyz)
        * exp2(params.display.y) * params.balance.xyz;
    if (params.display.x > 0.0) {
        if (params.display.z < 0.5) {
            hdr = hdr * (2.51*hdr+0.03) / (hdr*(2.43*hdr+0.59)+0.14);
        } else if (params.display.z < 1.5) {
            hdr = hdr / (1.0+hdr);
        }
        if (params.display.w > 0.0 && any(hdr >= vec3<f32>(1.0))) {
            return vec4<f32>(1.0, 0.0, 1.0, 1.0);
        }
        hdr = to_srgb(clamp(hdr, vec3<f32>(0.0), vec3<f32>(1.0)));
    }
    return vec4<f32>(hdr, 1.0);
}
