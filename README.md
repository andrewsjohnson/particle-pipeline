# Particle Pipeline

A TypeScript/WebGPU particle-art playground with editable compute nodes, floating-point accumulation, and EXR/Radiance HDR export.

## View online

GitHub Pages URL (after the first successful deployment): **https://andrewsjohnson.github.io/particle-pipeline/**

`.github/workflows/pages.yml` tests and builds pull requests, then publishes `dist/` on every push to `master`. For initial setup, select **Settings → Pages → Build and deployment → Source → GitHub Actions**. If setup happens after a failed deployment, rerun the **GitHub Pages** workflow from Actions. A private repository requires a GitHub plan that supports Pages; the standard Pages site is public.

The hosted app requires the same WebGPU features listed below. Production builds and `pnpm preview` use `/particle-pipeline/`; local development stays at `/`. Presets are stored per browser origin, so localhost presets do not automatically appear on the hosted site.

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
- Pause freezes simulation and accumulation. Camera edits replace the image with a snapshot of the frozen particles; display/HDR changes remain visible. Resizing clears accumulated pixels but keeps particle positions, velocities, and ages.
- Curl's **Follow flow** mode sets velocity from the field. **Apply force** adds acceleration multiplied by the fixed timestep. **Legacy per-step** retains the earlier velocity-kick interpretation for old presets. The integrator retains the existing inverse-mass motion scaling.
- **Normalize field** retains the constant-speed artistic behavior. Turning it off preserves field-magnitude variation. Normalization generally does not preserve a curl field's divergence-free property.
- `pipeline.step()` advances exactly one simulation/accumulation step; `pipeline.present()` displays without advancing. Matching seed, parameters, node order, and step count gives repeatable results on the same GPU for the default pipeline. Cross-device bitwise equivalence is not promised; flocking's atomic bucket ordering can also introduce nondeterminism.

## Camera and Gaussian splats

In **RenderParticles**, change **Particle shape** from **Points** to **Gaussian**. Points remain the default for existing scenes and large particle counts. Expand **Camera & focus** to set eye/target positions, vertical field of view, and optional depth of field. Camera and lens edits discard the previous accumulated view without restarting the simulation, including while paused.

- **Sharp sigma (px)** is the Gaussian standard deviation in the HDR target's pixels (the target is twice the canvas resolution in each dimension).
- **Focus distance** is measured along the camera's forward axis in world units. **Meters per unit** sets scene scale. A fixed 24 mm sensor height and vertical FOV determine focal length. Lower **fStop** produces more defocus; focus beyond the lens's focal length is enforced internally.
- The thin-lens circle of confusion sets a Gaussian's variance. This is a smooth approximation, not a polygonal aperture or an occlusion-aware lens simulation. **Blur limit (px)** caps sigma to bound fragment work; the shader truncates at three sigma.
- The shader integrates each pixel's Gaussian footprint and normalizes both RGB and alpha. An isolated particle retains its total energy as its size changes, except when clipped by the viewport. Use **Additive** for light accumulation; **Normal** remains order-dependent alpha compositing, so overlapping particles can attenuate one another.

Large splats can be expensive at millions of particles. Start with points, then enable Gaussian rendering and adjust the blur limit. Bind groups are cached across stable frames for both modes; cache entries track pipeline, buffer/range, and texture identity, and are bounded and cleared on disposal/hot reload. This reduces CPU setup, not simulation bandwidth or splat fill cost.

## Presets

Presets are saved in browser local storage. Version 2 saves explicit editable parameters for every registered node, including drag and lifespan. Invalid/unknown nodes fail visibly instead of disappearing. Runtime resources and the current display format are not serialized.

Older unversioned presets still load and retain legacy curl semantics. Settings that old builds never saved (notably omitted drag/lifespan nodes) cannot be recovered from those files. Corrected random initialization and the degree-based camera change the appearance of old scenes; they are not pixel-identical migrations.

## GPU regression checks

With the dev server running, open `/tests/gpu.html`. This runs a small 128-particle scene and reports shader compilation, adjacent-particle uniqueness, seeded replay, presentation/accumulation separation, resizing, trail reset, preset replacement, and control-panel initialization. It requires the same GPU features as the application.

For headless environments without a working canvas swapchain, `/tests/gpu.html?offscreen=1` exercises the compositor against a real GPU texture instead. This does not validate native canvas presentation.

The suite also checks splat RGB/alpha energy across sizes and subpixel offsets, lens focus/f-stop behavior, paused camera changes, culling, degenerate camera controls, and actual bind-group creation counts. The page displays focused/defocused/stopped-down float-texture readbacks. In the 128-particle regression fixture, 20 warmed simulation/presentation cycles create **0 cached versus 160 uncached bind groups**. This is an allocation measurement, not an FPS claim; hardware performance still needs profiling on your GPU.

The CPU suite does not substitute for these GPU checks. The older experimental `RenderBokehParticlesNode` remains outside the editor; the supported Gaussian path is part of `RenderParticlesNode`.
