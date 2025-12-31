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

struct Params {
  dt : f32,
  strength : f32,
  maxRadius : f32,
  maxForce : f32,
  origin : vec3<f32>,
  _pad0 : f32,
};

@group(0) @binding(0)
var<storage, read> src : ParticleBuffer;

@group(0) @binding(1)
var<storage, read_write> dst : ParticleBuffer;

@group(0) @binding(2)
var<uniform> P : Params;

fn normalize_or_zero(v : vec3<f32>) -> vec3<f32> {
  let len = length(v);
  return select(vec3<f32>(0.0), v / len, len > 1e-5);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= arrayLength(&src.particles)) { return; }

  let p = src.particles[idx];
  if (p.alive == 0u || p.needsRespawn == 1u) {
    dst.particles[idx] = p;
    return;
  }

  let toOrigin = P.origin - p.position;
  let dist = length(toOrigin);
  var outP = p;

  if (dist > P.maxRadius) {
    let dir = normalize_or_zero(toOrigin);
    var force = dir * P.strength;
    let fLen = length(force);
    if (fLen > P.maxForce && fLen > 0.0) {
      force = force / fLen * P.maxForce;
    }
    outP.velocity = p.velocity + force * P.dt;
  }

  dst.particles[idx] = outP;
}

