import { encodeRGBE } from "./export/rgbe.ts";
import { writeEXR } from "./export/exr.ts";
import { BlobSink, downloadBlob } from "./export/sink.ts";
import { PARTICLE_SIZE } from "./particles/particleLayout.ts";
import { Pipeline } from "./pipeline.ts";
import { SpawnSphereNode } from "./nodes/spawnSphere.ts";
import { IntegratorNode } from "./nodes/integrator.ts";
import { RenderParticlesNode } from "./nodes/renderParticles.ts";
import { CompositeNode } from "./nodes/composite.ts";
// import { parseParticles, readGPUBuffer } from "./utils/debug.ts";
import { CurlNoiseNode } from "./nodes/curlNoise.ts";
import { DragNode } from "./nodes/drag.ts";
import { SetSpawnColorNode } from "./nodes/setSpawnColor.ts";
import { SetSpawnMassNode } from "./nodes/setSpawnMass.ts";
import { InitializeParticlesNode } from "./nodes/initializeParticles.ts";
import { MinVelKillNode } from "./nodes/minVelKill.ts";
import { SetSpawnLifespanNode } from "./nodes/setSpawnLifespan.ts";
import { OpacityScaleNode } from "./nodes/opacityScale.ts";
import { buildControlPanel } from "./ui/controlPanel.ts";

async function main() {
  const canvas = document.getElementById("gfx") as HTMLCanvasElement;

  if (!navigator.gpu) {
    alert("WebGPU not supported");
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    alert("No WebGPU adapter found");
    return;
  }

  const features: GPUFeatureName[] = ["float32-filterable", "float32-blendable"];
  const missing = features.filter((feature) => !adapter.features.has(feature));
  if (missing.length) throw new Error(`This GPU lacks the floating-point rendering features: ${missing.join(", ")}`);
  const bufferLimit = Math.min(6_000_000 * PARTICLE_SIZE, adapter.limits.maxBufferSize, adapter.limits.maxStorageBufferBindingSize);
  const device = await adapter.requestDevice({
    requiredFeatures: features,
    requiredLimits: {
      maxBufferSize: bufferLimit,
      maxStorageBufferBindingSize: bufferLimit,
    },
  });

  if (!device) {
    alert("No WebGPU device found");
    return;
  }

  const ctx = canvas.getContext("webgpu");
  if (!ctx) {
    alert("No WebGPU context found");
    return;
  }

  // Simulation Parameters
  const particleCount = Math.min(3_000_000, Math.floor(bufferLimit / PARTICLE_SIZE));
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;

  const pipeline = new Pipeline(device, ctx, {
    particleCount,
    renderWidth: canvas.width,
    renderHeight: canvas.height,
    particleTextureFormat: "rgba32float"
  })

  const renderParticlesNode = new RenderParticlesNode();
  const compositeNode = new CompositeNode();

  const hdrState = { enabled: false };
  const configureCanvas = (enableHdr: boolean) => {
    hdrState.enabled = enableHdr;
    const format: GPUTextureFormat = enableHdr
      ? "rgba16float"
      : navigator.gpu.getPreferredCanvasFormat();

    // If node isn't initialized yet, it will pick up targetFormat during init.
    // Preset loading replaces nodes; always configure the active composite.
    const composites = pipeline.renderNodes.filter((node): node is CompositeNode => node instanceof CompositeNode);
    for (const node of composites.length ? composites : [compositeNode]) {
      node.setTargetFormat(format, device);
      node.setToneMapping(!enableHdr, device);
    }

    ctx.configure({
      device,
      format,
      alphaMode: "premultiplied",
      toneMapping: { mode: enableHdr ? "extended" : "standard" },
    });
  };

  configureCanvas(hdrState.enabled);

  pipeline.addNode(new InitializeParticlesNode());
  pipeline.addNode(new SpawnSphereNode());
  pipeline.addNode(new SetSpawnColorNode());  
  pipeline.addNode(new SetSpawnMassNode());
  pipeline.addNode(new SetSpawnLifespanNode());
  pipeline.addNode(new DragNode());
  pipeline.addNode(new CurlNoiseNode());
  // pipeline.addNode(new FlockingNode());
  pipeline.addNode(new IntegratorNode());
  pipeline.addNode(new MinVelKillNode());
  pipeline.addNode(new OpacityScaleNode());
  pipeline.addNode(renderParticlesNode);
  pipeline.addNode(compositeNode);

  await pipeline.init();

  const simState = { paused: false };
  let printBusy = false;
  const updateCanvasSize = () => {
    if (printBusy) return;
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    pipeline.resizeRenderTarget(canvas.width, canvas.height);
  };
  updateCanvasSize();

  buildControlPanel({
    pipeline,
    simState,
    hdrEnabled: hdrState.enabled,
    onPauseChange: (paused) => {
      simState.paused = paused;
      pipeline.resetClock();
      last = performance.now();
    },
    onReset: () => {
      updateCanvasSize();
      pipeline.resetSimulation();
    },
    onToggleHdr: (enabled) => {
      configureCanvas(enabled);
    },
    onPrintBusy: (busy) => {
      printBusy = busy;
      pipeline.resetClock(); last = performance.now();
      if (!busy) updateCanvasSize();
    },
    onSaveExr: async () => {
      const image = await pipeline.readHDRTexture();
      const sink = new BlobSink();
      await writeEXR(sink, image.width, image.height, (async function*() {yield {...image,y:0};})(), new AbortController().signal);
      await sink.close();
      downloadBlob(sink.blob("application/octet-stream"), `particles-${Date.now()}.exr`);
    },
    onSaveHdr: async () => {
      const {width,height,data} = await pipeline.readHDRTexture();
      const bytes = encodeRGBE(data,width,height);
      downloadBlob(new Blob([new Uint8Array(bytes)], {type:"application/octet-stream"}), `particles-${Date.now()}.hdr`);
    },
  });

  let last = performance.now();

  function frame() {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;

    if (printBusy) {
      requestAnimationFrame(frame);
      return;
    }
    if (!simState.paused) {
      pipeline.frame(dt);
    } else {
      pipeline.present();
    }

    // Debug once after spawn runs
  //   if (pipeline.frameIndex === 2) {
  //     const size = pipeline.particleCount * PARTICLE_SIZE;
  //     readGPUBuffer(device, pipeline.currentParticleBuffer, size).then(buf => {
  //         const arr = parseParticles(buf, pipeline.particleCount);
  //         console.table(arr);
  //     });
  // }

    requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", () => {
    last = performance.now();
    pipeline.resetClock();
  });
  window.addEventListener("resize", updateCanvasSize);
  frame();
  console.log("canvas size", canvas.width, canvas.height);
  console.log("ctx format", navigator.gpu.getPreferredCanvasFormat());
  console.log("render target view", pipeline.renderTextureView);
  console.log("pipeline", pipeline);
}

main().catch((error: unknown) => {
  console.error(error);
  const message = document.createElement("pre");
  message.style.cssText = "position:fixed;inset:24px;color:white;white-space:pre-wrap;font:16px sans-serif";
  message.textContent = `Unable to start Particle Pipeline: ${error instanceof Error ? error.message : error}`;
  document.body.appendChild(message);
});