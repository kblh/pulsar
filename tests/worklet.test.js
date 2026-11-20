import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorklet, hasWorklet, markWorkletLoaded } from '../js/worklet.js';

test('loadWorklet is false without AudioWorklet support and never throws', async () => {
  assert.equal(await loadWorklet({}), false);
  assert.equal(await loadWorklet(null), false);
  assert.equal(await loadWorklet({ audioWorklet: {} }), false);
});

test('loadWorklet is false when the module fails to load', async () => {
  globalThis.AudioWorkletNode = class {};
  try {
    const ctx = { audioWorklet: { addModule: async () => { throw new Error('404'); } } };
    assert.equal(await loadWorklet(ctx), false);
    assert.equal(hasWorklet(ctx), false);
  } finally {
    delete globalThis.AudioWorkletNode;
  }
});

test('loadWorklet is true when the module loads and then hasWorklet knows it, per context', async () => {
  globalThis.AudioWorkletNode = class {};
  try {
    const seen = [];
    const ctx = { audioWorklet: { addModule: async (url) => { seen.push(url); } } };
    const other = {};
    assert.equal(hasWorklet(ctx), false);
    assert.equal(await loadWorklet(ctx, 'x.js'), true);
    assert.deepEqual(seen, ['x.js']);
    assert.equal(hasWorklet(ctx), true);
    assert.equal(hasWorklet(other), false);
    markWorkletLoaded(other);
    assert.equal(hasWorklet(other), true);
  } finally {
    delete globalThis.AudioWorkletNode;
  }
});
