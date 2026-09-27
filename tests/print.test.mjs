import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {apertureSample} from '../src/rendering/sampling.ts';
import {gradeChannel, defaultColor, linearToSRGB} from '../src/rendering/color.ts';
import {defaultPrintSettings, validatePrintSettings, printEstimate} from '../src/rendering/printSettings.ts';
import {writePNG, pngChunk} from '../src/export/png.ts';
import {writeEXR} from '../src/export/exr.ts';
import {BlobSink} from '../src/export/sink.ts';

const signal=()=>new AbortController().signal;
const fixture={y:0,width:2,height:2,data:new Float32Array([1,0,0,1,0,1,0,1,0,0,1,1,0.25,0.5,2,1])};
async function* bands() {yield fixture;}

test('aperture samples are deterministic, centered, area uniform, and respect polygon boundaries',()=>{
  for(const blades of [0,3,6]) {
    let x=0,y=0,r2=0;
    const count=8192;
    for(let i=0;i<count;i++) {
      const p=apertureSample(i,count,blades,0,1234);
      assert.deepEqual(p,apertureSample(i,count,blades,0,1234));
      x+=p[0];y+=p[1];r2+=p[0]**2+p[1]**2;
      assert.ok(p[0]**2+p[1]**2<=1+1e-12);
      if(blades) for(let side=0;side<blades;side++) {
        const a=(side+0.5)*2*Math.PI/blades;
        assert.ok(p[0]*Math.cos(a)+p[1]*Math.sin(a)<=Math.cos(Math.PI/blades)+1e-12);
      }
    }
    assert.ok(Math.abs(x/count)<0.002 && Math.abs(y/count)<0.002);
    if(!blades) assert.ok(Math.abs(r2/count-0.5)<0.001);
  }
  assert.notDeepEqual(apertureSample(5,64,3,0,1),apertureSample(5,64,3,45,1));
});

test('exposure is in stops, white balance is per channel, and transfer is sRGB',()=>{
  const color={...defaultColor(),toneMap:'linear'};
  assert.equal(gradeChannel(0.1,0,{...color,exposureEV:1}),gradeChannel(0.2,0,color));
  assert.equal(gradeChannel(0.1,0,{...color,whiteBalance:[2,1,1]}),gradeChannel(0.2,0,color));
  assert.ok(Math.abs(linearToSRGB(0.003)-0.03876)<1e-8);
  assert.equal(gradeChannel(-1,0,color),0);
  assert.equal(gradeChannel(100,0,color),linearToSRGB(1));
  assert.ok(gradeChannel(1,0,{...color,toneMap:'reinhard'})<1);
});

test('print preflight validates dimensions, device limits, and bounded working memory',()=>{
  const settings=defaultPrintSettings();validatePrintSettings(settings);
  validatePrintSettings({...settings,width:9000,height:12000,tileSize:512});
  assert.equal(printEstimate({...settings,width:65,height:49,tileSize:32},128).tiles,6);
  for(const change of [{width:0},{height:2.5},{lensSamples:0},{warmupSteps:-1},{width:30000,height:30000},{width:30000,tileSize:2048},{format:'jpeg'}]) {
    assert.throws(()=>validatePrintSettings({...settings,...change}));
  }
  assert.throws(()=>validatePrintSettings(settings,256));
});

test('16-bit PNG has valid chunks, DPI, top-down RGB rows, grading, and a complete zlib stream',async()=>{
  const sink=new BlobSink(),color={...defaultColor(),toneMap:'linear'};
  await writePNG(sink,2,2,300,bands(),color,signal());
  const bytes=new Uint8Array(await sink.blob('image/png').arrayBuffer());
  const view=new DataView(bytes.buffer),chunks=[];
  for(let p=8;p<bytes.length;) {
    const length=view.getUint32(p),type=new TextDecoder().decode(bytes.subarray(p+4,p+8)),data=bytes.slice(p+8,p+8+length);
    assert.deepEqual(bytes.slice(p,p+length+12),pngChunk(type,data));
    chunks.push({type,data});p+=length+12;
  }
  assert.equal(chunks[0].type,'IHDR');assert.equal(chunks[0].data[8],16);assert.equal(chunks[0].data[9],2);
  assert.equal(new DataView(chunks.find(c=>c.type==='pHYs').data.buffer).getUint32(0),11811);
  assert.equal(chunks.at(-1).type,'IEND');
  const raw=inflateSync(Buffer.concat(chunks.filter(c=>c.type==='IDAT').map(c=>c.data)));
  assert.equal(raw.length,26);
  for(let y=0;y<2;y++) {
    assert.equal(raw[y*13],1);
    const row=Uint8Array.from(raw.subarray(y*13+1,(y+1)*13));
    for(let i=6;i<row.length;i++) row[i]=(row[i]+row[i-6])&255;
    const v=new DataView(row.buffer);
    for(let x=0;x<2;x++) for(let c=0;c<3;c++) assert.equal(v.getUint16((x*3+c)*2),Math.round(65535*gradeChannel(fixture.data[(y*2+x)*4+c],c,color)));
  }
});

test('EXR offsets and channels preserve unclipped float data and top-down orientation',async()=>{
  const sink=new BlobSink();await writeEXR(sink,2,2,bands(),signal(),'test recipe');
  const bytes=new Uint8Array(await sink.blob('application/octet-stream').arrayBuffer()),view=new DataView(bytes.buffer);
  assert.equal(view.getUint32(0,true),20000630);let p=8;
  const readString=()=>{let result='';while(bytes[p]) result+=String.fromCharCode(bytes[p++]);p++;return result;};
  const attrs={};
  while(bytes[p]) {const name=readString(),type=readString(),size=view.getUint32(p,true);p+=4;attrs[name]={type,data:bytes.slice(p,p+size)};p+=size;}
  p++;
  assert.equal(new TextDecoder().decode(attrs.particlePipeline.data),'test recipe');
  assert.equal(attrs.chromaticities.data.length,32);
  for(let y=0;y<2;y++) {
    const offset=Number(view.getBigUint64(p+y*8,true));
    assert.equal(view.getInt32(offset,true),y);assert.equal(view.getUint32(offset+4,true),24);
    let cursor=offset+8;
    for(const c of [2,1,0]) for(let x=0;x<2;x++) {assert.equal(view.getFloat32(cursor,true),fixture.data[(y*2+x)*4+c]);cursor+=4;}
  }
});

test('PNG cancellation and sink errors unwind the band generator without hanging', {timeout:5000}, async()=>{
  let closed=false;
  const controller=new AbortController();
  async function* cancelled() {try {controller.abort();yield fixture;} finally {closed=true;}}
  await assert.rejects(writePNG(new BlobSink(),2,2,300,cancelled(),defaultColor(),controller.signal),{name:'AbortError'});
  assert.equal(closed,true);
  const sink=new BlobSink();const write=sink.write.bind(sink);
  sink.write=async bytes=>{if(new TextDecoder().decode(bytes.subarray(4,8))==='IDAT') throw new Error('Disk full');await write(bytes);};
  await assert.rejects(writePNG(sink,2,2,300,bands(),defaultColor(),signal()),/Disk full/);
});

test('render recipes preserve artistic settings and reject invalid runtime data',async()=>{
  const {parsePrintRecipe}=await import('../src/rendering/printRecipe.ts');
  const {RenderParticlesNode}=await import('../src/nodes/renderParticles.ts');
  const {InitializeParticlesNode}=await import('../src/nodes/initializeParticles.ts');
  const {serializeNode}=await import('../src/presets.ts');
  const recipe={scene:{version:1,particleCount:128,baseOpacity:0.1,randomSeed:123,
    compute:[serializeNode(new InitializeParticlesNode())],renderer:serializeNode(new RenderParticlesNode()),color:defaultColor()},settings:defaultPrintSettings()};
  assert.deepEqual(parsePrintRecipe(JSON.stringify(recipe)),recipe);
  const malicious=structuredClone(recipe);malicious.scene.renderer.props.paramBuffer='injected';malicious.settings.internalDevice='injected';
  assert.deepEqual(parsePrintRecipe(JSON.stringify(malicious)),recipe);
  const bad=structuredClone(recipe);bad.scene.color.whiteBalance=[1,1,-1];
  assert.throws(()=>parsePrintRecipe(JSON.stringify(bad)),/color/);
  bad.scene.color=defaultColor();bad.scene.renderer={type:'composite',props:{}};
  assert.throws(()=>parsePrintRecipe(JSON.stringify(bad)),/particle renderer/);
});

test('a disk failure during PNG compression closes an active multi-row source', {timeout:5000}, async()=>{
  let released=false, seed=123;
  const data=Float32Array.from({length:512*64*4},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;});
  async function* rows() {try {yield {width:512,height:64,y:0,data};} finally {released=true;}}
  const sink=new BlobSink(),write=sink.write.bind(sink);
  sink.write=async bytes=>{if(new TextDecoder().decode(bytes.subarray(4,8))==='IDAT') throw new Error('Disk disconnected');await write(bytes);};
  await assert.rejects(writePNG(sink,512,64,300,rows(),defaultColor(),signal()),/Disk disconnected/);
  assert.equal(released,true);
});
