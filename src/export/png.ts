import type { ByteSink } from './sink.ts';
import type { PrintBand } from '../rendering/printJob.ts';
import { gradeChannel, type ColorSettings } from '../rendering/color.ts';
const crcTable=Uint32Array.from({length:256},(_,n)=>{
  let c=n; for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; return c>>>0;
});
export function pngChunk(type:string,data:Uint8Array) {
  const out=new Uint8Array(data.length+12), view=new DataView(out.buffer);
  view.setUint32(0,data.length); out.set(new TextEncoder().encode(type),4); out.set(data,8);
  let crc=0xffffffff;
  for(let i=4;i<out.length-4;i++) crc=crcTable[(crc^out[i])&255]^(crc>>>8);
  view.setUint32(out.length-4,(crc^0xffffffff)>>>0);
  return out;
}
/** 16-bit truecolor sRGB PNG. Rows are compressed incrementally, no full image canvas. */
export async function writePNG(sink: ByteSink, width:number,height:number,dpi:number,
  bands:AsyncIterable<PrintBand>, color:ColorSettings, signal:AbortSignal) {
  await sink.write(new Uint8Array([137,80,78,71,13,10,26,10]));
  const ihdr=new Uint8Array(13), header=new DataView(ihdr.buffer);
  header.setUint32(0,width); header.setUint32(4,height); ihdr[8]=16; ihdr[9]=2;
  await sink.write(pngChunk('IHDR',ihdr));
  await sink.write(pngChunk('sRGB',new Uint8Array([0])));
  const physical=new Uint8Array(9), pv=new DataView(physical.buffer);
  pv.setUint32(0,Math.round(dpi/0.0254)); pv.setUint32(4,Math.round(dpi/0.0254)); physical[8]=1;
  await sink.write(pngChunk('pHYs',physical));
  const compressed=new CompressionStream('deflate');
  const writer=compressed.writable.getWriter(), reader=compressed.readable.getReader();
  let pumpError:unknown;
  const pump=(async()=>{
    try {while(true) {const {value,done}=await reader.read(); if(done) break; await sink.write(pngChunk('IDAT',value));}}
    catch(error) {pumpError=error; await reader.cancel(error).catch(()=>{}); await writer.abort(error).catch(()=>{});}
  })();
  let rows=0;
  try {
    for await(const band of bands) {
      if(band.y!==rows || band.width!==width || band.data.length!==width*band.height*4) throw new Error('Invalid image band');
      for(let y=0;y<band.height;y++) {
        if(y%16===0) await new Promise(resolve=>setTimeout(resolve,0));
        if(signal.aborted) throw new DOMException('Render cancelled','AbortError');
        if(pumpError) throw pumpError;
        const row=new Uint8Array(1+width*6);
        // Filter 1 (Sub) improves compression on smooth HDR-derived gradients.
        const raw=new Uint8Array(width*6), rv=new DataView(raw.buffer);
        for(let x=0;x<width;x++) for(let c=0;c<3;c++) {
          rv.setUint16((x*3+c)*2,Math.round(65535*gradeChannel(band.data[(y*width+x)*4+c],c,color)));
        }
        row[0]=1;
        for(let i=0;i<raw.length;i++) row[i+1]=(raw[i]-(i>=6?raw[i-6]:0))&255;
        // Keep each row independent so backpressure can release previous storage.
        await writer.write(row); rows++;
      }
    }
    if(rows!==height) throw new Error('Incomplete image');
    await writer.close(); await pump;
    if(pumpError) throw pumpError;
    await sink.write(pngChunk('IEND',new Uint8Array()));
  } catch(error) {
    await reader.cancel(error).catch(()=>{});
    await writer.abort(error).catch(()=>{});
    await pump;
    throw error;
  }
}
