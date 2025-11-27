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

struct ParticleBuffer { particles : array<Particle> };

@group(0) @binding(0)
var<storage, read> src : ParticleBuffer;

@group(0) @binding(1)
var<storage, read_write> dst : ParticleBuffer;

struct Params { dt : f32, fieldScale : f32, strength : f32, eps : f32 };
@group(0) @binding(2)
var<uniform> P : Params;

fn hash(p : vec3<i32>) -> f32 {
    let h = dot(p, vec3<i32>(374761393, 668265263, 700001));
    let n = u32(h);
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
  
  fn curlAt(p : vec3<f32>, eps : f32) -> vec3<f32> {
    let e = vec3<f32>(eps, 0.0, 0.0);
    let f = vec3<f32>(0.0, eps, 0.0);
    let g = vec3<f32>(0.0, 0.0, eps);
  
    let pX1 = vectorField(p + e);
    let pX2 = vectorField(p - e);
    let pY1 = vectorField(p + f);
    let pY2 = vectorField(p - f);
    let pZ1 = vectorField(p + g);
    let pZ2 = vectorField(p - g);
  
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
    let curl = curlAt(scaledPos, P.eps);
    particle.velocity = particle.velocity + curl * P.strength;
    // dst.particles[idx].position = particle.position;
    // dst.particles[idx].color = particle.color;
    // dst.particles[idx].age = particle.age;
    // dst.particles[idx].lifetime = particle.lifetime;
    // dst.particles[idx].alive = particle.alive;
    // dst.particles[idx].id = particle.id;
    dst.particles[idx].velocity = particle.velocity + curl * P.strength;
    dst.particles[idx] = particle;
  }
  
