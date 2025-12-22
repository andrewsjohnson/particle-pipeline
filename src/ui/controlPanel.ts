import { Pane } from "tweakpane";
import type { Pipeline } from "../pipeline";

import { InitializeParticlesNode } from "../nodes/initializeParticles.ts";
import { SpawnSphereNode } from "../nodes/spawnSphere.ts";
import { SetSpawnColorNode } from "../nodes/setSpawnColor.ts";
import { SetSpawnMassNode } from "../nodes/setSpawnMass.ts";
import { ResetVelNode } from "../nodes/resetVel.ts";
import { CurlNoiseNode } from "../nodes/curlNoise.ts";
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

type ControlPanelOpts = {
  pipeline: Pipeline;
  simState: { paused: boolean };
  onPauseChange: (paused: boolean) => void;
  onReset: () => void;
  onSaveExr: () => Promise<void>;
  onSaveHdr: () => Promise<void>;
};

export function buildControlPanel(opts: ControlPanelOpts) {
  const { pipeline, simState, onPauseChange, onReset, onSaveExr, onSaveHdr } =
    opts;

  const pane = new Pane({ title: "Particle Pipeline" });
  registerFolderButtonsPlugin(pane);

  // Pause / Reset
  (pane as any)
    .addBinding(simState, "paused", { label: "Pause Simulation" })
    .on("change", (ev: any) => {
      onPauseChange(ev.value);
    });
  (pane as any)
    .addBlade({ view: "button", label: "Sim", title: "Reset Simulation" })
    .on("click", onReset);

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
  const addState = {
    compute: computeNodeTypes[0].key,
    render: renderNodeTypes[0].key,
  };

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

