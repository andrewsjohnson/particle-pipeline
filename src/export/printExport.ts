import { renderPrintBands, type PrintScene, type PrintProgress } from '../rendering/printJob.ts';
import { validatePrintSettings, type PrintSettings } from '../rendering/printSettings.ts';
import type { ByteSink } from './sink.ts';
import { writeEXR } from './exr.ts';
import { writePNG } from './png.ts';

/** Owns sink completion: failed/cancelled jobs abort the output, never close it. */
export async function exportPrint(device:GPUDevice,scene:PrintScene,settings:PrintSettings,sink:ByteSink,
  signal:AbortSignal,onProgress?:(progress:PrintProgress)=>void) {
  // Snapshot mutable caller inputs before the first await.
  const frozenScene=structuredClone(scene), frozenSettings={...settings};
  try {
    validatePrintSettings(frozenSettings,device.limits.maxTextureDimension2D);
    if(signal.aborted) throw new DOMException('Render cancelled','AbortError');
    const bands=renderPrintBands(device,frozenScene,frozenSettings,signal,onProgress);
    if(frozenSettings.format==='exr') {
      await writeEXR(sink,frozenSettings.width,frozenSettings.height,bands,signal,JSON.stringify({scene:frozenScene,settings:frozenSettings}));
    } else {
      await writePNG(sink,frozenSettings.width,frozenSettings.height,frozenSettings.dpi,bands,frozenScene.color,signal);
    }
    if(signal.aborted) throw new DOMException('Render cancelled','AbortError');
    await sink.close();
  } catch(error) {
    await sink.abort(error).catch(()=>{});
    throw error;
  }
}
