import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouting } from '../js/sends.js';
import { connectMix } from '../js/mix.js';
import { stubCtx } from './helpers/stub-ctx.js';

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ctx = stubCtx();
  const master = ctx.createGain();
  const routing = createRouting(ctx, master);
  let nextId = 1;
  const addModule = () => {
    const m = { id: nextId++ };
    const mix = connectMix(ctx, { connect: (x) => x }, master);
    const pan = ctx.nodes.filter((n) => n.kind === 'pan').at(-1);
    routing.attach(m, mix);
    return { m, pan, sendGains: () => pan.connections.filter((n) => n !== master) };
  };
  return { ctx, master, routing, addModule };
}
const targets = (g) => g.gain.calls.filter((c) => c[0] === 'target');

test('attach gives five empty slots with level 0.3', (t) => {
  const { addModule } = setup(t);
  const { m } = addModule();
  assert.deepEqual(m.sends, Array.from({ length: 5 }, (_, i) => i).map(() => ({ fx: null, level: 0.3 })));
});

test('addEffect connects the output to master and numbers effects', (t) => {
  const { routing, master } = setup(t);
  const fx = routing.addEffect('delay');
  assert.equal(fx.id, 'fx1');
  assert.equal(fx.type, 'delay');
  assert.ok(fx.output.connections.includes(master));
  assert.deepEqual(routing.effects, [fx]);
  assert.throws(() => routing.addEffect('flanger'));
});

test('setSend selects an effect and ramps the level', (t) => {
  const { routing, addModule } = setup(t);
  const { m, sendGains } = addModule();
  const fx = routing.addEffect('delay');
  routing.setSend(m, 0, { fx: fx.id });
  const [g] = sendGains();
  assert.ok(g.connections.includes(fx.input));
  assert.equal(m.sends[0].fx, fx.id);
  assert.deepEqual(targets(g).at(-1).slice(0, 2), ['target', 0.3]);
  routing.setSend(m, 0, { level: 2 });
  assert.equal(m.sends[0].level, 1);
  assert.deepEqual(targets(g).at(-1).slice(0, 2), ['target', 1]);
  assert.equal(g.gain.calls.filter((c) => c[0] === 'value').length, 1);
});

test('setSend level-only change keeps the target and creates nothing', (t) => {
  const { ctx, routing, addModule } = setup(t);
  const { m, sendGains } = addModule();
  const fx = routing.addEffect('reverb');
  routing.setSend(m, 1, { fx: fx.id });
  const count = ctx.nodes.length;
  routing.setSend(m, 1, { level: 0.6 });
  assert.equal(ctx.nodes.length, count);
  assert.equal(sendGains().length, 1);
  assert.deepEqual(targets(sendGains()[0]).at(-1).slice(0, 2), ['target', 0.6]);
});

test('retargeting fades the old send to 0, disconnects it later and starts a new one from 0', (t) => {
  const { routing, addModule } = setup(t);
  const { m, sendGains } = addModule();
  const a = routing.addEffect('delay');
  const b = routing.addEffect('reverb');
  routing.setSend(m, 0, { fx: a.id });
  const [old] = sendGains();
  routing.setSend(m, 0, { fx: b.id });
  assert.deepEqual(targets(old).at(-1).slice(0, 2), ['target', 0]);
  assert.equal(old.disconnected, 0);
  const fresh = sendGains().at(-1);
  assert.notEqual(fresh, old);
  assert.ok(fresh.connections.includes(b.input));
  assert.deepEqual(fresh.gain.calls[0], ['value', 0]);
  t.mock.timers.tick(300);
  assert.ok(old.disconnected >= 1);
  assert.equal(fresh.disconnected, 0);
});

test('two slots of one module can target the same effect', (t) => {
  const { routing, addModule } = setup(t);
  const { m, sendGains } = addModule();
  const fx = routing.addEffect('delay');
  routing.setSend(m, 0, { fx: fx.id });
  routing.setSend(m, 2, { fx: fx.id, level: 0.8 });
  const gains = sendGains();
  assert.equal(gains.length, 2);
  for (const g of gains) assert.ok(g.connections.includes(fx.input));
});

test('slot index outside 0..4 and unknown fx id are ignored', (t) => {
  const { ctx, routing, addModule } = setup(t);
  const { m, sendGains } = addModule();
  const fx = routing.addEffect('delay');
  const count = ctx.nodes.length;
  for (const slot of [5, -1, 1.5, NaN, undefined]) routing.setSend(m, slot, { fx: fx.id });
  routing.setSend(m, 0, { fx: 'fx99' });
  assert.equal(ctx.nodes.length, count);
  assert.equal(sendGains().length, 0);
  assert.equal(m.sends[0].fx, null);
});

test('removeEffect resets slots in every module and lets the tail ring out', (t) => {
  const { routing, addModule } = setup(t);
  const one = addModule();
  const two = addModule();
  const fx = routing.addEffect('delay');
  routing.setSend(one.m, 0, { fx: fx.id });
  routing.setSend(two.m, 2, { fx: fx.id });
  const gains = [one.sendGains()[0], two.sendGains()[0]];
  let disposed = 0;
  let disconnected = 0;
  const realDispose = fx.dispose;
  const realDisconnect = fx.disconnect;
  fx.dispose = () => { disposed++; realDispose(); };
  fx.disconnect = () => { disconnected++; realDisconnect(); };
  routing.removeEffect(fx.id);
  assert.deepEqual(routing.effects, []);
  assert.equal(one.m.sends[0].fx, null);
  assert.equal(two.m.sends[2].fx, null);
  for (const g of gains) assert.deepEqual(targets(g).at(-1).slice(0, 2), ['target', 0]);
  assert.equal(disposed, 1);
  t.mock.timers.tick(fx.tailMs());
  assert.equal(disconnected, 0);
  t.mock.timers.tick(101);
  assert.equal(disconnected, 1);
  routing.removeEffect(fx.id);
  t.mock.timers.tick(100000);
  assert.equal(disposed, 1);
});

test('effect ids are never reused', (t) => {
  const { routing } = setup(t);
  const first = routing.addEffect('delay');
  routing.removeEffect(first.id);
  assert.equal(routing.addEffect('delay').id, 'fx2');
});

test('detach disconnects the module sends and forgets the module', (t) => {
  const { ctx, routing, addModule } = setup(t);
  const { m, sendGains } = addModule();
  const fx = routing.addEffect('reverb');
  routing.setSend(m, 0, { fx: fx.id });
  const [g] = sendGains();
  routing.detach(m);
  assert.ok(g.disconnected >= 1);
  const count = ctx.nodes.length;
  routing.setSend(m, 1, { fx: fx.id });
  routing.removeEffect(fx.id);
  assert.equal(ctx.nodes.length, count);
});

test('addEffect passes params to the effect and names it after its type', (t) => {
  const { routing } = setup(t);
  const fx = routing.addEffect('delay', { time: 900 });
  assert.equal(fx.params.time, 900);
  assert.equal(fx.name, 'delay');
  assert.equal(routing.addEffect('delay', { feedback: 7 }).params.feedback, 0.9);
});

test('setFxEnabled passes the bypass to the effect, and a bypassed effect still disconnects after removal', (t) => {
  const { routing } = setup(t);
  const fx = routing.addEffect('delay');
  routing.setFxEnabled(fx, false);
  assert.equal(fx.enabled, false);
  let disconnected = 0;
  const realDisconnect = fx.disconnect;
  fx.disconnect = () => { disconnected++; realDisconnect(); };
  routing.removeEffect(fx.id);
  t.mock.timers.tick(fx.tailMs() + 101);
  assert.equal(disconnected, 1);
});

test('addEffect creates an equalizer wired to the master', (t) => {
  const { routing, master } = setup(t);
  const fx = routing.addEffect('eq');
  assert.equal(fx.type, 'eq');
  assert.equal(fx.name, 'eq');
  assert.ok(fx.output.connections.includes(master));
});

test('addEffect for a bitcrusher without the worklet throws and leaves no effect behind', (t) => {
  const { routing } = setup(t);
  assert.throws(() => routing.addEffect('bitcrusher'), /worklet/i);
  assert.deepEqual(routing.effects, []);
  assert.equal(routing.addEffect('delay').id, 'fx1'); // the failed attempt did not use an id
});
