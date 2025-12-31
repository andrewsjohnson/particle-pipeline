import { Pane } from "tweakpane";
import type { Pipeline } from "../pipeline";

import { InitializeParticlesNode } from "../nodes/initializeParticles.ts";
import { SpawnSphereNode } from "../nodes/spawnSphere.ts";
import { SetSpawnColorNode } from "../nodes/setSpawnColor.ts";
import { SetSpawnMassNode } from "../nodes/setSpawnMass.ts";
import { ResetVelNode } from "../nodes/resetVel.ts";
import { CurlNoiseNode } from "../nodes/curlNoise.ts";
import { FlockingNode } from "../nodes/flocking.ts";
import { PhysarumNode } from "../nodes/physarum.ts";
import { AttractorNode } from "../nodes/attractor.ts";
import { IntegratorNode } from "../nodes/integrator.ts";
import { MinVelKillNode } from "../nodes/minVelKill.ts";
import { OpacityScaleNode } from "../nodes/opacityScale.ts";
import { RenderParticlesNode } from "../nodes/renderParticles.ts";
import { CompositeNode } from "../nodes/composite.ts";
// import { RenderBokehParticlesNode } from "../nodes/renderBokehParticles.ts";
import {
  registerFolderButtonsPlugin,
  type FolderButtonConfig,
} from "./folderButtonsPlugin.ts";

type SerializedNode = { type: string; props: Record<string, any> };
type PipelinePreset = {
  name: string;
  sim: { particleCount: number; baseOpacity: number; randomSeed: number };
  compute: SerializedNode[];
  render: SerializedNode[];
};

const PRESET_STORAGE_KEY = "particle-pipeline.presets";

const isNumberArray = (v: any): v is number[] =>
  Array.isArray(v) && v.every((n) => typeof n === "number");
const isSerializableValue = (v: any) =>
  typeof v === "number" || typeof v === "string" || typeof v === "boolean" || isNumberArray(v);

type ControlPanelOpts = {
  pipeline: Pipeline;
  simState: { paused: boolean };
  hdrEnabled: boolean;
  onPauseChange: (paused: boolean) => void;
  onReset: () => void;
  onSaveExr: () => Promise<void>;
  onSaveHdr: () => Promise<void>;
  onToggleHdr: (enabled: boolean) => void;
};

export function buildControlPanel(opts: ControlPanelOpts) {
  const { pipeline, simState, hdrEnabled, onPauseChange, onReset, onSaveExr, onSaveHdr, onToggleHdr } =
    opts;

  const pane = new Pane({ title: "Particle Pipeline" });
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
      max: 6_000_000,
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

  // Node controls
  const computeNodeTypes = [
    { key: "init", label: "InitializeParticles", ctor: InitializeParticlesNode },
    { key: "spawnSphere", label: "SpawnSphere", ctor: SpawnSphereNode },
    { key: "setSpawnColor", label: "SetSpawnColor", ctor: SetSpawnColorNode },
    { key: "setSpawnMass", label: "SetSpawnMass", ctor: SetSpawnMassNode },
    { key: "resetVel", label: "ResetVelocity", ctor: ResetVelNode },
    { key: "curlNoise", label: "CurlNoise", ctor: CurlNoiseNode },
    { key: "flocking", label: "Flocking", ctor: FlockingNode },
    { key: "physarum", label: "Physarum", ctor: PhysarumNode },
    { key: "attractor", label: "Attractor", ctor: AttractorNode },
    { key: "integrator", label: "Integrator", ctor: IntegratorNode },
    { key: "minVelKill", label: "MinVelKill", ctor: MinVelKillNode },
    { key: "opacityScale", label: "OpacityScale", ctor: OpacityScaleNode },
  ];
  const renderNodeTypes = [
    { key: "renderParticles", label: "RenderParticles", ctor: RenderParticlesNode },
    { key: "composite", label: "Composite", ctor: CompositeNode },
    // { key: "renderBokeh", label: "RenderBokehParticles", ctor: RenderBokehParticlesNode },
  ];
  const computeOptions = Object.fromEntries(
    computeNodeTypes.map((t) => [t.label, t.key])
  );
  const renderOptions = Object.fromEntries(
    renderNodeTypes.map((t) => [t.label, t.key])
  );
  const keyToCtor = new Map<string, any>();
  const ctorToKey = new Map<any, string>();
  const computeKeys = new Set<string>();
  const renderKeys = new Set<string>();
  computeNodeTypes.forEach((t) => {
    keyToCtor.set(t.key, t.ctor);
    ctorToKey.set(t.ctor, t.key);
    computeKeys.add(t.key);
  });
  renderNodeTypes.forEach((t) => {
    keyToCtor.set(t.key, t.ctor);
    ctorToKey.set(t.ctor, t.key);
    renderKeys.add(t.key);
  });
  const addState = {
    compute: computeNodeTypes[0].key,
    render: renderNodeTypes[0].key,
  };

  const ensureRequiredNodes = (compute: any[], render: any[]) => {
    if (!compute.some((n) => n.constructor === InitializeParticlesNode)) {
      compute.unshift(new InitializeParticlesNode());
    }
    if (!compute.some((n) => n.constructor.name.startsWith("Spawn"))) {
      compute.splice(1, 0, new SpawnSphereNode());
    }
    if (!render.some((n) => n.constructor === RenderParticlesNode)) {
      render.unshift(new RenderParticlesNode());
    }
    if (!render.some((n) => n.constructor === CompositeNode)) {
      render.push(new CompositeNode());
    }
  };

  const serializeNode = (node: any): SerializedNode | null => {
    const type = ctorToKey.get(node.constructor as any);
    if (!type) return null;

    const props: Record<string, any> = {};
    for (const [key, value] of Object.entries(node)) {
      if (!isSerializableValue(value)) continue;
      props[key] = isNumberArray(value) ? [...value] : value;
    }

    return { type, props };
  };

  const deserializeNodes = (serialized: SerializedNode[], stage: "compute" | "render") => {
    const nodes: any[] = [];
    for (const node of serialized) {
      const ctor = keyToCtor.get(node.type);
      if (!ctor) continue;
      const isCompute = computeKeys.has(node.type);
      if ((stage === "compute" && !isCompute) || (stage === "render" && isCompute)) {
        continue;
      }

      const instance: any = new ctor();
      for (const [key, value] of Object.entries(node.props ?? {})) {
        if (isNumberArray(value)) {
          instance[key] = [...value];
        } else if (isSerializableValue(value)) {
          (instance as any)[key] = value as any;
        }
      }
      nodes.push(instance);
    }
    return nodes;
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
    name,
    sim: {
      particleCount: pipeline.particleCount,
      baseOpacity: pipeline.baseOpacity,
      randomSeed: pipeline.randomSeed,
    },
    compute: pipeline.computeNodes
      .map((n) => serializeNode(n))
      .filter(Boolean) as SerializedNode[],
    render: pipeline.renderNodes
      .map((n) => serializeNode(n))
      .filter(Boolean) as SerializedNode[],
  });

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

    pipeline.setParticleCount(preset.sim.particleCount);
    pipeline.setBaseOpacity(preset.sim.baseOpacity);
    pipeline.setRandomSeed(preset.sim.randomSeed ?? pipeline.randomSeed);
    simSettings.particleCount = pipeline.particleCount;
    simSettings.baseOpacity = pipeline.baseOpacity;
    simSettings.randomSeed = pipeline.randomSeed;

    const compute = deserializeNodes(preset.compute, "compute");
    const render = deserializeNodes(preset.render, "render");
    ensureRequiredNodes(compute, render);
    await pipeline.setNodes(compute, render);
    (pane as any).refresh?.();
  };

  presetFolder
    .addBlade({ view: "button", label: "Save", title: "Save preset" })
    .on("click", () => {
      const name = presetState.name.trim() || "Preset";
      const preset = buildPreset(name);
      presetStore[name] = preset;
      presetState.selected = name;
      savePresetStore(presetStore);
      refreshPresetSelect();
    });
  presetFolder
    .addBlade({ view: "button", label: "Load", title: "Load selected preset" })
    .on("click", async () => {
      await applyPreset(presetState.selected);
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
        await pipeline.addNodeAndInit(new ctor());
      }
    });
  addFolder
    .addBinding(addState, "render", { label: "Render", options: renderOptions });
  addFolder
    .addBlade({ view: "button", label: "Add", title: "Add Render" })
    .on("click", async () => {
      const ctor = renderNodeTypes.find((t) => t.key === addState.render)?.ctor;
      if (ctor) {
        await pipeline.addNodeAndInit(new ctor());
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

