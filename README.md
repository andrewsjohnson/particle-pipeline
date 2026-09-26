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

## Print renders and sampled lenses

Open **Print render** to choose output pixels, DPI, warm-up steps, accumulation steps, and renderer. Rendering restarts a private copy of your scene from its saved seed. It preserves the live simulation and image, and temporarily pauses the preview to leave GPU time for the job.

1. Compose in points or Gaussian preview. In **Camera & focus**, enable **Depth of field**, set focus distance/f-stop, and choose a circular or polygonal **Print aperture** and rotation.
2. In **Composite**, adjust **Exposure (stops)**, **White balance** RGB gains, and **Tone mapping** (Filmic, Reinhard, or Linear). These changes work while paused without accumulating more particles. **Show clipped highlights** marks channels that will reach the SDR ceiling in magenta; this diagnostic is never baked into exports.
3. In **Print render**, choose **Sampled lens** for aperture-shaped bokeh or **Fast Gaussian** for a quicker approximation. Begin with a small output. Increase **Lens samples/step** for smoother defocus; 32 is a starting point, while large isolated bokeh may need hundreds or more. Lens sampling respects the camera's depth-of-field switch. **Blur limit** applies only to Gaussian mode; the sampled lens uses small reconstruction footprints at the displaced sample positions.
4. Choose the file format and click **Render and save**. Progress shows warm-up, simulation, lens sampling, and tile readback. **Cancel render** stops after bounded queued work and aborts the output. Save the render recipe from the completion screen, then use **Load render recipe** to restore the scene, color, seed, and output settings later.

**PNG** is streamed, 16-bit RGB with sRGB encoding and DPI metadata, with exposure/white balance/tone mapping applied. **EXR** is streamed, uncompressed float32 RGB with linear sRGB primaries, ungraded values, and embedded render-recipe metadata. Both use top-down rows and match the preview's orientation. EXR deliberately retains brightness above 1 for later grading. The existing immediate EXR/HDR capture buttons still save the current accumulated image.

Output dimensions are independent of the canvas. A 30 × 40 inch image at 300 DPI is **9000 × 12000 pixels**; DPI changes metadata/physical size, not pixel count. Jobs support up to 150 megapixels and 30,000 pixels per side, subject to validated band and GPU limits. These are input limits, not a guarantee that every device can finish a large job.

Chrome/Edge's direct file-save API streams output to disk where available. Other browsers download a Blob capped at 512 MiB and reject jobs whose estimated uncompressed size is too large. A 9000 × 12000 float RGB EXR is approximately 1.3 GB and needs direct file saving. Browser/OS permissions and storage space still apply.

### Rendering semantics and costs

- The sampled renderer integrates area-uniform points on a circular pupil or a regular polygon. All projections coincide at the focus plane; defocus reverses across it. It uses a geometric thin-lens model and a small pixel-integrated Gaussian reconstruction filter. It does **not** model lens aberrations, diffraction, occlusion, scattering, or aperture-dependent exposure. Apertures are normalized to keep artistic brightness independent of sample count and f-stop.
- Print jobs use **additive light accumulation** regardless of the live renderer's blend/clear/trail modes. Lens samples are averaged for each particle state; simulation steps are summed to build trails. Doubling lens samples improves convergence, while doubling accumulation duration can add more light. Warm-up steps do not contribute light. The timestep is 1/60 second.
- Tiles use the full image's camera and pixel scale. Each tile replays the same simulation from its seed, avoiding a full-size GPU texture or a stored history of particle positions. This trades extra simulation work for bounded image memory. Smaller tiles save memory but repeat more work. Print dimensions can exceed the GPU's maximum texture size.
- The isolated job adds two particle buffers (160 bytes per particle), its tile texture, node resources, and a CPU output band. At three million particles the extra particle buffers alone are about 458 MiB. The panel reports an estimate. A small tile does not reduce particle-buffer memory.
- The atomic flocking node cannot guarantee identical replay, so multi-tile jobs reject it explicitly. Single-tile flocking works but remains nondeterministic. Default-node replay is repeatable on the same GPU/build; cross-device bitwise identity is not guaranteed.
- Color controls use linear-sRGB input and the sRGB transfer function for SDR/PNG. The old preview's approximate gamma and vertical inversion have been corrected, so existing compositions may look slightly different. HDR display preserves graded linear values without SDR tone mapping or clipping diagnostics.

### Print verification

`npm run check` covers aperture sampling, print preflight, recipe validation, PNG chunks/DPI/16-bit samples, EXR offsets/channel order, color math, cancellation, and stream errors. `/tests/gpu.html?offscreen=1` additionally compares tiled/untiled lens and Gaussian renders, repeats a print bit-for-bit, checks live-state preservation and aborted outputs, and verifies GPU/CPU color and orientation agreement. Its gallery shows actual circular, triangular, rotated, and focused readbacks. Headless checks use real GPU textures but do not validate native canvas presentation or physical-GPU throughput.

Technical references: [PBRT projective cameras](https://www.pbr-book.org/4ed/Cameras_and_Film/Projective_Camera_Models), [PNG specification](https://www.w3.org/TR/png-3/), [OpenEXR file layout](https://openexr.com/en/latest/OpenEXRFileLayout.html).
