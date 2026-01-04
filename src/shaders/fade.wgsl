// Fullscreen fade pass for trail effect
// Draws a fullscreen triangle with semi-transparent black to darken existing content

struct Params {
    fadeAlpha: f32,
};

@group(0) @binding(0)
var<uniform> params: Params;

struct VSOut {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VSOut {
    // Fullscreen triangle covering clip space
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    var o: VSOut;
    o.pos = vec4<f32>(positions[i], 0.0, 1.0);
    return o;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    // Output semi-transparent black
    // The blend mode will multiply existing content by (1 - fadeAlpha)
    return vec4<f32>(0.0, 0.0, 0.0, params.fadeAlpha);
}

