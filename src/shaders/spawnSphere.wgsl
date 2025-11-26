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

@group(0) @binding(0)
var<storage, read_write> particles : array<Particle>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= arrayLength(&particles)) { return; }

    var p = particles[idx];

    let total = arrayLength(&particles);
    let u = f32(idx) / f32(total);
    let th = 6.28318 * u * 20.0;

    p.position = vec3<f32>(sin(th), cos(th), 0.0);
    p.velocity = vec3<f32>(0.0);
    p.color    = vec4<f32>(0.0, 1.0, 1.0, 1.0);
    p.age      = 0.0;
    p.lifetime = 10000.0;
    p.alive    = 1u;
    p.id       = idx;

    particles[idx] = p;
}
