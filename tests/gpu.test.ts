import { checkPrint } from "./print.gpu.ts";
import { BindGroupCache } from "../src/utils/bindGroupCache.ts";
import { checkRenderer } from "./renderer.gpu.ts";
import { Pipeline } from '../src/pipeline.ts';
import { computeNodeTypes, serializeNode, deserializeNodes } from '../src/presets.ts';
import { InitializeParticlesNode } from '../src/nodes/initializeParticles.ts';
import { SpawnSphereNode } from '../src/nodes/spawnSphere.ts';
import { SetSpawnMassNode } from '../src/nodes/setSpawnMass.ts';
import { SetSpawnLifespanNode } from '../src/nodes/setSpawnLifespan.ts';
import { CurlNoiseNode } from '../src/nodes/curlNoise.ts';
import { IntegratorNode } from '../src/nodes/integrator.ts';
import { OpacityScaleNode } from '../src/nodes/opacityScale.ts';
import { RenderParticlesNode } from '../src/nodes/renderParticles.ts';
import { CompositeNode } from '../src/nodes/composite.ts';
import { buildControlPanel } from '../src/ui/controlPanel.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run() {
  const adapter = await navigator.gpu?.requestAdapter();
  assert(adapter, 'WebGPU adapter unavailable');
  const features: GPUFeatureName[] = ['float32-filterable', 'float32-blendable'];
  assert(features.every(feature => adapter.features.has(feature)), 'Float32 render features unavailable');
  const device = await adapter.requestDevice({requiredFeatures: features});
  let bindGroupCreations = 0;
  const createBindGroup = device.createBindGroup.bind(device);
  device.createBindGroup = descriptor => {bindGroupCreations++; return createBindGroup(descriptor);};
  const errors: string[] = [];
  device.lost.then(info=>console.error('GPU device lost',info.reason,info.message));
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const canvas = document.querySelector('canvas')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  const offscreen = new URLSearchParams(location.search).has('offscreen');
  // Software/headless environments may support WebGPU but lack a canvas swapchain.
  // This exercises the real GPU compositor, but not native canvas presentation.
  const target = offscreen ? device.createTexture({size:[96,64],format,usage:GPUTextureUsage.RENDER_ATTACHMENT}) : null;
  const ctx = target
    ? {canvas,getCurrentTexture:()=>target} as unknown as GPUCanvasContext
    : canvas.getContext('webgpu')!;
  if (!offscreen) ctx.configure({device, format});
  const pipeline = new Pipeline(device,ctx,{particleCount:128,renderWidth:96,renderHeight:64,particleTextureFormat:'rgba32float'});
  const curl = new CurlNoiseNode(); curl.octaves=2;
  const compute = [new InitializeParticlesNode(),new SpawnSphereNode(),new SetSpawnMassNode(),new SetSpawnLifespanNode(),curl,new IntegratorNode(),new OpacityScaleNode()];
  const render = new RenderParticlesNode();
  const composite = new CompositeNode(); composite.targetFormat=format;
  for(const node of [...compute,render,composite]) pipeline.addNode(node);
  await pipeline.init();

  // All selectable compute shaders must compile, including optional effects.
  for(const definition of computeNodeTypes) {
    const node = new definition.ctor();
    await node.init(device,{});
    node.dispose();
  }

  async function readParticles() {
    const buffer=device.createBuffer({size:128*80,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const encoder=device.createCommandEncoder();
    encoder.copyBufferToBuffer(pipeline.currentParticleBuffer,0,buffer,0,128*80);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(buffer.getMappedRange().slice(0));
    buffer.unmap(); buffer.destroy();
    return data;
  }

  pipeline.setRandomSeed(12345);
  pipeline.step();
  const initial=await readParticles();
  for(let i=0;i<128;i+=2) {
    assert(initial[i*20]!==initial[(i+1)*20] || initial[i*20+1]!==initial[(i+1)*20+1],`Particles ${i}/${i+1} share a position`);
  }
  const runSteps=async()=>{ for(let i=0;i<8;i++) pipeline.step(); return readParticles(); };
  const first=await runSteps();
  pipeline.setRandomSeed(12345); pipeline.step();
  const second=await runSteps();
  assert(new Uint8Array(first.buffer).every((byte,i)=>byte===new Uint8Array(second.buffer)[i]),'Seeded simulation is not repeatable');

  // Warm both ping-pong buffer combinations, then count actual WebGPU allocations.
  for(let i=0;i<4;i++) {pipeline.step(); pipeline.present();}
  const bindingsBefore=bindGroupCreations;
  for(let i=0;i<20;i++) {pipeline.step(); pipeline.present();}
  const steadyStateBindings=bindGroupCreations-bindingsBefore;
  assert(steadyStateBindings===0, `Steady-state frames created ${steadyStateBindings} bind groups`);

  const cachedGet = BindGroupCache.prototype.get;
  const uncachedBefore=bindGroupCreations;
  try {
    BindGroupCache.prototype.get = (device,pipeline,entries) => device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries});
    for(let i=0;i<20;i++) {pipeline.step(); pipeline.present();}
  } finally { BindGroupCache.prototype.get = cachedGet; }
  const uncachedBindings=bindGroupCreations-uncachedBefore;
  assert(uncachedBindings===160, `Unexpected uncached allocation count: ${uncachedBindings}`);

  // Presentation refreshes must not accumulate samples or move particles.
  const before = await pipeline.readHDRTexture();
  const frames=pipeline.frameIndex;
  for(let i=0;i<5;i++) pipeline.present();
  const after = await pipeline.readHDRTexture();
  assert(pipeline.frameIndex===frames,'Presentation advanced simulation');
  assert(before.data.every((value,i)=>value===after.data[i]),'Presentation changed accumulation');
  pipeline.resizeRenderTarget(80,60);
  assert(pipeline.frameIndex===frames,'Resize reset simulation');

  // Reset in trail mode must clear old pixels, including while paused.
  render.clearMode='trail';
  pipeline.resetSimulation();
  const cleared=await pipeline.readHDRTexture();
  assert(cleared.data.every(value=>value===0),'Reset retained trail history');
  pipeline.step(); pipeline.present();

  // Preset round-trip initializes replacement nodes against the active format.
  const replacementCompute=deserializeNodes(compute.map(serializeNode),'compute');
  const replacementRender=deserializeNodes([render,composite].map(serializeNode),'render');
  (replacementRender[1] as CompositeNode).targetFormat=format;
  await pipeline.setNodes(replacementCompute as any,replacementRender as any);
  pipeline.step(); pipeline.present();
  buildControlPanel({pipeline,simState:{paused:true},hdrEnabled:false,onPauseChange:()=>{},onReset:()=>pipeline.resetSimulation(),onSaveExr:async()=>{},onSaveHdr:async()=>{},onToggleHdr:()=>{}});

  const renderer = await checkRenderer(device,ctx);
  const print = await checkPrint(device,pipeline);
  await device.queue.onSubmittedWorkDone();
  await new Promise(resolve=>setTimeout(resolve,100));
  assert(errors.length===0,errors.join('\n'));
  return {passed:true,print,renderer,steadyStateBindings,uncachedBindings,checks:['all compute shaders','distinct adjacent particles','repeatable seeded steps','presentation does not accumulate','resize preserves simulation','trail reset','GPU preset round-trip','control panel'],presentation:offscreen?'offscreen GPU texture':'canvas',adapter:adapter.info.description};
}

run().then(result=>{
  document.querySelector('#result')!.textContent=JSON.stringify(result,null,2);
  (window as any).__gpuResult=result;
}).catch(error=>{
  const result={passed:false,error:String(error)};
  document.querySelector('#result')!.textContent=JSON.stringify(result,null,2);
  (window as any).__gpuResult=result;
  console.error(error);
});
