import { Pipeline } from '../src/pipeline.ts';
import { RenderParticlesNode } from '../src/nodes/renderParticles.ts';
import { CompositeNode } from '../src/nodes/composite.ts';
import { capturePrintScene, renderPrintBands } from '../src/rendering/printJob.ts';
import { defaultPrintSettings, type PrintSettings } from '../src/rendering/printSettings.ts';
import { apertureSample } from '../src/rendering/sampling.ts';
import { gradeChannel } from '../src/rendering/color.ts';
import { exportPrint } from '../src/export/printExport.ts';
import { BlobSink } from '../src/export/sink.ts';

const assert=(condition:unknown,message:string)=>{if(!condition) throw new Error(message);};
const signal=()=>new AbortController().signal;
export async function checkPrint(device:GPUDevice,source:Pipeline) {
  const scene=capturePrintScene(source);
  Object.assign(scene.renderer.props,{cameraPosition:[0,0,10],cameraTarget:[0,0,0],depthOfField:true,focusDistance:0.8,fStop:0.7});
  const settings:PrintSettings={...defaultPrintSettings(),width:65,height:49,tileSize:32,warmupSteps:2,accumulationSteps:3,lensSamples:8};
  (window as any).__printRecipe={scene,settings:{...settings,width:16,height:16,tileSize:16,lensSamples:2}};
  const originalFrame=source.frameIndex,originalTexture=source.renderTexture;
  const originalImage=await source.readHDRTexture();
  const collect=async(job:PrintSettings)=>{
    const image=new Float32Array(job.width*job.height*4);
    for await(const band of renderPrintBands(device,scene,job,signal())) image.set(band.data,band.y*job.width*4);
    return image;
  };
  const tiled=await collect(settings),whole=await collect({...settings,tileSize:128});
  const maxValue=Math.max(...whole);
  assert(maxValue>0,'Print fixture is blank');
  let maxDifference=0;
  for(let i=0;i<tiled.length;i++) maxDifference=Math.max(maxDifference,Math.abs(tiled[i]-whole[i]));
  assert(maxDifference/maxValue<0.0001,`Tile seam mismatch ${maxDifference/maxValue}`);
  const replay=await collect(settings);
  assert(replay.every((v,i)=>v===tiled[i]),'Print replay changed pixels');
  const gaussianTiled=await collect({...settings,renderer:'gaussian'}),gaussianWhole=await collect({...settings,renderer:'gaussian',tileSize:128});
  const gaussianPeak=Math.max(...gaussianWhole);
  assert(gaussianTiled.every((v,i)=>Math.abs(v-gaussianWhole[i])<gaussianPeak*0.0001),'Gaussian tile seam mismatch');
  assert(source.frameIndex===originalFrame && source.renderTexture===originalTexture,'Print changed live scene state');
  const after=await source.readHDRTexture();
  assert(after.data.every((v,i)=>v===originalImage.data[i]),'Print changed live accumulation');

  class TrackingSink extends BlobSink {
    didClose=false;didAbort=false;
    async close() {this.didClose=true;await super.close();}
    async abort() {this.didAbort=true;await super.abort();}
  }
  const controller=new AbortController(),cancelledSink=new TrackingSink();
  let aborted=false;
  try {await exportPrint(device,scene,settings,cancelledSink,controller.signal,()=>controller.abort());}
  catch(error) {aborted=error instanceof DOMException && error.name==='AbortError';}
  assert(aborted && cancelledSink.didAbort && !cancelledSink.didClose,'Cancellation committed a partial file');
  const completedSink=new TrackingSink();
  await exportPrint(device,scene,{...settings,width:16,height:16,tileSize:16,lensSamples:2},completedSink,signal());
  assert(completedSink.didClose && !completedSink.didAbort,'PNG export failed');
  const pngBytes=new Uint8Array(await completedSink.blob('image/png').arrayBuffer());
  assert(pngBytes[0]===137 && pngBytes[24]===16,'Print PNG is not 16-bit');
  const exrSink=new TrackingSink();
  await exportPrint(device,scene,{...settings,width:16,height:16,tileSize:16,lensSamples:2,format:'exr'},exrSink,signal());
  assert(exrSink.didClose && new DataView(await exrSink.blob('').arrayBuffer()).getUint32(0,true)===20000630,'Print EXR failed');

  // Isolated point: observe actual aperture shape without simulation/lifetime noise.
  const fixture=new Pipeline(device,source.ctx,{particleCount:1,renderWidth:96,renderHeight:96,particleTextureFormat:'rgba32float'});
  const render=new RenderParticlesNode();Object.assign(render,{renderMode:'splats',blendMode:'additive',cameraPosition:[0,0,10],cameraTarget:[0,0,0],depthOfField:true,focusDistance:0.3,fStop:0.7});
  fixture.addNode(render);await fixture.init();
  const particle=new ArrayBuffer(80),f=new Float32Array(particle),u=new Uint32Array(particle);
  f.set([1,0.5,0.2,1],8);f[15]=1;u[16]=1;device.queue.writeBuffer(fixture.currentParticleBuffer,0,particle);
  const lensImage=async(blades:number,count:number,rotation=0)=>{
    for(let i=0;i<count;i++) {
      const sample=apertureSample(i,count,blades,rotation,345);
      const encoder=device.createCommandEncoder();
      render.record(encoder,{device,queue:device.queue,particleSrc:fixture.currentParticleBuffer,particleCount:1,
        particleRenderTarget:fixture.renderTextureView,renderTextureWidth:192,renderTextureHeight:192,
        accumulationFrameIndex:i,lensSample:[...sample,1/count,1]});
      device.queue.submit([encoder.finish()]);
      if(i%32===31) await device.queue.onSubmittedWorkDone();
    }
    return fixture.readHDRTexture();
  };
  const circle=await lensImage(0,256),triangle=await lensImage(3,256),rotated=await lensImage(3,256,60),low=await lensImage(0,16);
  const energy=(data:Float32Array)=>data.reduce((sum,v,i)=>sum+(i%4===0?v:0),0);
  for(const image of [circle,triangle,rotated,low]) assert(Math.abs(energy(image.data)-1)<0.001,'Lens samples changed total brightness');
  assert(triangle.data.some((v,i)=>Math.abs(v-circle.data[i])>0.001),'Polygon aperture matches circle');
  assert(triangle.data.some((v,i)=>Math.abs(v-rotated.data[i])>0.001),'Aperture rotation did not change image');
  render.focusDistance=10;
  const focused=await lensImage(3,32);
  assert(focused.data.reduce((a,b)=>Math.max(a,b),0)>triangle.data.reduce((a,b)=>Math.max(a,b),0)*5,'Sampled lens did not focus');

  // Check compositor orientation and CPU/GPU grade agreement using distinct top/bottom rows.
  const tex=device.createTexture({size:[2,2],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const input=new Float32Array([0.1,0.2,0.3,1,0.4,0.5,0.6,1,0.7,0.8,0.9,1,2,0.02,0.04,1]);
  device.queue.writeTexture({texture:tex},input,{bytesPerRow:32},{width:2,height:2});
  const output=device.createTexture({size:[2,2],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const composite=new CompositeNode();composite.targetFormat='rgba32float';composite.exposureEV=1;composite.whiteBalance=[1.2,0.8,1];await composite.init(device,{});
  const outputView=output.createView(),inputView=tex.createView();
  const read=async()=>{
    const encoder=device.createCommandEncoder();composite.record(encoder,{device,queue:device.queue,particleRenderTarget:inputView,canvasView:outputView});
    const buffer=device.createBuffer({size:512,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    encoder.copyTextureToBuffer({texture:output},{buffer,bytesPerRow:256},{width:2,height:2});device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);const data=new Float32Array(buffer.getMappedRange().slice(0));buffer.unmap();buffer.destroy();return data;
  };
  for(const toneMap of ['aces','reinhard','linear'] as const) {
    composite.toneMap=toneMap;const result=await read();
    for(let y=0;y<2;y++) for(let x=0;x<2;x++) for(let c=0;c<3;c++) {
      assert(Math.abs(result[y*64+x*4+c]-gradeChannel(input[(y*2+x)*4+c],c,composite))<0.00001,'Preview/export color or orientation mismatch');
    }
  }
  composite.showClipping=true;const clipped=await read();
  assert(clipped[64+4]===1 && clipped[64+5]===0 && clipped[64+6]===1,'Clipping overlay missing');
  composite.applyToneMap=false;const hdr=await read();
  assert(Math.abs(hdr[68]-4.8)<0.00001,'HDR preview clipped or tone-mapped scene values');
  composite.dispose();tex.destroy();output.destroy();fixture.dispose();

  const gallery=document.createElement('section');gallery.style.cssText='display:flex;gap:16px;background:#171b24;color:white;padding:16px;';
  for(const [label,image] of [['Circular pupil',circle],['Triangle pupil',triangle],['Rotated triangle',rotated],['Focused',focused]] as const) {
    const figure=document.createElement('figure');figure.style.margin='0';
    const caption=document.createElement('figcaption');caption.textContent=label;
    const canvas=document.createElement('canvas');canvas.width=192;canvas.height=192;
    const pixels=new ImageData(192,192);
    for(let i=0;i<image.data.length;i+=4) {for(let c=0;c<3;c++) pixels.data[i+c]=255*Math.pow(1-Math.exp(-image.data[i+c]*200),1/2.2);pixels.data[i+3]=255;}
    canvas.getContext('2d')!.putImageData(pixels,0,0);figure.append(caption,canvas);gallery.append(figure);
  }
  document.body.append(gallery);
  return {tileRelativeError:maxDifference/maxValue,checks:['lens and Gaussian tiled/untiled agreement','bitwise seeded print replay','live scene preserved','cancel aborts output','16-bit PNG and float EXR exports','circular and rotated polygon pupils','lens energy and focus','CPU/GPU color and top-down orientation','clipping overlay and HDR range']};
}
