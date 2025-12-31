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
  cellSize : f32,
  depositAmount : f32,
  decay : f32,
  diffusion : f32,
  steerStrength : f32,
  fieldScale : f32,
  maxSpeed : f32,
  gridMin : vec3<f32>,
  _pad0 : f32,
  gridSize : u32,
  _pad1 : vec3<u32>,
};

struct TrailGrid { values : array<f32>, }
struct DepositGrid { values : array<atomic<u32>>, }

@group(0) @binding(0)
var<storage, read> particlesSrc : ParticleBuffer;

@group(0) @binding(1)
var<storage, read_write> particlesDst : ParticleBuffer;

@group(0) @binding(2)
var<storage, read_write> trail : TrailGrid;

@group(0) @binding(3)
var<uniform> P : Params;

@group(0) @binding(4)
var<storage, read_write> deposits : DepositGrid;

fn clamp_cell(c : vec3<i32>) -> vec3<u32> {
  let g = i32(P.gridSize);
  let clamped = clamp(c, vec3<i32>(0), vec3<i32>(g - 1));
  return vec3<u32>(clamped);
}

fn cell_for_position(pos : vec3<f32>) -> vec3<u32> {
  let rel = (pos - P.gridMin) / max(P.cellSize, 0.0001);
  return clamp_cell(vec3<i32>(floor(rel)));
}

fn cell_index(c : vec3<u32>) -> u32 {
  return c.x + c.y * P.gridSize + c.z * P.gridSize * P.gridSize;
}

fn sample_field(c : vec3<u32>) -> f32 {
  return trail.values[cell_index(c)];
}

fn sample_field_world(pos : vec3<f32>) -> f32 {
  let rel = (pos - P.gridMin) / max(P.cellSize, 0.0001);
  let base = floor(rel);
  let frac = fract(rel);

  let b = vec3<i32>(base);
  let b000 = clamp_cell(b);
  let b100 = clamp_cell(b + vec3<i32>(1, 0, 0));
  let b010 = clamp_cell(b + vec3<i32>(0, 1, 0));
  let b110 = clamp_cell(b + vec3<i32>(1, 1, 0));
  let b001 = clamp_cell(b + vec3<i32>(0, 0, 1));
  let b101 = clamp_cell(b + vec3<i32>(1, 0, 1));
  let b011 = clamp_cell(b + vec3<i32>(0, 1, 1));
  let b111 = clamp_cell(b + vec3<i32>(1, 1, 1));

  let c000 = sample_field(b000);
  let c100 = sample_field(b100);
  let c010 = sample_field(b010);
  let c110 = sample_field(b110);
  let c001 = sample_field(b001);
  let c101 = sample_field(b101);
  let c011 = sample_field(b011);
  let c111 = sample_field(b111);

  let cx00 = mix(c000, c100, frac.x);
  let cx10 = mix(c010, c110, frac.x);
  let cx01 = mix(c001, c101, frac.x);
  let cx11 = mix(c011, c111, frac.x);

  let cxy0 = mix(cx00, cx10, frac.y);
  let cxy1 = mix(cx01, cx11, frac.y);

  return mix(cxy0, cxy1, frac.z);
}

fn gradient_world(pos : vec3<f32>) -> vec3<f32> {
  let eps = P.cellSize;
  let gx = sample_field_world(pos + vec3<f32>(eps, 0.0, 0.0)) - sample_field_world(pos - vec3<f32>(eps, 0.0, 0.0));
  let gy = sample_field_world(pos + vec3<f32>(0.0, eps, 0.0)) - sample_field_world(pos - vec3<f32>(0.0, eps, 0.0));
  let gz = sample_field_world(pos + vec3<f32>(0.0, 0.0, eps)) - sample_field_world(pos - vec3<f32>(0.0, 0.0, eps));
  return vec3<f32>(gx, gy, gz) * 0.5 * P.fieldScale;
}

@compute @workgroup_size(256)
fn clearDeposits(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let total = P.gridSize * P.gridSize * P.gridSize;
  if (idx >= total) { return; }
  atomicStore(&(deposits.values[idx]), 0u);
}

@compute @workgroup_size(256)
fn depositAgents(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= arrayLength(&particlesSrc.particles)) { return; }
  let p = particlesSrc.particles[idx];
  if (p.alive == 0u || p.needsRespawn == 1u) { return; }

  let cell = cell_for_position(p.position);
  let cIdx = cell_index(cell);
  atomicAdd(&(deposits.values[cIdx]), 1u);
}

@compute @workgroup_size(256)
fn updateField(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let total = P.gridSize * P.gridSize * P.gridSize;
  if (idx >= total) { return; }

  // Current cell coords
  let z = idx / (P.gridSize * P.gridSize);
  let y = (idx / P.gridSize) % P.gridSize;
  let x = idx % P.gridSize;
  let c = vec3<u32>(x, y, z);

  let center = trail.values[idx];
  // 6-neighbor diffusion (clamped to grid)
  var sum = center;
  var count = 1.0;

  let gx = i32(P.gridSize);
  let cx = i32(x); let cy = i32(y); let cz = i32(z);

  let offsets = array<vec3<i32>, 6>(
    vec3<i32>(1, 0, 0), vec3<i32>(-1, 0, 0),
    vec3<i32>(0, 1, 0), vec3<i32>(0, -1, 0),
    vec3<i32>(0, 0, 1), vec3<i32>(0, 0, -1)
  );

  for (var i = 0; i < 6; i = i + 1) {
    let n = vec3<i32>(cx, cy, cz) + offsets[i];
    if (any(n < vec3<i32>(0)) || n.x >= gx || n.y >= gx || n.z >= gx) { continue; }
    let nc = vec3<u32>(n);
    sum += sample_field(nc);
    count += 1.0;
  }

  let avg = sum / count;
  let diffused = mix(center, avg, P.diffusion);

  let depositsCount = atomicLoad(&(deposits.values[idx]));
  let add = f32(depositsCount) * P.depositAmount;

  let decayed = diffused * P.decay + add;
  trail.values[idx] = decayed;
}

fn clamp_coord(v : i32, maxv : u32) -> u32 {
  return u32(clamp(v, 0, i32(maxv)));
}

fn gradient_at(pos : vec3<u32>) -> vec3<f32> {
  let maxIdx = P.gridSize - 1u;
  let px0 = vec3<u32>(clamp_coord(i32(pos.x) - 1, maxIdx), pos.y, pos.z);
  let px1 = vec3<u32>(clamp_coord(i32(pos.x) + 1, maxIdx), pos.y, pos.z);
  let py0 = vec3<u32>(pos.x, clamp_coord(i32(pos.y) - 1, maxIdx), pos.z);
  let py1 = vec3<u32>(pos.x, clamp_coord(i32(pos.y) + 1, maxIdx), pos.z);
  let pz0 = vec3<u32>(pos.x, pos.y, clamp_coord(i32(pos.z) - 1, maxIdx));
  let pz1 = vec3<u32>(pos.x, pos.y, clamp_coord(i32(pos.z) + 1, maxIdx));

  let dx = sample_field(px1) - sample_field(px0);
  let dy = sample_field(py1) - sample_field(py0);
  let dz = sample_field(pz1) - sample_field(pz0);
  return vec3<f32>(dx, dy, dz) * P.fieldScale;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= arrayLength(&particlesSrc.particles)) { return; }

  let p = particlesSrc.particles[idx];
  if (p.alive == 0u || p.needsRespawn == 1u) {
    particlesDst.particles[idx] = p;
    return;
  }

  let grad = gradient_world(p.position);
  let dir = normalize(grad + 1e-5);

  var vel = p.velocity + dir * P.steerStrength * P.dt;
  let speed = length(vel);
  if (speed > P.maxSpeed && speed > 0.0) {
    vel = vel / speed * P.maxSpeed;
  }

  var outP = p;
  outP.velocity = vel;
  particlesDst.particles[idx] = outP;
}

