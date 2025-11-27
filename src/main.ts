import { Pipeline } from "./pipeline.ts";
import { SpawnSphereNode } from "./nodes/spawnSphere.ts";
import { IntegratorNode } from "./nodes/integrator.ts";
import { RenderParticlesNode } from "./nodes/renderParticles.ts";
import { CompositeNode } from "./nodes/composite.ts";
import { parseParticles, readGPUBuffer } from "./utils/debug.ts";
import { CurlNoiseNode } from "./nodes/curlNoise.ts";
import { ResetVelNode } from "./nodes/resetVel.ts";

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
  const device = await adapter.requestDevice({
    requiredFeatures: ["texture-formats-tier1", "texture-formats-tier2", "float32-filterable", "float32-blendable"]
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

  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({
    device,
    format: canvasFormat,
    alphaMode: "premultiplied",
  });

  // Simulation Parameters
  const particleCount = 500_00;
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;

  const pipeline = new Pipeline(device, ctx, {
    particleCount,
    renderWidth: canvas.width,
    renderHeight: canvas.height,
    particleTextureFormat: "rgba32float"
  })

  pipeline.addNode(new SpawnSphereNode());
  pipeline.addNode(new ResetVelNode());
  pipeline.addNode(new CurlNoiseNode());
  pipeline.addNode(new IntegratorNode());
  pipeline.addNode(new RenderParticlesNode());
  pipeline.addNode(new CompositeNode());

  await pipeline.init();

  let last = performance.now();

  function frame() {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;

    pipeline.frame(dt);

    // Debug once after spawn runs
    // if (pipeline.frameIndex === 2) {
    //   const size = pipeline.particleCount * 64;
    //   readGPUBuffer(device, pipeline.currentParticleBuffer, size).then(buf => {
    //       const arr = parseParticles(buf, pipeline.particleCount);
    //       console.table(arr);
    //   });
  // }
  
    requestAnimationFrame(frame);
  }

  frame();
  console.log("canvas size", canvas.width, canvas.height);
console.log("ctx format", navigator.gpu.getPreferredCanvasFormat());
console.log("render target view", pipeline.renderTextureView);
console.log("pipeline", pipeline);

}

main();