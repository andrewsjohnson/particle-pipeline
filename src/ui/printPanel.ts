import { parsePrintRecipe } from '../rendering/printRecipe.ts';
import { deserializeNodes, ensureRequiredNodes } from '../presets.ts';
import { CompositeNode } from '../nodes/composite.ts';
import type { Pipeline } from '../pipeline.ts';
import { capturePrintScene } from '../rendering/printJob.ts';
import { defaultPrintSettings, printEstimate, validatePrintSettings } from '../rendering/printSettings.ts';
import { exportPrint } from '../export/printExport.ts';
import { BlobSink, downloadBlob, type ByteSink } from '../export/sink.ts';

type FilePicker = (options:unknown)=>Promise<{createWritable:()=>Promise<ByteSink>}>;
export function buildPrintPanel(pane:any,pipeline:Pipeline,onBusy:(busy:boolean)=>void=()=>{},onSceneLoaded:()=>void=()=>{}) {
  const settings=defaultPrintSettings();
  const folder=pane.addFolder({title:'Print render',expanded:false});
  folder.addBinding(settings,'width',{label:'Width (pixels)',min:1,max:30000,step:1});
  folder.addBinding(settings,'height',{label:'Height (pixels)',min:1,max:30000,step:1});
  folder.addBinding(settings,'dpi',{label:'Print DPI',min:1,max:2400,step:1});
  folder.addBinding(settings,'warmupSteps',{label:'Warm-up steps',min:0,max:36000,step:1});
  folder.addBinding(settings,'accumulationSteps',{label:'Accumulate steps',min:1,max:36000,step:1});
  folder.addBinding(settings,'renderer',{label:'Renderer',options:{'Sampled lens':'lens','Fast Gaussian':'gaussian'}});
  folder.addBinding(settings,'lensSamples',{label:'Lens samples/step',min:1,max:4096,step:1});
  folder.addBinding(settings,'tileSize',{label:'Tile size',min:16,max:2048,step:1});
  folder.addBinding(settings,'format',{label:'File',options:{'PNG · 16-bit sRGB':'png','EXR · linear float':'exr'}});
  folder.addBinding({lighting:'Additive accumulation'},'lighting',{label:'Print lighting',readonly:true});
  const info={size:'',memory:'',work:'',status:'Ready'};
  const sizeBinding=folder.addBinding(info,'size',{label:'Print size',readonly:true});
  const memoryBinding=folder.addBinding(info,'memory',{label:'Extra GPU memory',readonly:true});
  const workBinding=folder.addBinding(info,'work',{label:'Render work',readonly:true});
  const statusBinding=folder.addBinding(info,'status',{label:'Status',readonly:true});
  let refreshing=false;
  const refresh=()=>{
    if(refreshing) return;
    refreshing=true;
    const estimate=printEstimate(settings,pipeline.particleCount);
    info.size=`${(settings.width/settings.dpi).toFixed(1)} × ${(settings.height/settings.dpi).toFixed(1)} in`;
    info.memory=`~${Math.ceil(estimate.gpuBytes/1048576)} MiB + node buffers`;
    info.work=`${estimate.tiles} tiles / ${estimate.draws.toLocaleString()} draws`;
    sizeBinding.refresh();memoryBinding.refresh();workBinding.refresh();
    refreshing=false;
  };
  folder.on('change',refresh);pipeline.onNodesChanged(refresh);refresh();
  let busy=false;
  folder.addButton({title:'Load render recipe'}).on('click',()=>{
    if(busy) return;
    const input=document.createElement('input');input.type='file';input.accept='.json';
    input.onchange=async()=>{
      const file=input.files?.[0];if(!file || busy) return;
      try {
        if(file.size>1_000_000) throw new Error('Render recipe is too large');
        busy=true;pane.disabled=true;onBusy(true);
        const recipe=parsePrintRecipe(await file.text());
        pipeline.validateParticleCount(recipe.scene.particleCount);
        validatePrintSettings(recipe.settings,pipeline.device.limits.maxTextureDimension2D);
        const compute=deserializeNodes(recipe.scene.compute,'compute');
        const render=deserializeNodes([recipe.scene.renderer],'render');
        const active=pipeline.renderNodes.find(node=>node instanceof CompositeNode);
        const composite=new CompositeNode();
        Object.assign(composite,recipe.scene.color);
        if(active) {composite.targetFormat=active.targetFormat;composite.applyToneMap=active.applyToneMap;}
        render.push(composite);ensureRequiredNodes(compute,render);
        await pipeline.setNodes(compute as any,render as any);
        pipeline.setParticleCount(recipe.scene.particleCount);
        pipeline.setBaseOpacity(recipe.scene.baseOpacity);
        pipeline.setRandomSeed(recipe.scene.randomSeed);
        Object.assign(settings,recipe.settings);info.status='Recipe loaded';
        onSceneLoaded();pane.refresh();refresh();
      } catch(error) {info.status=`Failed: ${String(error)}`;alert(info.status);}
      finally {busy=false;pane.disabled=false;onBusy(false);statusBinding.refresh();}
    };
    input.click();
  });
  folder.addButton({title:'Render and save'}).on('click',async()=>{
    if(busy) return;
    let sink:ByteSink|undefined;
    let overlay:HTMLDivElement|undefined;
    const controller=new AbortController();
    try {
      validatePrintSettings(settings,pipeline.device.limits.maxTextureDimension2D);
      const scene=capturePrintScene(pipeline), job={...settings};
      const name=`particles-${job.width}x${job.height}-${scene.randomSeed}.${job.format}`;
      const picker=(window as unknown as {showSaveFilePicker?:FilePicker}).showSaveFilePicker;
      if(!picker && printEstimate(job,scene.particleCount).rawFileBytes>512*1024*1024) {
        throw new Error('This output may exceed the 512 MiB browser-download limit. Reduce resolution or use Chrome/Edge with direct file saving.');
      }
      busy=true;pane.disabled=true;onBusy(true);
      if(picker) {
        const handle=await picker.call(window,{suggestedName:name,types:[{description:job.format==='png'?'16-bit PNG':'Linear OpenEXR',
          accept:{[job.format==='png'?'image/png':'application/octet-stream']:[`.${job.format}`]}}]});
        sink=await handle.createWritable();
      } else sink=new BlobSink();
      overlay=document.createElement('div');
      overlay.style.cssText='position:fixed;inset:0;background:#111e;color:#fff;z-index:10000;display:grid;place-content:center;gap:16px;padding:24px;font:16px system-ui;';
      const title=document.createElement('h2');title.textContent='Rendering your print';
      const note=document.createElement('p');
      note.textContent='Additive light accumulation from the saved seed. Lens samples average brightness; simulation steps add trails. Keep this tab open.';
      note.style.maxWidth='560px';
      const status=document.createElement('p'), progress=document.createElement('progress');progress.max=1;
      progress.style.width='100%';
      const cancel=document.createElement('button');cancel.textContent='Cancel render';
      cancel.onclick=()=>{controller.abort();cancel.disabled=true;status.textContent='Cancelling after queued GPU work…';};
      overlay.append(title,note,progress,status,cancel);document.body.append(overlay);
      const started=performance.now();
      await exportPrint(pipeline.device,scene,job,sink,controller.signal,value=>{
        if(controller.signal.aborted) return;
        progress.value=value.completed/value.total;
        status.textContent=`${value.phase} · tile ${value.tile}/${value.tiles} · ${Math.floor(progress.value*100)}% · ${Math.round((performance.now()-started)/1000)}s`;
      });
      if(sink instanceof BlobSink) downloadBlob(sink.blob(job.format==='png'?'image/png':'application/octet-stream'),name);
      const recipe=new Blob([JSON.stringify({scene,settings:job},null,2)],{type:'application/json'});
      // A user-clicked recipe link avoids browsers blocking a second automatic download.
      const recipeURL=URL.createObjectURL(recipe), recipeLink=document.createElement('a');
      recipeLink.href=recipeURL;recipeLink.download=name.replace(/\.[^.]+$/,'.render.json');recipeLink.textContent='Save render recipe';recipeLink.style.color='#acf';
      title.textContent='Print saved';status.textContent=`Finished in ${Math.round((performance.now()-started)/1000)} seconds.`;
      cancel.textContent='Back to scene';cancel.disabled=false;
      overlay.append(recipeLink);
      const completedOverlay=overlay;overlay=undefined;
      cancel.onclick=()=>{URL.revokeObjectURL(recipeURL);completedOverlay.remove();};
      info.status='Saved';
    } catch(error) {
      await sink?.abort(error).catch(()=>{});
      const cancelled=error instanceof DOMException && error.name==='AbortError';
      info.status=cancelled?'Cancelled':`Failed: ${String(error)}`;
      if(!cancelled) alert(info.status);
    } finally {
      overlay?.remove();busy=false;pane.disabled=false;onBusy(false);statusBinding.refresh();
    }
  });
}
