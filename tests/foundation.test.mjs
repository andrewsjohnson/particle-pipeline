import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedStepClock } from '../src/simulation/fixedStep.ts';
import { perspectiveMatrix } from '../src/utils/perspectiveMatrix.ts';
import { computeNodeTypes, renderNodeTypes, serializeNode, deserializeNodes, ensureRequiredNodes, validatePreset } from '../src/presets.ts';
import { DragNode } from '../src/nodes/drag.ts';
import { SetSpawnLifespanNode } from '../src/nodes/setSpawnLifespan.ts';
import { CurlNoiseNode } from '../src/nodes/curlNoise.ts';
import { InitializeParticlesNode } from '../src/nodes/initializeParticles.ts';
import { CompositeNode } from '../src/nodes/composite.ts';

const close = (a,b,tolerance=1e-6) => assert.ok(Math.abs(a-b)<tolerance, `${a} != ${b}`);

test('30, 60, 120, and 144 Hz displays produce identical fixed simulation steps', () => {
  const states = [30,60,120,144].map(hz => {
    const clock = new FixedStepClock();
    let position = 0, velocity = 0, samples = 0;
    for(let frame=0;frame<hz*2;frame++) clock.advance(1/hz, dt => {
      velocity += 2*dt;
      position += velocity*dt;
      samples++;
    });
    return {position,velocity,samples};
  });
  for(const state of states) assert.deepEqual(state, states[0]);
  assert.equal(states[0].samples,120);
});

test('clock bounds catch-up and resets fractional time on pause/reset', () => {
  const clock = new FixedStepClock();
  let steps = 0;
  assert.equal(clock.advance(60, () => steps++),4);
  assert.equal(clock.advance(0, () => steps++),0);
  for(const invalid of [NaN,Infinity,-1]) assert.equal(clock.advance(invalid,()=>steps++),0);
  clock.advance(1/120,()=>steps++);
  clock.reset();
  assert.equal(clock.advance(1/120,()=>steps++),0);
  assert.equal(steps,4);
});

test('camera uses degrees, correct aspect, and WebGPU zero-to-one depth', () => {
  const matrix = perspectiveMatrix(90,2,.1,500);
  close(matrix[0],.5); close(matrix[5],1);
  const depth = z => (matrix[10]*z+matrix[14])/(-z);
  close(depth(-.1),0); close(depth(-500),1);
  close(perspectiveMatrix(45,1,.1,500)[5],1+Math.sqrt(2));
});

test('every available node round-trips editable parameters without runtime state', () => {
  for(const [definitions,stage] of [[computeNodeTypes,'compute'],[renderNodeTypes,'render']]) {
    for(const definition of definitions) {
      const original = new definition.ctor();
      const serialized = serializeNode(original);
      const [restored] = deserializeNodes([serialized],stage);
      assert.equal(restored.constructor,original.constructor);
      assert.deepEqual(serializeNode(restored),serialized);
      assert.ok(!('stage' in serialized.props));
      assert.ok(!('paramBuffer' in serialized.props));
      for(const key of definition.properties) {
        if(Array.isArray(original[key])) assert.notEqual(restored[key],original[key]);
      }
    }
  }
});

test('drag and lifespan survive a non-default preset with the original node order', () => {
  const drag = new DragNode(); drag.drag=.35; drag.mode='time';
  const life = new SetSpawnLifespanNode(); life.minLifespan=8; life.maxLifespan=73;
  const input=[new InitializeParticlesNode(),life,drag,new CurlNoiseNode()];
  const output=deserializeNodes(JSON.parse(JSON.stringify(input.map(serializeNode))),'compute');
  assert.deepEqual(output.map(node=>node.constructor),input.map(node=>node.constructor));
  assert.equal(output[1].maxLifespan,73); assert.equal(output[2].drag,.35); assert.equal(output[2].mode,'time');
});

test('legacy presets retain per-step curl semantics, ignore resource fields and retain display ownership', () => {
  const [curl]=deserializeNodes([{type:'curlNoise',props:{strength:.8,stage:'render',paramBuffer:42}}],'compute',true);
  assert.equal(curl.mode,'legacy'); assert.equal(curl.stage,'compute'); assert.equal(curl.strength,.8);
  assert.equal(curl.paramBuffer,undefined);
  const [composite]=deserializeNodes([{type:'composite',props:{targetFormat:'bgra8unorm',applyToneMap:false}}],'render',true);
  assert.equal(composite.targetFormat,new CompositeNode().targetFormat);
  assert.equal(composite.applyToneMap,true);
});

test('invalid presets fail visibly instead of silently deleting nodes or accepting bad parameters', () => {
  assert.throws(()=>deserializeNodes([{type:'missing',props:{}}],'compute'),/Unknown/);
  assert.throws(()=>deserializeNodes([{type:'drag',props:{mode:'random'}}],'compute'),/Invalid/);
  assert.throws(()=>deserializeNodes([{type:'spawnSphere',props:{origin:[1,2]}}],'compute'),/Invalid/);
  assert.throws(()=>deserializeNodes([{type:'drag',props:{drag:NaN}}],'compute'),/Invalid/);
  assert.throws(()=>validatePreset({version:7}),/Unsupported/);
  assert.throws(()=>validatePreset({sim:{particleCount:NaN,baseOpacity:.1,randomSeed:42}}),/Invalid/);
});

test('required pipeline endpoints are restored in the right order', () => {
  const compute=[new DragNode(),new InitializeParticlesNode()];
  const render=[new CompositeNode()];
  ensureRequiredNodes(compute,render);
  assert.equal(compute[0].constructor.name,'InitializeParticlesNode');
  assert.equal(compute[1].constructor.name,'SpawnSphereNode');
  assert.equal(render[0].constructor.name,'RenderParticlesNode');
  assert.equal(render.at(-1).constructor.name,'CompositeNode');
});
