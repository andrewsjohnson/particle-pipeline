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
  neighborRadius : f32,
  maxSpeed : f32,
  alignmentWeight : f32,
  cohesionWeight : f32,
  separationWeight : f32,
  maxForce : f32,
  gridMin : vec3<f32>,
  separationDistance : f32,
  gridSize : u32,
  bucketSize : u32,
  maxNeighbors : u32,
  _pad1 : u32,
};

struct GridCounts { counts : array<atomic<u32>>, }
struct GridIndices { indices : array<u32>, }

@group(0) @binding(0)
var<storage, read> src : ParticleBuffer;

@group(0) @binding(1)
var<storage, read_write> dst : ParticleBuffer;

@group(0) @binding(2)
var<uniform> P : Params;

@group(0) @binding(3)
var<storage, read_write> gridCounts : GridCounts;

@group(0) @binding(4)
var<storage, read_write> gridIndices : GridIndices;

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

fn normalize_or_zero(v : vec3<f32>) -> vec3<f32> {
  let len = length(v);
  return select(vec3<f32>(0.0), v / len, len > 1e-5);
}

@compute @workgroup_size(256)
fn clearGrid(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let cellCount = P.gridSize * P.gridSize * P.gridSize;
  if (idx >= cellCount) { return; }
  atomicStore(&(gridCounts.counts[idx]), 0u);
}

@compute @workgroup_size(256)
fn binParticles(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= arrayLength(&src.particles)) { return; }

  let p = src.particles[idx];
  if (p.alive == 0u || p.needsRespawn == 1u) { return; }

  let cell = cell_for_position(p.position);
  let cIdx = cell_index(cell);

  let slot = atomicAdd(&(gridCounts.counts[cIdx]), 1u);
  if (slot < P.bucketSize) {
    let writeIdx = cIdx * P.bucketSize + slot;
    gridIndices.indices[writeIdx] = idx;
  }
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= arrayLength(&src.particles)) { return; }

  let pSrc = src.particles[idx];
  if (pSrc.alive == 0u || pSrc.needsRespawn == 1u) {
    dst.particles[idx] = pSrc;
    return;
  }

  let cell = cell_for_position(pSrc.position);
  let cIdx = cell_index(cell);
  // Neighborhood search: visit adjacent cells within radius.
  let range = i32(ceil(P.neighborRadius / max(P.cellSize, 0.0001)));

  var align : vec3<f32> = vec3<f32>(0.0);
  var coh : vec3<f32> = vec3<f32>(0.0);
  var sep : vec3<f32> = vec3<f32>(0.0);
  var neighborCount : u32 = 0u;

  for (var dz = -range; dz <= range; dz = dz + 1) {
    for (var dy = -range; dy <= range; dy = dy + 1) {
      for (var dx = -range; dx <= range; dx = dx + 1) {
        let nc = vec3<i32>(i32(cell.x) + dx, i32(cell.y) + dy, i32(cell.z) + dz);
        // Skip out-of-bounds cells.
        if (any(nc < vec3<i32>(0)) || any(nc >= vec3<i32>(i32(P.gridSize)))) {
          continue;
        }
        let ncu = vec3<u32>(nc);
        let ncIdx = cell_index(ncu);
        let count = min(atomicLoad(&(gridCounts.counts[ncIdx])), P.bucketSize);
        let base = ncIdx * P.bucketSize;
        let maxN = min(count, P.maxNeighbors);

        for (var i : u32 = 0u; i < maxN; i = i + 1u) {
          let nIdx = gridIndices.indices[base + i];
          if (nIdx == idx) { continue; }
          if (nIdx >= arrayLength(&src.particles)) { continue; }
          let n = src.particles[nIdx];
          if (n.alive == 0u) { continue; }

          let offset = n.position - pSrc.position;
          let dist = length(offset);
          if (dist > P.neighborRadius || dist < 1e-5) { continue; }

          neighborCount = neighborCount + 1u;
          align += n.velocity;
          coh += n.position;
          // Weighted separation (push away harder when closer).
          let inv = 1.0 / max(dist * dist, 1e-4);
          sep -= offset * inv * P.separationDistance;
        }
      }
    }
  }

  var vel = pSrc.velocity;
  if (neighborCount > 0u) {
    let nf = f32(neighborCount);
    let avgVel = align / nf;
    let alignForce = normalize_or_zero(avgVel) * P.maxSpeed - vel;

    let avgPos = coh / nf;
    let cohesionDir = avgPos - pSrc.position;
    let cohesionForce = normalize_or_zero(cohesionDir) * P.maxSpeed - vel;

    let separationForce = sep;

    var accel = vec3<f32>(0.0);
    accel += alignForce * P.alignmentWeight;
    accel += cohesionForce * P.cohesionWeight;
    accel += separationForce * P.separationWeight;

    let accelLen = length(accel);
    if (accelLen > P.maxForce && accelLen > 0.0) {
      accel = accel / accelLen * P.maxForce;
    }

    vel = vel + accel * P.dt;
  }

  let speed = length(vel);
  if (speed > P.maxSpeed && speed > 0.0) {
    vel = vel / speed * P.maxSpeed;
  }

  var outP = pSrc;
  outP.velocity = vel;
  dst.particles[idx] = outP;
}

