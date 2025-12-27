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
var<storage, read_write> dst : ParticleBuffer;

struct Params {
  dt : f32,
  fieldScale : f32,
  strength : f32,
  eps : f32,
  octaves : f32,
  lacunarity : f32,
  gain : f32,
  _pad0 : f32,
  seed : u32,
  _pad1 : vec3<u32>,
};
@group(0) @binding(2)
var<uniform> P : Params;

fn hash(p : vec3<i32>) -> f32 {
    let h = dot(p, vec3<i32>(374761393, 668265263, 700001));
    let n = (u32(h) ^ P.seed) + 0x9E3779B9u;
    let mixed = n ^ (n >> 13u);
    return fract(f32((mixed * 1274126177u)) * 0.00000000023283064365386963);
  }
  
  fn fade(t : vec3<f32>) -> vec3<f32> {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  }
  
  fn valueNoise(p : vec3<f32>) -> f32 {
    let i = vec3<i32>(floor(p));
    let f = fract(p);
    let w = fade(f);
  
    let n000 = hash(i + vec3<i32>(0, 0, 0));
    let n100 = hash(i + vec3<i32>(1, 0, 0));
    let n010 = hash(i + vec3<i32>(0, 1, 0));
    let n110 = hash(i + vec3<i32>(1, 1, 0));
    let n001 = hash(i + vec3<i32>(0, 0, 1));
    let n101 = hash(i + vec3<i32>(1, 0, 1));
    let n011 = hash(i + vec3<i32>(0, 1, 1));
    let n111 = hash(i + vec3<i32>(1, 1, 1));
  
    let nx00 = mix(n000, n100, w.x);
    let nx10 = mix(n010, n110, w.x);
    let nx01 = mix(n001, n101, w.x);
    let nx11 = mix(n011, n111, w.x);
  
    let nxy0 = mix(nx00, nx10, w.y);
    let nxy1 = mix(nx01, nx11, w.y);
  
    return mix(nxy0, nxy1, w.z) * 2.0 - 1.0;
  }
  
  fn vectorField(p : vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
      valueNoise(p + vec3(17.1, 3.7, 2.2)),
      valueNoise(p + vec3(5.3, 9.1, 1.4)),
      valueNoise(p + vec3(11.5, 4.2, 8.8))
    );
  }

  fn vectorFieldOctaves(p : vec3<f32>, octaves : i32, lacunarity : f32, gain : f32) -> vec3<f32> {
    var frequency = 1.0;
    var amplitude = 1.0;
    var totalWeight = 0.0;
    var sum = vec3<f32>(0.0);

    for (var i = 0; i < octaves; i = i + 1) {
      sum += vectorField(p * frequency) * amplitude;
      totalWeight += amplitude;
      frequency *= lacunarity;
      amplitude *= gain;
    }

    let denom = max(totalWeight, 0.0001);
    return sum / denom;
  }
  
  fn curlAt(p : vec3<f32>, eps : f32, octaves : i32, lacunarity : f32, gain : f32) -> vec3<f32> {
    let e = vec3<f32>(eps, 0.0, 0.0);
    let f = vec3<f32>(0.0, eps, 0.0);
    let g = vec3<f32>(0.0, 0.0, eps);
  
    let pX1 = vectorFieldOctaves(p + e, octaves, lacunarity, gain);
    let pX2 = vectorFieldOctaves(p - e, octaves, lacunarity, gain);
    let pY1 = vectorFieldOctaves(p + f, octaves, lacunarity, gain);
    let pY2 = vectorFieldOctaves(p - f, octaves, lacunarity, gain);
    let pZ1 = vectorFieldOctaves(p + g, octaves, lacunarity, gain);
    let pZ2 = vectorFieldOctaves(p - g, octaves, lacunarity, gain);
  
    let curl = vec3<f32>(
      (pY1.z - pY2.z) - (pZ1.y - pZ2.y),
      (pZ1.x - pZ2.x) - (pX1.z - pX2.z),
      (pX1.y - pX2.y) - (pY1.x - pY2.x)
    );
  
    return curl / (2.0 * eps);
  }
  
  @compute @workgroup_size(256)
  fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    let idx = global_id.x;
    if (idx >= arrayLength(&src.particles)) {
      return;
    }
  
    var particle = src.particles[idx];
    let scaledPos = particle.position * P.fieldScale;
    let octaveCount = max(1, i32(P.octaves));
    let curl = curlAt(scaledPos, P.eps, octaveCount, P.lacunarity, P.gain);

    let curlNormalized = normalize(curl);
    particle.velocity = particle.velocity + curlNormalized * P.strength;
    dst.particles[idx] = particle;
  }
  
