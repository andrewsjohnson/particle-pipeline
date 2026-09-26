import { Pipeline } from '../src/pipeline.ts';
import { RenderParticlesNode } from '../src/nodes/renderParticles.ts';

export async function checkRenderer(device: GPUDevice, context: GPUCanvasContext) {
  const pipeline = new Pipeline(device, context, {particleCount:1,renderWidth:128,renderHeight:96,particleTextureFormat:'rgba32float'});
  const render = new RenderParticlesNode();
  Object.assign(render, {renderMode:'splats', blendMode:'additive', cameraPosition:[0,0,10], cameraTarget:[0,0,0]});
  pipeline.addNode(render);
  await pipeline.init();
  const particle = new ArrayBuffer(80);
  const floats = new Float32Array(particle), ints = new Uint32Array(particle);
  floats.set([2,1,0.5,0.8],8); floats[15]=1; ints[16]=1;
  pipeline.frameIndex=1;
  const check = (value: boolean, message: string) => {if(!value) throw new Error(message);};
  async function sample() {
    device.queue.writeBuffer(pipeline.currentParticleBuffer,0,particle);
    pipeline.renderCurrentState();
    const image = await pipeline.readHDRTexture();
    const energy = [0,0,0,0];
    let peak = 0;
    for(let i=0;i<image.data.length;i+=4) {
      for(let c=0;c<4;c++) energy[c]+=image.data[i+c];
      peak=Math.max(peak,image.data[i]);
    }
    return {energy,peak,image};
  }
  let maxEnergyError=0;
  for(const sigma of [0.25,0.6,2,8]) {
    render.splatSigma=sigma;
    for(const shift of [0,0.023,0.057]) {
      floats[0]=shift; floats[1]=-shift;
      const {energy}=await sample();
      [1.6,0.8,0.4,0.8].forEach((expected,c)=>{
        const error=Math.abs(energy[c]/expected-1);
        maxEnergyError=Math.max(maxEnergyError,error);
        check(error<0.001,`Splat energy mismatch sigma=${sigma} shift=${shift}: ${energy}`);
      });
    }
  }
  render.splatSigma=0.6; render.depthOfField=true; render.focusDistance=10; render.fStop=0.7;
  const focused=await sample();
  render.focusDistance=1;
  const blurred=await sample();
  check(blurred.peak<focused.peak/2,'Defocus did not broaden splat');
  check(Math.abs(blurred.energy[0]-focused.energy[0])<0.001,'Defocus changed emitted energy');
  render.fStop=8;
  const stoppedDown=await sample();
  check(stoppedDown.peak>blurred.peak,'Stopping down did not reduce blur');
  // Camera edits while paused clear old history and preserve particle bytes.
  const frame=pipeline.frameIndex;
  render.cameraPosition=[1,0,10];
  pipeline.present();
  const moved=await pipeline.readHDRTexture();
  check(pipeline.frameIndex===frame && pipeline.accumulationFrameIndex===1,'Camera edit advanced simulation or retained history');
  check(moved.data.some((v,i)=>v!==stoppedDown.image.data[i]),'Camera edit did not redraw paused image');
  pipeline.present();
  const repeated=await pipeline.readHDRTexture();
  check(repeated.data.every((v,i)=>v===moved.data[i]),'Unchanged paused camera accumulated another image');
  ints[16]=0;
  check((await sample()).energy.every(value=>value===0),'Dead particle emitted light');
  ints[16]=1; ints[17]=1;
  check((await sample()).energy.every(value=>value===0),'Respawning particle emitted light');
  ints[17]=0; floats[2]=20;
  check((await sample()).energy.every(value=>value===0),'Particle behind camera emitted light');
  // Degenerate look-at controls must not produce NaNs.
  floats[2]=0; render.cameraPosition=[0,10,0]; render.cameraTarget=[0,0,0];
  check((await sample()).image.data.every(Number.isFinite),'Vertical camera produced non-finite output');
  render.cameraTarget=[0,10,0];
  check((await sample()).image.data.every(Number.isFinite),'Coincident eye/target produced non-finite output');
  // Show actual float-texture readbacks for a quick visual check in the test page.
  const gallery = document.createElement('section');
  gallery.style.cssText='display:flex;gap:16px;background:#171b24;color:white;padding:16px;';
  for (const [label,result] of [['Focused',focused],['Defocused',blurred],['Stopped down',stoppedDown]] as const) {
    const figure=document.createElement('figure');
    figure.style.margin='0';
    const caption=document.createElement('figcaption'); caption.textContent=label;
    const preview=document.createElement('canvas'); preview.width=64; preview.height=64;
    preview.style.cssText='width:192px;height:192px;image-rendering:pixelated;';
    const image=new ImageData(64,64);
    for(let y=0;y<64;y++) for(let x=0;x<64;x++) {
      const source=((result.image.height/2-32+y)*result.image.width+result.image.width/2-32+x)*4;
      for(let c=0;c<3;c++) image.data[(y*64+x)*4+c]=255*Math.pow(1-Math.exp(-result.image.data[source+c]*8),1/2.2);
      image.data[(y*64+x)*4+3]=255;
    }
    preview.getContext('2d')!.putImageData(image,0,0);
    figure.append(caption,preview); gallery.append(figure);
  }
  document.body.append(gallery);
  render.dispose();
  return {maxEnergyError,checks:['normalized RGB/alpha at four splat sizes and subpixel offsets','thin-lens focus and f-stop','paused camera redraw','dead/respawning/behind-camera culling','degenerate camera controls']};
}
