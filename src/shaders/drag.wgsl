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
  drag : f32,      // 0 = no effect, 1 = full stop
  dt : f32,        // delta time (used in time mode)
  mode : u32,      // 0 = frame-based, 1 = time-based
  _pad0 : f32,
};

@group(0) @binding(0)
var<storage, read> src : ParticleBuffer;

@group(0) @binding(1)
var<storage, read_write> dst : ParticleBuffer;

@group(0) @binding(2)
var<uniform> P : Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= arrayLength(&src.particles)) { return; }

  var particle = src.particles[idx];

  // Calculate retention factor based on mode
  var retention : f32;
  if (P.mode == 1u) {
    // Time-based: framerate-independent decay
    retention = pow(1.0 - P.drag, P.dt);
  } else {
    // Frame-based: direct multiplier each frame
    retention = 1.0 - P.drag;
  }

  particle.velocity = particle.velocity * retention;
  dst.particles[idx] = particle;
}

