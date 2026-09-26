# Particle Pipeline

A TypeScript/WebGPU particle-art playground with editable compute nodes, floating-point accumulation, and EXR/Radiance HDR export.

## Run

Use Node.js 22.18+ and a browser/GPU supporting WebGPU's `float32-filterable` and `float32-blendable` features.

```sh
pnpm install
pnpm dev
```

```sh
npm run check   # Regression tests, TypeScript checks, production build
pnpm preview   # Serve the production build after building
```

Shaders are imported into the production bundle; deploying `dist/` does not require serving the source directory. Particle capacity is checked against the adapter's buffer limits.

## Simulation and rendering

- Simulation advances at 60 fixed steps per simulated second. Each step deposits one image sample; screen refreshes only present the image. A slow preview performs at most four steps per refresh and drops excess wall-clock time rather than taking unstable large steps.
- Pause freezes simulation and accumulation. Display/HDR changes remain visible. Resizing clears accumulated pixels but keeps particle positions, velocities, and ages.
- Curl's **Follow flow** mode sets velocity from the field. **Apply force** adds acceleration multiplied by the fixed timestep. **Legacy per-step** retains the earlier velocity-kick interpretation for old presets. The integrator retains the existing inverse-mass motion scaling.
- **Normalize field** retains the constant-speed artistic behavior. Turning it off preserves field-magnitude variation. Normalization generally does not preserve a curl field's divergence-free property.
- `pipeline.step()` advances exactly one simulation/accumulation step; `pipeline.present()` displays without advancing. Matching seed, parameters, node order, and step count gives repeatable results on the same GPU for the default pipeline. Cross-device bitwise equivalence is not promised; flocking's atomic bucket ordering can also introduce nondeterminism.

## Presets

Presets are saved in browser local storage. Version 2 saves explicit editable parameters for every registered node, including drag and lifespan. Invalid/unknown nodes fail visibly instead of disappearing. Runtime resources and the current display format are not serialized.

Older unversioned presets still load and retain legacy curl semantics. Settings that old builds never saved (notably omitted drag/lifespan nodes) cannot be recovered from those files. Corrected random initialization and the degree-based camera change the appearance of old scenes; they are not pixel-identical migrations.

## GPU regression checks

With the dev server running, open `/tests/gpu.html`. This runs a small 128-particle scene and reports shader compilation, adjacent-particle uniqueness, seeded replay, presentation/accumulation separation, resizing, trail reset, preset replacement, and control-panel initialization. It requires the same GPU features as the application.

For headless environments without a working canvas swapchain, `/tests/gpu.html?offscreen=1` exercises the compositor against a real GPU texture instead. This does not validate native canvas presentation.

The CPU suite does not substitute for these GPU checks. The current rendering remains point-based; the experimental bokeh renderer is not enabled in the editor.
