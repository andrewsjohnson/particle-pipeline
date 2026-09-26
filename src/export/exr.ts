import type { ByteSink } from './sink.ts';
import type { PrintBand } from '../rendering/printJob.ts';

export function exrHeader(width:number,height:number,metadata='') {
  const bytes:number[]=[];
  const u32=(target:number[],value:number)=>target.push(value&255,(value>>>8)&255,(value>>>16)&255,(value>>>24)&255);
  const str=(target:number[],value:string)=>target.push(...new TextEncoder().encode(value),0);
  const attr=(name:string,type:string,payload:number[])=>{str(bytes,name);str(bytes,type);u32(bytes,payload.length);bytes.push(...payload);};
  const floats=(values:number[])=>{const data=new Uint8Array(values.length*4),v=new DataView(data.buffer);values.forEach((n,i)=>v.setFloat32(i*4,n,true));return [...data];};
  u32(bytes,20000630);u32(bytes,2);
  const channels:number[]=[];
  for(const name of ['B','G','R']) {str(channels,name);u32(channels,2);u32(channels,0);u32(channels,1);u32(channels,1);}
  channels.push(0);attr('channels','chlist',channels);attr('compression','compression',[0]);
  const box:number[]=[];for(const n of [0,0,width-1,height-1]) u32(box,n);
  attr('dataWindow','box2i',box);attr('displayWindow','box2i',box);attr('lineOrder','lineOrder',[0]);
  attr('pixelAspectRatio','float',floats([1]));attr('screenWindowCenter','v2f',floats([0,0]));attr('screenWindowWidth','float',floats([1]));
  attr('chromaticities','chromaticities',floats([0.64,0.33,0.30,0.60,0.15,0.06,0.3127,0.3290]));
  if(metadata) {
    const encoded=new TextEncoder().encode(metadata);
    if(encoded.length>60000) throw new Error('EXR recipe metadata exceeds 60 KB');
    attr('particlePipeline','string',[...encoded]);
  }
  bytes.push(0);
  return new Uint8Array(bytes);
}
/** Uncompressed float32 RGB scanline EXR, linear sRGB primaries, top-down rows. */
export async function writeEXR(sink:ByteSink,width:number,height:number,bands:AsyncIterable<PrintBand>,signal:AbortSignal,metadata='') {
  const header=exrHeader(width,height,metadata), rowBytes=width*12, blockBytes=rowBytes+8;
  await sink.write(header);
  const offsets=new Uint8Array(height*8), offsetView=new DataView(offsets.buffer);
  for(let y=0;y<height;y++) offsetView.setBigUint64(y*8,BigInt(header.length+height*8+y*blockBytes),true);
  await sink.write(offsets);
  let rows=0;
  for await(const band of bands) {
    if(band.y!==rows || band.width!==width || band.data.length!==width*band.height*4) throw new Error('Invalid image band');
    for(let y=0;y<band.height;y++) {
        if(y%16===0) await new Promise(resolve=>setTimeout(resolve,0));
      if(signal.aborted) throw new DOMException('Render cancelled','AbortError');
      const bytes=new Uint8Array(blockBytes), view=new DataView(bytes.buffer);
      view.setInt32(0,rows,true);view.setUint32(4,rowBytes,true);
      let offset=8;
      for(const channel of [2,1,0]) for(let x=0;x<width;x++) {
        const value=band.data[(y*width+x)*4+channel];
        view.setFloat32(offset,Number.isFinite(value)?value:0,true);offset+=4;
      }
      await sink.write(bytes);rows++;
    }
  }
  if(rows!==height) throw new Error('Incomplete image');
}
