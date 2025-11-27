@group(0) @binding(0)
var<storage, read> src : ParticleBuffer;

@group(0) @binding(1)
var<storage, read_write> dst : ParticleBuffer;

struct Params { minVel : f32 };
@group(0) @binding(2)
var<uniform> P : Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    let total = arrayLength(&src.particles);
    if (i >= total) { return; }

    let s = src.particles[i];
    var d = s;

    if (s.alive == 0u) {
        dst.particles[i] = s;
        return;
    }

    if (length(s.velocity) < P.minVel) {
        d.alive = 0u;
        d.needsRespawn = 1u;
    }

    dst.particles[i] = d;
}
