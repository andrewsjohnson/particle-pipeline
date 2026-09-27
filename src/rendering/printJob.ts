import { Pipeline } from '../pipeline.ts';
import { serializeNode, deserializeNodes, type SerializedNode } from '../presets.ts';
import { RenderParticlesNode } from '../nodes/renderParticles.ts';
import { CompositeNode } from '../nodes/composite.ts';
import { apertureSample } from './sampling.ts';
import { defaultColor, type ColorSettings } from './color.ts';
import { printEstimate, validatePrintSettings, type PrintSettings } from './printSettings.ts';

export type PrintScene = {
  version: 1; particleCount: number; baseOpacity: number; randomSeed: number;
  compute: SerializedNode[]; renderer: SerializedNode; color: ColorSettings;
};
export type PrintProgress = {completed:number; total:number; phase:string; tile:number; tiles:number};
export type PrintBand = {y:number; width:number; height:number; data:Float32Array};
export function capturePrintScene(source: Pipeline): PrintScene {
  const renderer = source.renderNodes.find(node => node instanceof RenderParticlesNode);
  if (!renderer) throw new Error('A particle renderer is required');
  const composite = source.renderNodes.find(node => node instanceof CompositeNode);
  return {version:1, particleCount:source.particleCount, baseOpacity:source.baseOpacity, randomSeed:source.randomSeed,
    compute:source.computeNodes.map(serializeNode), renderer:serializeNode(renderer),
    color:composite ? {exposureEV:composite.exposureEV,whiteBalance:[...composite.whiteBalance],toneMap:composite.toneMap} : defaultColor()};
}

/** Replays the same fixed-step scene per tile, with tile-independent lens samples.
 * Yields top-down bands. Consumer backpressure bounds CPU/GPU memory. */
export async function* renderPrintBands(device: GPUDevice, scene: PrintScene, settings: PrintSettings,
  signal: AbortSignal, onProgress: (progress:PrintProgress)=>void = () => {}): AsyncGenerator<PrintBand> {
  validatePrintSettings(settings, device.limits.maxTextureDimension2D);
  const estimate=printEstimate(settings,scene.particleCount);
  if (estimate.tiles>1 && scene.compute.some(node => node.type==='flocking')) {
    throw new Error('Tiled printing cannot replay the nondeterministic flocking node. Remove it or use a single tile.');
  }
  if (scene.compute[0]?.type!=='init') throw new Error('Printing requires InitializeParticles as the first node');
  const checkAbort = () => {if(signal.aborted) throw new DOMException('Render cancelled','AbortError');};
  checkAbort();
  const renderer=deserializeNodes([scene.renderer],'render')[0];
  if (!(renderer instanceof RenderParticlesNode)) throw new Error('Recipe must contain a particle renderer');
  const compute=deserializeNodes(scene.compute,'compute');
  // No canvas/swapchain access is needed by offline simulation or accumulation.
  const context={canvas:{width:1,height:1}} as GPUCanvasContext;
  const pipeline=new Pipeline(device,context,{particleCount:scene.particleCount,
    renderWidth:settings.tileSize/2, renderHeight:settings.tileSize/2, particleTextureFormat:'rgba32float'});
  pipeline.baseOpacity=scene.baseOpacity; pipeline.randomSeed=scene.randomSeed;
  renderer.renderMode='splats'; renderer.blendMode='additive'; renderer.clearMode='accumulate';
  for(const node of compute) pipeline.addNode(node);
  pipeline.addNode(renderer);
  const samples=settings.renderer==='lens' ? settings.lensSamples : 1;
  const workPerTile=settings.warmupSteps+settings.accumulationSteps*(1+samples);
  const total=estimate.tiles*workPerTile;
  let completed=0, tile=0, pending=0;
  let lost='';
  const onError=(event:GPUUncapturedErrorEvent)=>{lost=event.error.message;};
  device.addEventListener('uncapturederror',onError);
  let active=true;
  void device.lost.then(info=>{if(active) lost=info.message || 'GPU device lost';});
  const checkpoint=async(phase:string, force=false) => {
    checkAbort();
    if(lost) throw new Error(lost);
    if(++pending>=8 || force) {
      // Bound queued GPU work; cancellation is observed at least every eight submissions.
      await device.queue.onSubmittedWorkDone();
      onProgress({completed,total,phase,tile,tiles:estimate.tiles});
      await new Promise(resolve=>setTimeout(resolve,0));
      pending=0; checkAbort();
      if(lost) throw new Error(lost);
    }
  };
  try {
    await pipeline.init();
    for(const node of [...pipeline.computeNodes,renderer]) node.freezeShaders();
    checkAbort();
    for(let y=0;y<settings.height;y+=settings.tileSize) {
      const height=Math.min(settings.tileSize,settings.height-y);
      const band=new Float32Array(settings.width*height*4);
      for(let x=0;x<settings.width;x+=settings.tileSize) {
        tile++;
        const width=Math.min(settings.tileSize,settings.width-x);
        pipeline.resizeRenderTarget(width/2,height/2);
        // Reuse allocations and zero padding as well as particle state for exact replay.
        const clear=device.createCommandEncoder();
        clear.clearBuffer(pipeline.particleA); clear.clearBuffer(pipeline.particleB);
        device.queue.submit([clear.finish()]);
        pipeline.frameIndex=0; pipeline.accumulationFrameIndex=0;
        for(let i=0;i<settings.warmupSteps;i++) {
          if(!pipeline.computeNodes.every(node=>node.ready)) throw new Error('A shader changed during rendering; restart the job');
          pipeline.step(false); completed++; await checkpoint('Warming up');
        }
        let imageSample=0;
        for(let step=0;step<settings.accumulationSteps;step++) {
          if(![...pipeline.computeNodes,renderer].every(node=>node.ready)) throw new Error('A shader changed during rendering; restart the job');
          pipeline.step(false); completed++; await checkpoint('Simulating');
          for(let sample=0;sample<samples;sample++) {
            const pupil=apertureSample(sample,samples,Math.max(0,Math.min(16,Math.round(renderer.apertureBlades))),
              renderer.apertureRotation, scene.randomSeed ^ Math.imul(step,0x9e3779b9));
            const encoder=device.createCommandEncoder();
            renderer.record(encoder,{device,queue:device.queue,particleSrc:pipeline.currentParticleBuffer,
              particleCount:scene.particleCount,particleRenderTarget:pipeline.renderTextureView,
              renderTextureWidth:width,renderTextureHeight:height,fullWidth:settings.width,fullHeight:settings.height,
              tileX:x,tileY:y,accumulationFrameIndex:imageSample++,
              lensSample:[pupil[0],pupil[1],1/samples,settings.renderer==='lens'?1:0]});
            device.queue.submit([encoder.finish()]);
            completed++; await checkpoint('Sampling lens');
          }
        }
        await checkpoint('Reading tile',true);
        const result=await pipeline.readHDRTexture();
        for(let row=0;row<height;row++) {
          band.set(result.data.subarray(row*width*4,(row+1)*width*4),((row*settings.width)+x)*4);
        }
      }
      checkAbort();
      yield {y,width:settings.width,height,data:band};
    }
    onProgress({completed:total,total,phase:'Encoding',tile,tiles:estimate.tiles});
  } finally {
    active=false;
    device.removeEventListener('uncapturederror',onError);
    pipeline.dispose();
  }
}
