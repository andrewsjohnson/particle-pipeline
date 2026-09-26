export type PrintSettings = {
  width: number; height: number; dpi: number; tileSize: number;
  warmupSteps: number; accumulationSteps: number; lensSamples: number;
  renderer: 'lens' | 'gaussian'; format: 'png' | 'exr';
};
export const defaultPrintSettings = (): PrintSettings => ({
  width:2400, height:3200, dpi:300, tileSize:512,
  warmupSteps:60, accumulationSteps:60, lensSamples:32, renderer:'lens', format:'png',
});
export function validatePrintSettings(s: PrintSettings, maxTextureDimension = 8192) {
  for (const [key,min,max] of [
    ['width',1,30000], ['height',1,30000], ['dpi',1,2400], ['tileSize',16,2048],
    ['warmupSteps',0,36000], ['accumulationSteps',1,36000], ['lensSamples',1,4096],
  ] as const) {
    if (!Number.isInteger(s[key]) || s[key]<min || s[key]>max) throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  if (s.width*s.height > 150_000_000) throw new Error('Output is limited to 150 megapixels');
  if (s.tileSize > maxTextureDimension) throw new Error('Tile size exceeds this GPU’s texture limit');
  if (!['lens','gaussian'].includes(s.renderer) || !['png','exr'].includes(s.format)) throw new Error('Invalid output format or renderer');
  // Includes a float band and GPU readback; encoded file data is streamed separately.
  if (s.width*Math.min(s.tileSize,s.height)*16 > 256*1024*1024) throw new Error('Reduce tile size to keep the output band below 256 MiB');
}
export function printEstimate(s: PrintSettings, particles: number) {
  const tiles=Math.ceil(s.width/s.tileSize)*Math.ceil(s.height/s.tileSize);
  return {tiles, draws:tiles*s.accumulationSteps*(s.renderer==='lens'?s.lensSamples:1),
    gpuBytes:particles*160+s.tileSize*s.tileSize*16,
    bandBytes:s.width*Math.min(s.tileSize,s.height)*16,
    rawFileBytes:s.width*s.height*(s.format==='exr'?12:6)+s.height*32+65536};
}
