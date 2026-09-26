# Agent Documentation: particle-pipeline

This document provides comprehensive documentation for AI agents working on this WebGPU-based particle simulation pipeline.

---

## ⚠️ Maintaining This Document

**Agents must update this document when making changes that affect the documented information.** Keeping this documentation accurate saves significant time for future agents who would otherwise need to re-read source files.

### When to Update

Update `AGENTS.md` when you:

| Change Type | Sections to Update |
|-------------|-------------------|
| Add/remove fields in `Particle` struct | [Particle Data Structure](#particle-data-structure) |
| Add a new node | [Directory Structure](#directory-structure), [Node Execution Order](#node-execution-order) (if added to default pipeline) |
| Change the `ctx` object properties | [Context Object Reference](#context-object-reference) |
| Add new Pipeline methods | [Pipeline API](#pipeline-api) |
| Discover a new pattern/gotcha | [Common Patterns](#common-patterns) or [Tips & Gotchas](#tips--gotchas) |
| Change node base class interfaces | [Creating a New Compute Node](#creating-a-new-compute-node) or [Creating a New Render Node](#creating-a-new-render-node) |
| Add new required nodes | [Required Nodes](#required-nodes) |

### How to Update

1. Make your code changes first
2. Update the relevant sections in this document to reflect the changes
3. If adding a new major feature or concept, consider adding a new section
4. Keep code examples minimal but complete enough to be useful

### What NOT to Document Here

- Implementation details that are obvious from reading the code
- Temporary debugging code
- One-off experiments that won't be kept

---

## Project Overview

**particle-pipeline** is a WebGPU particle simulation and rendering system built with TypeScript and WGSL shaders. It features:

- **Node-based pipeline architecture**: Modular compute and render nodes that process particles
- **HDR rendering**: 32-bit float accumulation buffer with tonemapping
- **Bundled shaders**: WGSL raw imports work in production and hot reload during development
- **Fixed-step simulation**: 60 Hz simulation/accumulation is independent of screen refresh
- **Tweakpane UI**: Real-time parameter adjustment with save/load presets

### Tech Stack

| Technology | Purpose |
|------------|---------|
| TypeScript | Application logic |
| WebGPU | GPU compute and rendering |
| WGSL | Shader language |
| Vite | Dev server and bundler |
| Tweakpane | UI controls |

### Running the Project

```bash
pnpm install
pnpm dev    # Start dev server (default: http://localhost:5173)
npm run check  # CPU regressions + TypeScript + production bundle
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Pipeline                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Compute     │  │ Compute     │  │ Compute     │   ...   │
│  │ Node 1      │→ │ Node 2      │→ │ Node N      │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│         ↓ (ping-pong particle buffers between each)        │
│  ┌─────────────┐  ┌─────────────┐                          │
│  │ Render      │→ │ Render      │  (composite to canvas)   │
│  │ Node 1      │  │ Node 2      │                          │
│  └─────────────┘  └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

### Key Concepts

1. **Pipeline** (`src/pipeline.ts`): Orchestrates all nodes, manages particle buffers (ping-pong A/B), and the HDR render target.

2. **Nodes**: Self-contained GPU operations. Two types:
   - **Compute Nodes** (`GPUComputeNode`): Transform particle data
   - **Render Nodes** (`GPURenderNode`): Draw particles or composite results

3. **Particle Buffer**: Double-buffered storage for particle data. After each compute node writes output, buffers swap.

4. **HDR Accumulation**: Particles render to an `rgba32float` texture at 2x resolution, then composite to canvas with tonemapping.

---

## Directory Structure

```
src/
├── main.ts                 # Entry point, initializes WebGPU and pipeline
├── pipeline.ts             # Core Pipeline class
├── presets.ts              # Shared node registry and versioned serialization
├── simulation/fixedStep.ts # Bounded 60 Hz scheduler
├── nodes/
│   ├── kinds/
│   │   ├── base.ts         # GPUNode abstract base class
│   │   ├── compute-node.ts # GPUComputeNode base class
│   │   └── render-node.ts  # GPURenderNode base class
│   ├── initializeParticles.ts   # First-frame initialization
│   ├── spawnSphere.ts      # Spawn particles in sphere volume
│   ├── setSpawnColor.ts    # Set color on newly spawned particles
│   ├── setSpawnMass.ts     # Set mass on newly spawned particles
│   ├── setSpawnLifespan.ts # Set lifespan on newly spawned particles
│   ├── curlNoise.ts        # Apply curl noise forces
│   ├── flocking.ts         # Flocking behavior (boids)
│   ├── attractor.ts        # Attract particles toward point
│   ├── drag.ts             # Apply velocity damping
│   ├── integrator.ts       # Update position from velocity
│   ├── minVelKill.ts       # Kill slow particles
│   ├── opacityScale.ts     # Modify particle opacity over lifetime
│   ├── renderParticles.ts  # Render points or normalized Gaussian splats to HDR
│   └── composite.ts        # Composite HDR to canvas with tonemapping
├── shaders/
│   ├── loadShader.ts       # Hot-reloading shader loader
│   └── *.wgsl              # WGSL shaders (one per node)
├── particles/
│   └── particleLayout.ts   # Particle struct definition
├── ui/
│   ├── controlPanel.ts     # Tweakpane UI builder
│   └── folderButtonsPlugin.ts
└── utils/
    ├── math.ts             # Matrix operations
    ├── perspectiveMatrix.ts
    └── ...
```

---

## Particle Data Structure

Defined in `src/particles/particleLayout.ts`. This struct is duplicated in each WGSL shader:

```wgsl
struct Particle {
    position : vec3<f32>,     // World position
    _pad0 : f32,              // Padding (16-byte alignment)
    velocity : vec3<f32>,     // Current velocity
    _pad1 : f32,
    color : vec4<f32>,        // RGBA color
    mass : f32,               // Particle mass (affects physics)
    age : f32,                // Time since spawn
    lifetime : f32,           // Max age before respawn
    opacityScale : f32,       // Alpha multiplier
    alive : u32,              // 1 = alive, 0 = dead
    needsRespawn : u32,       // 1 = needs respawn next frame
    id : u32,                 // Unique particle ID
    _pad2 : f32,
};
```

**Total size**: 80 bytes per particle (exported as `PARTICLE_SIZE`).

### Particle Lifecycle

1. **Frame 0**: `InitializeParticlesNode` sets all particles to `alive=1, needsRespawn=1`
2. **Spawn nodes** (e.g., `SpawnSphereNode`) check `needsRespawn=1` and set position, velocity, `alive=1`, `needsRespawn=0`, `age=0`
3. **SetSpawn* nodes** check `age=0 && alive=1` to configure newly spawned particles
4. **Force nodes** modify velocity (curl noise, attractors, etc.)
5. **IntegratorNode** updates position from velocity, increments age
6. **Kill nodes** set `alive=0, needsRespawn=1` when conditions met (lifetime exceeded, velocity too low, etc.)
7. Cycle repeats—spawn nodes pick up respawning particles

---

## Creating a New Compute Node

### Step 1: Create the TypeScript Node

Create `src/nodes/myEffect.ts`:

```typescript
import { GPUComputeNode } from "./kinds/compute-node.ts";

export class MyEffectNode extends GPUComputeNode {
  // Stable shader identifier; loadShader resolves it from bundled raw imports
  static shaderPath: string = "/src/shaders/myEffect.wgsl";
  
  // Node parameters (exposed to UI)
  strength: number = 1.0;
  
  // GPU resources
  paramBuffer!: GPUBuffer;

  // Optional: Build Tweakpane UI controls
  buildUI(pane: any) {
    pane.addBinding(this, "strength", { 
      label: "Strength", 
      min: 0, 
      max: 10 
    });
  }

  // Called after pipeline creation (and on hot reload)
  onPipelineReady(device: GPUDevice, _ctx: any) {
    this.paramBuffer = device.createBuffer({
      label: "myEffect.params",
      size: 4 * 4,  // match the WGSL Params layout
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  // Write uniforms to GPU
  updateParams(ctx: any) {
    const buf = new ArrayBuffer(4 * 4);
    const f32 = new Float32Array(buf);
    f32[0] = ctx.deltaTime;
    f32[1] = this.strength;
    // f32[2], f32[3] = padding
    ctx.queue.writeBuffer(this.paramBuffer, 0, buf);
  }

  // Record GPU commands for this node
  record(encoder: GPUCommandEncoder, ctx: any) {
    // Skip if not ready
    if (!this.paramBuffer || !this.pipeline) return false;
    
    // Optional: skip on frame 0 (particles not yet spawned)
    // if (ctx.frameIndex === 0) return false;
    
    this.updateParams(ctx);

    const bindGroup = ctx.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ctx.particleSrc } },
        { binding: 1, resource: { buffer: ctx.particleDst } },
        { binding: 2, resource: { buffer: this.paramBuffer } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(ctx.particleCount / 256));
    pass.end();
    
    return true;  // Signal that we wrote to particleDst (triggers buffer swap)
  }
}
```

### Step 2: Create the WGSL Shader

Create `src/shaders/myEffect.wgsl`:

```wgsl
// IMPORTANT: Copy the Particle struct exactly as defined in particleLayout.ts
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

// Source (read-only)
@group(0) @binding(0)
var<storage, read> src : ParticleBuffer;

// Destination (read-write)
@group(0) @binding(1)
var<storage, read_write> dst : ParticleBuffer;

// Uniforms - must match TypeScript layout
struct Params {
    dt : f32,
    strength : f32,
    _pad0 : f32,
    _pad1 : f32,
};

@group(0) @binding(2)
var<uniform> P : Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= arrayLength(&src.particles)) { return; }

    var p = src.particles[idx];
    
    // Skip dead or respawning particles
    if (p.alive == 0u || p.needsRespawn == 1u) {
        dst.particles[idx] = p;
        return;
    }

    // === YOUR EFFECT LOGIC HERE ===
    // Example: apply force to velocity
    p.velocity += vec3<f32>(0.0, P.strength * P.dt, 0.0);

    // MUST write to destination buffer
    dst.particles[idx] = p;
}
```

### Step 3: Register for the Editor and Presets

Add to `src/presets.ts`:

```typescript
import { MyEffectNode } from "./nodes/myEffect.ts";

// In computeNodeTypes array:
const computeNodeTypes = [
  // ...existing nodes...
  { key: "myEffect", label: "MyEffect", ctor: MyEffectNode, properties: ["strength"] },
];
```

### Step 4: Add to Pipeline (optional default)

In `src/main.ts`:

```typescript
import { MyEffectNode } from "./nodes/myEffect.ts";

// In main():
pipeline.addNode(new MyEffectNode());
```

---

## Creating a New Render Node

Render nodes are similar but extend `GPURenderNode` and implement `createRenderPipeline()`:

```typescript
import { GPURenderNode } from "./kinds/render-node.ts";

export class MyRenderNode extends GPURenderNode {
  static shaderPath: string = "/src/shaders/myRender.wgsl";

  createRenderPipeline(device: GPUDevice, module: GPUShaderModule): GPURenderPipeline {
    return device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{
          format: "rgba32float",  // HDR render target
          blend: {
            color: { srcFactor: "one", dstFactor: "one" },  // Additive
            alpha: { srcFactor: "one", dstFactor: "one" },
          },
        }],
      },
      primitive: { topology: "point-list" },
    });
  }

  onPipelineReady(device: GPUDevice, ctx: any) {
    // Create resources...
  }

  record(encoder: GPUCommandEncoder, ctx: any) {
    // Create render pass, bind resources, draw...
  }
}
```

---

## Context Object Reference

The `ctx` object passed to `record()` contains:

| Property | Type | Description |
|----------|------|-------------|
| `device` | `GPUDevice` | WebGPU device |
| `queue` | `GPUQueue` | Command queue |
| `particleSrc` | `GPUBuffer` | Current particle buffer (read) |
| `particleDst` | `GPUBuffer` | Destination particle buffer (write) |
| `particleCount` | `number` | Total particles |
| `frameIndex` | `number` | Simulation step index (0 = initialization step) |
| `accumulationFrameIndex` | `number` | Image sample index; resets separately when resized |
| `deltaTime` | `number` | Fixed 1/60 second simulation timestep; 0 for presentation |
| `randomSeed` | `number` | Global random seed (u32) |
| `baseOpacity` | `number` | Global opacity multiplier |
| `renderWidth` | `number` | Canvas width in pixels |
| `renderHeight` | `number` | Canvas height in pixels |
| `renderTextureWidth` | `number` | Actual HDR target width (2x canvas) |
| `renderTextureHeight` | `number` | Actual HDR target height (2x canvas) |
| `particleRenderTarget` | `GPUTextureView` | HDR accumulation texture (for render nodes) |
| `canvasView` | `GPUTextureView` | Swapchain texture (for composite node) |

---

## Pipeline API

```typescript
const pipeline = new Pipeline(device, ctx, {
  particleCount: 1_000_000,
  renderWidth: canvas.width,
  renderHeight: canvas.height,
  particleTextureFormat: "rgba32float"
});

// Add nodes (before init)
pipeline.addNode(new SomeNode());

// Initialize all nodes
await pipeline.init();

// Or add after init:
await pipeline.addNodeAndInit(new SomeNode());

// Remove nodes
pipeline.removeNode(node);

// Move node in execution order
pipeline.moveNode(node, -1);  // move up
pipeline.moveNode(node, 1);   // move down

// Replace all nodes
await pipeline.setNodes(computeNodes, renderNodes);

// Runtime updates
pipeline.setParticleCount(2_000_000);
pipeline.setBaseOpacity(0.001);
pipeline.setRandomSeed(12345);
pipeline.resetSimulation();

// Each display refresh (schedules bounded fixed steps and presents)
pipeline.frame(deltaTime);
// While paused, or for deterministic offline rendering:
pipeline.step();     // exactly one simulation + accumulation step
pipeline.present();  // display; redraw frozen particles if camera/target size changed
pipeline.renderCurrentState(); // replace accumulated image with a snapshot, no simulation
pipeline.resetClock(); // discard fractional wall time after pause/visibility change
```

---

## Common Patterns

### Random Number Generation in WGSL

Randomized shaders include the shared counter/hash implementation. Never force the low seed bit with `| 1u`: that collapses adjacent particle IDs into identical trajectories. Zero is a valid internal RNG state. Use separate stream constants for unrelated attributes.

```wgsl
// @include random.wgsl

// In main():
var state = particle_seed(idx, P.seed, 0x3C6EF372u);
let r = rand_f(&state); // [0, 1), using exactly representable 24-bit samples
```

### Checking Particle State

```wgsl
// Process only living, non-respawning particles
if (p.alive == 0u || p.needsRespawn == 1u) {
    dst.particles[idx] = p;
    return;
}

// Process only newly spawned particles (spawn nodes set age = 0)
if (p.age == 0.0 && p.alive == 1u) {
    // Initialize new particle properties
}
```

### Skipping Frame 0

Many nodes skip frame 0 because particles aren't spawned yet:

```typescript
record(encoder: GPUCommandEncoder, ctx: any) {
  if (ctx.frameIndex === 0) return false;
  // ...
}
```

### Uniform Buffer Sizing

Uniform buffers must match the WGSL struct's alignment, offsets, and total size. A scalar-only struct can use four bytes; structs containing vectors often require additional padding. Do not infer layout by simply counting source fields.

---

## Debugging

### Reading Particle Buffer

Use the debug utilities in `src/utils/debug.ts`:

```typescript
import { parseParticles, readGPUBuffer } from "./utils/debug.ts";

// In main.ts frame loop:
if (pipeline.frameIndex === 2) {
  const size = pipeline.particleCount * PARTICLE_SIZE;
  const buf = await readGPUBuffer(device, pipeline.currentParticleBuffer, size);
  const particles = parseParticles(buf, pipeline.particleCount);
  console.table(particles.slice(0, 100));  // First 100 particles
}
```

### Hot Reload

WGSL shaders automatically reload when saved. The console shows:
```
🔥 Reload WGSL: /src/shaders/myEffect.wgsl
```

---

## Node Execution Order

The default node order in `main.ts`:

1. **InitializeParticles** - Frame 0 only: mark all for respawn
2. **SpawnSphere** - Position particles that need respawn
3. **SetSpawnColor** - Color newly spawned particles
4. **SetSpawnMass** - Mass for newly spawned particles  
5. **SetSpawnLifespan** - Lifespan for newly spawned particles
6. **Drag** - Apply velocity damping
7. **CurlNoise** - Apply curl noise forces
8. **Integrator** - Update position from velocity, age particles
9. **MinVelKill** - Kill slow particles
10. **OpacityScale** - Adjust opacity over lifetime
11. **RenderParticles** - Draw to HDR buffer
12. **Composite** - Tonemap and blit to canvas

### Required Nodes

Some nodes are required and cannot be removed:
- `InitializeParticlesNode` - Must be first compute node
- At least one spawn node (e.g., `SpawnSphereNode`)
- `RenderParticlesNode` - Must be first render node
- `CompositeNode` - Must be last render node

---

## Tips & Gotchas

1. **Always write to dst buffer**: Even if you don't modify a particle, copy it: `dst.particles[idx] = p;`

2. **Ping-pong buffers swap after each compute node** that returns `true` from `record()`. Return `false` to skip the swap.

3. **Particle struct must match exactly** between TypeScript (`particleLayout.ts`) and each WGSL shader.

4. **Uniform alignment**: WGSL uniforms follow std140-like rules. Use padding fields (`_pad0`, etc.) for alignment.

5. **Workgroup size is 256**: Dispatch `Math.ceil(particleCount / 256)` workgroups.

6. **Random seed**: Use `particle_seed` and `rand_f` from `random.wgsl`; do not discard particle-ID bits.

7. **HDR format**: Render target is `rgba32float`. Colors can exceed 1.0. Tonemapping happens in composite.

8. **Curl epsilon**: Smaller is not always more accurate in float32; tiny finite differences lose precision. Default is 0.001. Normalizing curl is an artistic option and generally destroys the divergence-free guarantee.

---

## Files to Reference

| Task | Key Files |
|------|-----------|
| Add compute node | `src/nodes/kinds/compute-node.ts`, any existing node (e.g., `drag.ts`) |
| Add render node | `src/nodes/kinds/render-node.ts`, `renderParticles.ts` |
| Modify particle struct | `src/particles/particleLayout.ts`, then ALL `.wgsl` files |
| Add UI controls | Node's `buildUI()` method; register serializable parameters in `src/presets.ts` |
| Pipeline management | `src/pipeline.ts` |
| Entry point | `src/main.ts` |

---

## TODO Items

See `TODO.md` for planned features including:
- Auto-generated node UI from uniforms
- Custom resolution/render scaling
- Save/load presets to files
- Node add/remove/reorder UI
- Camera controls
- Additional lifecycle nodes (SetAlphaOverLifetime, etc.)


## Foundation regression checks

- `npm run check` runs CPU timing/camera/preset tests, type checking, and the production build.
- `/tests/gpu.html` under Vite runs small WebGPU readback tests and checks the control panel. Keep GPU tests separate from claims about performance on physical hardware.
- `GPURenderNode.presentationOnly` distinguishes display composites from accumulating renderers. Presentation must not deposit particle samples.
- Renderers clear based on `ctx.accumulationFrameIndex`, not the simulation index. Reset clears the texture immediately, including in trail mode while paused.
- Submit each simulation step independently: repeated `queue.writeBuffer` calls in one submission otherwise make earlier dispatches see later uniform values.
- `GPUNode.ready` prevents simulation during asynchronous shader setup. Removed/replaced nodes dispose buffers and shader subscriptions.
- Preset schemas contain explicit editable parameters, not arbitrary enumerable runtime fields. Unknown node types throw. Drag and lifespan must remain registered.
- Apply display format/tone mapping from the active composite when loading presets. HDR toggles look up the current nodes rather than a captured original instance.
- The public projection helper takes field of view in degrees and produces WebGPU depth in [0, 1].
- Legacy presets cannot reconstruct parameters omitted by older serializers. Corrected seeds/camera mean legacy scenes are not pixel-identical.


## Camera, splats, and resource caching

`RenderParticlesNode` supports point-list (default) and instanced Gaussian quads in the same shader. The 160-byte uniform contains MVP, view, viewport/sigma, and lens vec4s. Lens units are millimeters internally, with a fixed 24 mm sensor height. Gaussian pixel integrals normalize premultiplied RGB and alpha over a three-sigma footprint. Blur uses a variance-matched thin-lens approximation; there is no aperture polygon or depth occlusion. Use the actual HDR target dimensions, not canvas dimensions, for pixel footprints.

Camera/lens/mode properties are registered in `presets.ts`. `GPURenderNode.imageSignature()` identifies edits requiring a fresh image. Pipeline checks signatures before simulation rendering and presentation: camera changes reset image history, while paused changes call `renderCurrentState()` without advancing particles. Rendering a snapshot counts as one accumulation sample. `renderCurrentState()` does nothing before the first simulation step.

Nodes use inherited `bindGroup(device, pipeline, entries)` for group 0. The bounded cache keys the exact pipeline and bound resources (including buffer offset/size), accommodates ping-pong pairs, and is cleared on resource disposal/hot reload. Do not cache transient canvas views. `tests/renderer.test.mjs` tests cache invalidation and camera preset compatibility; `tests/renderer.gpu.ts` tests actual shader energy, lens response, culling, and paused edits. GPU test counts compare cached/uncached group creation; they do not measure hardware FPS.
