import test from 'node:test';
import assert from 'node:assert/strict';
import { clampVolume, clampPan, connectMix } from '../js/mix.js';

function stubCtx() {
  const time = { t: 1 };
  const mk = (name) => {
    const calls = [];
    const param = { calls, setTargetAtTime: (...a) => calls.push(['target', ...a]), set value(v) { calls.push(['value', v]); } };
    const node = { name, gain: param, pan: param, connections: [], disconnected: 0,
      connect(x) { node.connections.push(x); return x; }, disconnect() { node.disconnected++; } };
    return node;
  };
  return { get currentTime() { return time.t; }, createGain: () => mk('gain'), createStereoPanner: () => mk('pan') };
}

test('clamps', () => {
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(NaN), 1);
  assert.equal(clampVolume('0.5'), 0.5);
  assert.equal(clampPan(5), 1);
  assert.equal(clampPan(-5), -1);
  assert.equal(clampPan(NaN), 0);
});

test('connectMix wires out -> volume -> pan -> destination', () => {
  const ctx = stubCtx();
  const out = { connections: [], connect(x) { out.connections.push(x); return x; } };
  const dest = { name: 'master' };
  const mix = connectMix(ctx, out, dest);
  const vol = out.connections[0];
  assert.equal(vol.name, 'gain');
  const pan = vol.connections[0];
  assert.equal(pan.name, 'pan');
  assert.equal(pan.connections[0], dest);
  assert.ok(mix);
});

test('setVolume and setPan clamp and ramp instead of jumping', () => {
  const ctx = stubCtx();
  const out = { connect: (x) => x };
  let vol, pan;
  const dest = {};
  const origGain = ctx.createGain, origPan = ctx.createStereoPanner;
  ctx.createGain = () => (vol = origGain());
  ctx.createStereoPanner = () => (pan = origPan());
  const mix = connectMix(ctx, out, dest);
  mix.setVolume(5);
  mix.setPan(-9);
  assert.deepEqual(vol.gain.calls.at(-1).slice(0, 2), ['target', 1]);
  assert.deepEqual(pan.pan.calls.at(-1).slice(0, 2), ['target', -1]);
  for (const c of [...vol.gain.calls, ...pan.pan.calls]) assert.ok(c[0] === 'target' || c[0] === 'value');
});

test('disconnect disconnects both nodes', () => {
  const ctx = stubCtx();
  let vol, pan;
  const og = ctx.createGain, op = ctx.createStereoPanner;
  ctx.createGain = () => (vol = og());
  ctx.createStereoPanner = () => (pan = op());
  const mix = connectMix(ctx, { connect: (x) => x }, {});
  mix.disconnect();
  assert.equal(vol.disconnected, 1);
  assert.equal(pan.disconnected, 1);
});

import { stubCtx as richCtx } from './helpers/stub-ctx.js';
import { clampLevel } from '../js/mix.js';

test('clampLevel defaults to silence for bad input', () => {
  assert.equal(clampLevel(2), 1);
  assert.equal(clampLevel(-1), 0);
  assert.equal(clampLevel(NaN), 0);
  assert.equal(clampLevel('0.5'), 0.5);
});

test('send taps after pan, starts silent and ramps its level', () => {
  const ctx = richCtx();
  const mix = connectMix(ctx, { connect: (x) => x }, { name: 'master' });
  const pan = ctx.nodes.find((n) => n.kind === 'pan');
  const dest = { name: 'fx' };
  const send = mix.send(dest);
  const gain = pan.connections.at(-1);
  assert.equal(gain.kind, 'gain');
  assert.ok(gain.connections.includes(dest));
  assert.deepEqual(gain.gain.calls, [['value', 0]]);
  send.setLevel(5);
  assert.deepEqual(gain.gain.calls.at(-1).slice(0, 2), ['target', 1]);
  send.setLevel(NaN);
  assert.deepEqual(gain.gain.calls.at(-1).slice(0, 2), ['target', 0]);
  assert.equal(gain.gain.calls.filter((c) => c[0] === 'value').length, 1);
  send.disconnect();
  assert.equal(gain.disconnected, 1);
});

test('mix.disconnect disconnects sends too', () => {
  const ctx = richCtx();
  const mix = connectMix(ctx, { connect: (x) => x }, {});
  mix.send({});
  mix.send({});
  const sendGains = ctx.nodes.filter((n) => n.kind === 'gain').slice(1);
  mix.disconnect();
  assert.equal(sendGains.length, 2);
  for (const g of sendGains) assert.ok(g.disconnected >= 1);
});

test('disconnecting a send twice is safe (real Web Audio throws on a second disconnect(dest))', () => {
  const ctx = richCtx();
  const mix = connectMix(ctx, { connect: (x) => x }, {});
  const pan = ctx.nodes.find((n) => n.kind === 'pan');
  const connected = new Set();
  pan.connect = (x) => { connected.add(x); return x; };
  pan.disconnect = (x) => {
    if (x && !connected.delete(x)) throw new Error('InvalidAccessError');
  };
  const send = mix.send({});
  send.disconnect();
  assert.doesNotThrow(() => send.disconnect());
  const again = mix.send({});
  again.disconnect();
  assert.doesNotThrow(() => mix.disconnect());
});
