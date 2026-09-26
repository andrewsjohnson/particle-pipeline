import test from 'node:test';
import assert from 'node:assert/strict';
import { BindGroupCache } from '../src/utils/bindGroupCache.ts';
import { RenderParticlesNode } from '../src/nodes/renderParticles.ts';
import { deserializeNodes, serializeNode } from '../src/presets.ts';

test('bindings reuse ping-pong resources and invalidate for new pipeline/buffer/range/view', () => {
  let count = 0;
  const device = {createBindGroup: () => ({id: ++count})};
  const pipeline = {getBindGroupLayout: () => ({})};
  const cache = new BindGroupCache();
  const a = {}, b = {}, texture = {};
  const bindings = (buffer, offset=0, size=80, view=texture) => [
    {binding:0, resource:{buffer, offset, size}}, {binding:1, resource:view},
  ];
  const first = cache.get(device, pipeline, bindings(a));
  cache.get(device, pipeline, bindings(b));
  assert.equal(cache.get(device, pipeline, bindings(a)), first);
  assert.equal(count, 2);
  for (const entry of [bindings({}), bindings(a,4), bindings(a,0,160), bindings(a,0,80,{})]) {
    assert.notEqual(cache.get(device,pipeline,entry), first);
  }
  assert.notEqual(cache.get(device,{...pipeline},bindings(a)), first);
  cache.clear();
  assert.notEqual(cache.get(device,pipeline,bindings(a)), first);
  const current = cache.get(device,pipeline,bindings(a));
  for (let i=0;i<9;i++) cache.get(device,pipeline,bindings({}));
  assert.notEqual(cache.get(device,pipeline,bindings(a)), current);
});

test('camera/lens presets preserve controls and legacy presets remain point-based', () => {
  const render = new RenderParticlesNode();
  Object.assign(render, {renderMode:'splats', cameraPosition:[0,2,8], cameraTarget:[1,0,0],
    depthOfField:true, focusDistance:6, fStop:1.4, metersPerUnit:0.1, splatSigma:0.8, maxSplatSigma:24});
  const saved = serializeNode(render);
  assert.deepEqual(serializeNode(deserializeNodes([saved], 'render')[0]), saved);
  assert.equal(deserializeNodes([{type:'renderParticles', props:{}}], 'render')[0].renderMode, 'points');
});
