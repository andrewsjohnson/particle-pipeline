import { deserializeNodes, serializeNode, validatePreset } from '../presets.ts';
import { RenderParticlesNode } from '../nodes/renderParticles.ts';
import type { PrintScene } from './printJob.ts';
import { validatePrintSettings, type PrintSettings } from './printSettings.ts';

export type PrintRecipe = {scene:PrintScene;settings:PrintSettings};
/** Parse through the preset whitelist: imported JSON never becomes runtime state. */
export function parsePrintRecipe(text:string):PrintRecipe {
  if(text.length>1_000_000) throw new Error('Render recipe is too large');
  const input=JSON.parse(text) as PrintRecipe;
  const scene=input?.scene, settings=input?.settings;
  if(scene?.version!==1 || !settings) throw new Error('Unsupported render recipe');
  validatePrintSettings(settings);
  validatePreset({version:2,name:'Print recipe',sim:scene,compute:scene.compute,render:[scene.renderer]});
  if(!Number.isInteger(scene.randomSeed)) throw new Error('Recipe seed is required');
  const compute=deserializeNodes(scene.compute,'compute');
  if(scene.compute[0]?.type!=='init') throw new Error('Recipe must begin with InitializeParticles');
  const renderer=deserializeNodes([scene.renderer],'render')[0];
  if(!(renderer instanceof RenderParticlesNode)) throw new Error('Recipe must contain a particle renderer');
  const color=scene.color;
  if(!color || !Number.isFinite(color.exposureEV) || Math.abs(color.exposureEV)>20 ||
    !Array.isArray(color.whiteBalance) || color.whiteBalance.length!==3 ||
    !color.whiteBalance.every(value=>Number.isFinite(value) && value>=0 && value<=16) ||
    !['aces','reinhard','linear'].includes(color.toneMap)) throw new Error('Invalid color settings');
  return {scene:{version:1,particleCount:scene.particleCount,baseOpacity:scene.baseOpacity,randomSeed:scene.randomSeed,
    compute:compute.map(serializeNode),renderer:serializeNode(renderer),
    color:{exposureEV:color.exposureEV,whiteBalance:[...color.whiteBalance],toneMap:color.toneMap}},
    settings:{width:settings.width,height:settings.height,dpi:settings.dpi,tileSize:settings.tileSize,
      warmupSteps:settings.warmupSteps,accumulationSteps:settings.accumulationSteps,lensSamples:settings.lensSamples,
      renderer:settings.renderer,format:settings.format}};
}
