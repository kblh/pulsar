import test from 'node:test';
import assert from 'node:assert/strict';
import { stubCtx } from './helpers/stub-ctx.js';
import { createSynthModule } from '../js/module.js';

globalThis.Worker = class { postMessage() {} terminate() {} };
globalThis.AudioContext = class {
  constructor() {
    const c = stubCtx();
    Object.assign(this, c, {
      destination: {},
      createDynamicsCompressor: () => ({ threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect: (n) => n }),
    });
  }
};
const { createEngine } = await import('../js/engine.js');

const synths = (engine) => engine.modules.filter((m) => m.type === 'synth');

test('only one synth is active: a new one waits, starting one stops the other', () => {
  const engine = createEngine();
  const a = createSynthModule();
  const b = createSynthModule();
  engine.addModule(a);
  engine.addModule(b);
  assert.deepEqual(synths(engine).map((m) => m.running), [true, false]);
  engine.setRunning(b, true);
  assert.deepEqual(synths(engine).map((m) => m.running), [false, true]);
  engine.setRunning(b, false);
  assert.deepEqual(synths(engine).map((m) => m.running), [false, false]);
  engine.setRunning(a, true);
  assert.deepEqual(synths(engine).map((m) => m.running), [true, false]);
});

test('stop all and play all leave the active synth playable', () => {
  const engine = createEngine();
  const s = createSynthModule();
  engine.addModule(s);
  engine.stopAll();
  assert.equal(s.running, true);
  assert.equal(engine.hasModules(), false);
  engine.playAll();
  assert.equal(s.running, true);
});
