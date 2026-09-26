import type { GPUNode } from "./nodes/kinds/base.ts";
import { InitializeParticlesNode } from "./nodes/initializeParticles.ts";
import { SpawnSphereNode } from "./nodes/spawnSphere.ts";
import { SetSpawnColorNode } from "./nodes/setSpawnColor.ts";
import { SetSpawnMassNode } from "./nodes/setSpawnMass.ts";
import { SetSpawnLifespanNode } from "./nodes/setSpawnLifespan.ts";
import { DragNode } from "./nodes/drag.ts";
import { ResetVelNode } from "./nodes/resetVel.ts";
import { CurlNoiseNode } from "./nodes/curlNoise.ts";
import { FlockingNode } from "./nodes/flocking.ts";
import { AttractorNode } from "./nodes/attractor.ts";
import { IntegratorNode } from "./nodes/integrator.ts";
import { MinVelKillNode } from "./nodes/minVelKill.ts";
import { OpacityScaleNode } from "./nodes/opacityScale.ts";
import { RenderParticlesNode } from "./nodes/renderParticles.ts";
import { CompositeNode } from "./nodes/composite.ts";

type PropertyValue = number | string | boolean | number[];
export type SerializedNode = { type: string; props: Record<string, PropertyValue> };
export type PipelinePreset = {
  version?: 2;
  name: string;
  sim: { particleCount: number; baseOpacity: number; randomSeed: number };
  compute: SerializedNode[];
  render: SerializedNode[];
};

type NodeDefinition = {
  key: string;
  label: string;
  ctor: new () => GPUNode;
  properties: string[];
  enums?: Record<string, string[]>;
};

// One registry drives both the Add Node UI and serialization. Only editable
// parameters belong here: GPU resources and display format are runtime state.
export const computeNodeTypes: NodeDefinition[] = [
  { key: "init", label: "InitializeParticles", ctor: InitializeParticlesNode, properties: [] },
  { key: "spawnSphere", label: "SpawnSphere", ctor: SpawnSphereNode, properties: ["origin", "radius", "centerWeight"] },
  { key: "setSpawnColor", label: "SetSpawnColor", ctor: SetSpawnColorNode, properties: ["saturation", "offset", "scale", "a", "b", "c", "d"] },
  { key: "setSpawnMass", label: "SetSpawnMass", ctor: SetSpawnMassNode, properties: ["minMass", "maxMass"] },
  { key: "setSpawnLifespan", label: "SetSpawnLifespan", ctor: SetSpawnLifespanNode, properties: ["minLifespan", "maxLifespan"] },
  { key: "drag", label: "Drag", ctor: DragNode, properties: ["drag", "mode"], enums: { mode: ["frame", "time"] } },
  { key: "resetVel", label: "ResetVelocity", ctor: ResetVelNode, properties: [] },
  { key: "curlNoise", label: "CurlNoise", ctor: CurlNoiseNode, properties: ["fieldScale", "strength", "eps", "octaves", "lacunarity", "gain", "mode", "normalizeField"], enums: { mode: ["velocity", "force", "legacy"] } },
  { key: "flocking", label: "Flocking", ctor: FlockingNode, properties: ["cellSize", "neighborRadius", "separationDistance", "alignmentWeight", "cohesionWeight", "separationWeight", "maxSpeed", "maxForce", "maxNeighbors", "gridMin"] },
  { key: "attractor", label: "Attractor", ctor: AttractorNode, properties: ["origin", "maxRadius", "strength", "maxForce"] },
  { key: "integrator", label: "Integrator", ctor: IntegratorNode, properties: [] },
  { key: "minVelKill", label: "MinVelKill", ctor: MinVelKillNode, properties: ["minVel"] },
  { key: "opacityScale", label: "OpacityScale", ctor: OpacityScaleNode, properties: ["fadeInTime", "power"] },
];
export const renderNodeTypes: NodeDefinition[] = [
  { key: "renderParticles", label: "RenderParticles", ctor: RenderParticlesNode, properties: ["clearMode", "trailFade", "blendMode"], enums: { clearMode: ["accumulate", "clear", "trail"], blendMode: ["normal", "additive"] } },
  { key: "composite", label: "Composite", ctor: CompositeNode, properties: ["enabled"] },
];
const definitions = [...computeNodeTypes, ...renderNodeTypes];

export function serializeNode(node: GPUNode): SerializedNode {
  const definition = definitions.find((entry) => node.constructor === entry.ctor);
  if (!definition) throw new Error(`Cannot save unregistered node: ${node.constructor.name}`);
  const props: Record<string, PropertyValue> = {};
  const values = node as unknown as Record<string, PropertyValue>;
  for (const key of definition.properties) {
    const value = values[key];
    props[key] = Array.isArray(value) ? [...value] : value;
  }
  return { type: definition.key, props };
}

export function deserializeNodes(serialized: SerializedNode[], stage: "compute" | "render", legacy = false): GPUNode[] {
  if (!Array.isArray(serialized)) throw new Error(`Invalid ${stage} node list`);
  const allowed = stage === "compute" ? computeNodeTypes : renderNodeTypes;
  return serialized.map((saved) => {
    const definition = allowed.find((entry) => entry.key === saved?.type);
    if (!definition) throw new Error(`Unknown ${stage} node: ${saved?.type}`);
    const instance = new definition.ctor();
    const values = instance as unknown as Record<string, PropertyValue>;
    for (const key of definition.properties) {
      if (!Object.hasOwn(saved.props ?? {}, key)) continue;
      const value = saved.props[key];
      const original = values[key];
      const valid = Array.isArray(original)
        ? Array.isArray(value) && value.length === original.length && value.every((n) => typeof n === "number" && Number.isFinite(n))
        : typeof value === typeof original && (typeof value !== "number" || Number.isFinite(value));
      if (!valid || (definition.enums?.[key] && !definition.enums[key].includes(value as string))) {
        throw new Error(`Invalid ${saved.type}.${key}`);
      }
      values[key] = Array.isArray(value) ? [...value] : value;
    }
    if (legacy && instance instanceof CurlNoiseNode && !Object.hasOwn(saved.props ?? {}, "mode")) {
      instance.mode = "legacy";
    }
    return instance;
  });
}

export function validatePreset(preset: PipelinePreset) {
  if (!preset || (preset.version !== undefined && preset.version !== 2)) throw new Error("Unsupported preset version");
  const sim = preset.sim;
  if (!sim || !Number.isInteger(sim.particleCount) || sim.particleCount < 1 ||
      !Number.isFinite(sim.baseOpacity) || sim.baseOpacity < 0 || sim.baseOpacity > 1 ||
      (sim.randomSeed !== undefined && (!Number.isInteger(sim.randomSeed) || sim.randomSeed < 0 || sim.randomSeed > 0xffffffff))) {
    throw new Error("Invalid preset simulation settings");
  }
}

/** Enforce pipeline endpoints when loading older presets. */
export function ensureRequiredNodes(compute: GPUNode[], render: GPUNode[]) {
  const init = compute.filter((node) => node instanceof InitializeParticlesNode);
  const composites = render.filter((node) => node instanceof CompositeNode);
  const particles = render.filter((node) => node instanceof RenderParticlesNode);
  if (init.length > 1 || composites.length > 1 || particles.length > 1) throw new Error("Duplicate required nodes in preset");
  compute.splice(0, compute.length, init[0] ?? new InitializeParticlesNode(), ...compute.filter((node) => !(node instanceof InitializeParticlesNode)));
  if (!compute.some((node) => node instanceof SpawnSphereNode)) compute.splice(1, 0, new SpawnSphereNode());
  render.splice(0, render.length,
    particles[0] ?? new RenderParticlesNode(),
    ...render.filter((node) => !(node instanceof RenderParticlesNode) && !(node instanceof CompositeNode)),
    composites[0] ?? new CompositeNode());
}
