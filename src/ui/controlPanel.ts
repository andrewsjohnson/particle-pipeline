import { buildPrintPanel } from "./printPanel.ts";
import { PARTICLE_SIZE } from "../particles/particleLayout.ts";
import { Pane } from "tweakpane";
import type { Pipeline } from "../pipeline.ts";

import { InitializeParticlesNode } from "../nodes/initializeParticles.ts";
import { RenderParticlesNode } from "../nodes/renderParticles.ts";
import { CompositeNode } from "../nodes/composite.ts";
// import { RenderBokehParticlesNode } from "../nodes/renderBokehParticles.ts";
import {
  registerFolderButtonsPlugin,
  type FolderButtonConfig,
} from "./folderButtonsPlugin.ts";

import { computeNodeTypes, renderNodeTypes, serializeNode, deserializeNodes, ensureRequiredNodes, validatePreset, type PipelinePreset } from "../presets.ts";

const PRESET_STORAGE_KEY = "particle-pipeline.presets";

type ControlPanelOpts = {
  pipeline: Pipeline;
  simState: { paused: boolean };
  hdrEnabled: boolean;
  onPauseChange: (paused: boolean) => void;
  onReset: () => void;
  onSaveExr: () => Promise<void>;
  onSaveHdr: () => Promise<void>;
  onToggleHdr: (enabled: boolean) => void;
  onPrintBusy?: (busy: boolean) => void;
};

export function buildControlPanel(opts: ControlPanelOpts) {
  const { pipeline, simState, hdrEnabled, onPauseChange, onReset, onSaveExr, onSaveHdr, onToggleHdr } =
    opts;

  const pane = new Pane({ title: "Particle Pipeline" });
  // Tweakpane sits 8px from the viewport edges; scroll controls, not the canvas.
  const panel = pane.element;
  panel.style.maxHeight = "calc(100vh - 16px)";
  panel.style.maxHeight = "calc(100dvh - 16px)";
  panel.style.overflowY = "auto";
  panel.style.overscrollBehaviorY = "contain";
  panel.tabIndex = 0;
  panel.setAttribute("aria-label", "Particle Pipeline controls");
  registerFolderButtonsPlugin(pane);

  const simSettings = {
    particleCount: pipeline.particleCount,
    baseOpacity: pipeline.baseOpacity,
    randomSeed: pipeline.randomSeed,
  };
  const displaySettings = {
    hdr: hdrEnabled,
  };

  // Pause / Reset
  (pane as any)
    .addBinding(simState, "paused", { label: "Pause Simulation" })
    .on("change", (ev: any) => {
      onPauseChange(ev.value);
    });
  (pane as any)
    .addBlade({ view: "button", label: "Sim", title: "Reset Simulation" })
    .on("click", onReset);

  // Global settings
  const simFolder = (pane as any).addFolder({ title: "Simulation" });
  simFolder
    .addBinding(simSettings, "particleCount", {
      label: "Particles",
      min: 1_000,
      max: Math.min(6_000_000, Math.floor(pipeline.device.limits.maxStorageBufferBindingSize / PARTICLE_SIZE), Math.floor(pipeline.device.limits.maxBufferSize / PARTICLE_SIZE)),
      step: 1_000,
    })
    .on("change", (ev: any) => {
      pipeline.setParticleCount(ev.value);
    });
  simFolder
    .addBinding(simSettings, "baseOpacity", {
      label: "Base Opacity",
      min: 0,
      max: 1.0,
      step: 0.00005,
    })
    .on("change", (ev: any) => {
      pipeline.setBaseOpacity(ev.value);
    });
  simFolder
    .addBinding(simSettings, "randomSeed", {
      label: "Random Seed",
      min: 1,
      max: 4_294_967_295,
      step: 1,
    })
    .on("change", (ev: any) => {
      pipeline.setRandomSeed(ev.value);
      simSettings.randomSeed = pipeline.randomSeed;
      (pane as any).refresh?.();
    });
  simFolder
    .addBlade({ view: "button", label: "Seed", title: "Randomize Seed" })
    .on("click", () => {
      pipeline.setRandomSeed();
      simSettings.randomSeed = pipeline.randomSeed;
      (pane as any).refresh?.();
    });

  // Display / output
  const displayFolder = (pane as any).addFolder({ title: "Display" });
  displayFolder
    .addBinding(displaySettings, "hdr", { label: "HDR" })
    .on("change", (ev: any) => {
      onToggleHdr(ev.value);
    });

  // Capture buttons
  (pane as any)
    .addBlade({ view: "button", label: "Capture", title: "Save EXR (float)" })
    .on("click", onSaveExr);
  (pane as any)
    .addBlade({ view: "button", label: "Capture", title: "Save HDR (Radiance .hdr)" })
    .on("click", onSaveHdr);

  buildPrintPanel(pane, pipeline, opts.onPrintBusy, () => {
    simSettings.particleCount=pipeline.particleCount;
    simSettings.baseOpacity=pipeline.baseOpacity;
    simSettings.randomSeed=pipeline.randomSeed;
  });

  // Node controls
  const computeOptions = Object.fromEntries(
    computeNodeTypes.map((t) => [t.label, t.key])
  );
  const renderOptions = Object.fromEntries(
    renderNodeTypes.map((t) => [t.label, t.key])
  );
  const addState = {
    compute: computeNodeTypes[0].key,
    render: renderNodeTypes[0].key,
  };

  const loadPresetStore = () => {
    try {
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, PipelinePreset>) : {};
    } catch (err) {
      console.warn("Unable to read presets", err);
      return {};
    }
  };

  const savePresetStore = (store: Record<string, PipelinePreset>) => {
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(store));
    } catch (err) {
      console.warn("Unable to save presets", err);
    }
  };

  const presetStore = loadPresetStore();
  const presetState = {
    name: "Preset",
    selected: Object.keys(presetStore)[0] ?? "",
  };

  const presetFolder = (pane as any).addFolder({ title: "Presets", expanded: false });
  presetFolder.addBinding(presetState, "name", { label: "Name" });

  const buildPresetOptions = () =>
    Object.fromEntries(Object.keys(presetStore).map((k) => [k || "(unnamed)", k]));

  let presetSelect: any = null;
  const refreshPresetSelect = () => {
    presetSelect?.dispose?.();
    const options = buildPresetOptions();
    const first = Object.values(options)[0] ?? "";
    if (presetState.selected && !(presetState.selected in options)) {
      presetState.selected = first;
    }
    presetSelect = presetFolder.addBlade({
      view: "list",
      label: "Load",
      options,
      value: presetState.selected || first,
    });
    presetSelect.on("change", (ev: any) => {
      presetState.selected = ev.value;
    });
  };
  refreshPresetSelect();

  const buildPreset = (name: string): PipelinePreset => ({
    version: 2,
    name,
    sim: {
      particleCount: pipeline.particleCount,
      baseOpacity: pipeline.baseOpacity,
      randomSeed: pipeline.randomSeed,
    },
    compute: pipeline.computeNodes
      .map((n) => serializeNode(n)),
    render: pipeline.renderNodes
      .map((n) => serializeNode(n)),
  });

  let loadingPreset = false;
  const applyPreset = async (presetName: string) => {
    if (!presetName) {
      alert("Select a preset to load.");
      return;
    }
    const preset = presetStore[presetName];
    if (!preset) {
      alert(`Preset "${presetName}" not found.`);
      return;
    }

    validatePreset(preset);
    pipeline.validateParticleCount(preset.sim.particleCount);
    const compute = deserializeNodes(preset.compute, "compute", preset.version === undefined);
    const render = deserializeNodes(preset.render, "render", preset.version === undefined);
    ensureRequiredNodes(compute, render);
    const activeComposite = pipeline.renderNodes.find((node) => node instanceof CompositeNode) as CompositeNode;
    for (const node of render) {
      if (node instanceof CompositeNode) {
        node.targetFormat = activeComposite.targetFormat;
        node.applyToneMap = activeComposite.applyToneMap;
      }
    }
    // Initialize first; a failed shader compile leaves the current scene intact.
    await pipeline.setNodes(compute as any, render as any);
    pipeline.setParticleCount(preset.sim.particleCount);
    pipeline.setBaseOpacity(preset.sim.baseOpacity);
    pipeline.setRandomSeed(preset.sim.randomSeed ?? pipeline.randomSeed);
    simSettings.particleCount = pipeline.particleCount;
    simSettings.baseOpacity = pipeline.baseOpacity;
    simSettings.randomSeed = pipeline.randomSeed;
    (pane as any).refresh?.();
  };

  presetFolder
    .addBlade({ view: "button", label: "Save", title: "Save preset" })
    .on("click", () => {
      const name = presetState.name.trim() || "Preset";
      let preset: PipelinePreset;
      try { preset = buildPreset(name); }
      catch (error) { alert(String(error)); return; }
      presetStore[name] = preset;
      presetState.selected = name;
      savePresetStore(presetStore);
      refreshPresetSelect();
    });
  presetFolder
    .addBlade({ view: "button", label: "Load", title: "Load selected preset" })
    .on("click", async () => {
      if (loadingPreset) return;
      loadingPreset = true;
      try { await applyPreset(presetState.selected); }
      catch (error) { alert(`Unable to load preset: ${error instanceof Error ? error.message : error}`); }
      finally { loadingPreset = false; }
    });
  presetFolder
    .addBlade({ view: "button", label: "Delete", title: "Delete selected preset" })
    .on("click", () => {
      if (!presetState.selected) return;
      delete presetStore[presetState.selected];
      presetState.selected = "";
      savePresetStore(presetStore);
      refreshPresetSelect();
    });

  const nodesRoot = (pane as any).addFolder({ title: "Nodes" });
  const countSpawnNodes = () =>
    pipeline.computeNodes.filter((n) => n.constructor.name.startsWith("Spawn"))
      .length;
  const hasInitNode = () =>
    pipeline.computeNodes.some((n) => n.constructor === InitializeParticlesNode);
  const isRequired = (node: any) =>
    node.constructor === InitializeParticlesNode ||
    node.constructor === RenderParticlesNode ||
    node.constructor === CompositeNode;

  const addFolder = (nodesRoot as any).addFolder({ title: "Add/Insert" });
  addFolder
    .addBinding(addState, "compute", { label: "Compute", options: computeOptions });
  addFolder
    .addBlade({ view: "button", label: "Add", title: "Add Compute" })
    .on("click", async () => {
      const ctor = computeNodeTypes.find((t) => t.key === addState.compute)?.ctor;
      if (ctor) {
        if (ctor === InitializeParticlesNode && hasInitNode()) {
          alert("InitializeParticlesNode is already present (only one allowed).");
          return;
        }
        await pipeline.addNodeAndInit(new ctor() as any);
      }
    });
  addFolder
    .addBinding(addState, "render", { label: "Render", options: renderOptions });
  addFolder
    .addBlade({ view: "button", label: "Add", title: "Add Render" })
    .on("click", async () => {
      const ctor = renderNodeTypes.find((t) => t.key === addState.render)?.ctor;
      if (ctor) {
        if (pipeline.renderNodes.some((node) => node.constructor === ctor)) return;
        await pipeline.addNodeAndInit(new ctor() as any);
      }
    });

  let nodeFolders: any[] = [];
  const rebuildNodeUI = () => {
    nodeFolders.forEach((f) => f?.dispose?.());
    nodeFolders = [];

    const addList = (list: any[], parent: any) => {
      const initIndex = list.findIndex(
        (n) => n.constructor === InitializeParticlesNode
      );
      list.forEach((node, i) => {
        const buttons: FolderButtonConfig[] = [];
        const isInit = node.constructor === InitializeParticlesNode;
        const isRender = node.constructor === RenderParticlesNode;
        const isComposite = node.constructor === CompositeNode;
        const supportsMove = !isInit && !isRender && !isComposite;
        const canMoveUp =
          supportsMove &&
          i > 0 &&
          (initIndex === -1 || i - 1 > initIndex);
        const canMoveDown = supportsMove && i < list.length - 1;
        if (supportsMove) {
          buttons.push({
            label: "↑",
            title: "Move up",
            onClick: () => pipeline.moveNode(node, -1),
            disabled: !canMoveUp,
          });
          buttons.push({
            label: "↓",
            title: "Move down",
            onClick: () => pipeline.moveNode(node, 1),
            disabled: !canMoveDown,
          });
        }
        buttons.push({
          label: "✕",
          title: "Remove",
          onClick: () => {
            if (isRequired(node)) {
              alert("This node is required and cannot be removed.");
              return;
            }
            if (node.constructor.name.startsWith("Spawn") && countSpawnNodes() <= 1) {
              alert("At least one spawn node is required.");
              return;
            }
            pipeline.removeNode(node);
          },
        });

        const folder = (parent as any).addFolder({
          title: `${i + 1}: ${node.constructor.name}`,
          expanded: false,
          buttons,
        });
        nodeFolders.push(folder);

        if (typeof node.buildUI === "function") {
          node.buildUI(folder);
        }
      });
    };

    const computeGroup = (nodesRoot as any).addFolder({
      title: "Compute",
      expanded: true,
    });
    nodeFolders.push(computeGroup);
    addList(pipeline.computeNodes, computeGroup);

    const renderGroup = (nodesRoot as any).addFolder({
      title: "Render",
      expanded: true,
    });
    nodeFolders.push(renderGroup);
    addList(pipeline.renderNodes, renderGroup);
  };

  pipeline.onNodesChanged(rebuildNodeUI);
  rebuildNodeUI();

  return pane;
}

