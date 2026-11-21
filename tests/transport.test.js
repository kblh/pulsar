import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../js/transport.js';

function fake(id, running = true) {
  const m = { id, running, starts: 0, stops: 0 };
  m.start = () => { m.running = true; m.starts++; };
  m.stop = () => { m.running = false; m.stops++; };
  return m;
}

test('stopAll stops running modules and playAll restarts them', () => {
  const t = createTransport();
  const a = fake(1), b = fake(2);
  t.register(a); t.register(b);
  t.stopAll();
  assert.ok(!a.running && !b.running);
  assert.equal(t.isStopped(), true);
  t.playAll();
  assert.ok(a.running && b.running);
  assert.equal(t.isStopped(), false);
});

test('a module stopped by hand stays stopped after playAll', () => {
  const t = createTransport();
  const a = fake(1), b = fake(2, false);
  t.register(a); t.register(b);
  t.stopAll();
  t.playAll();
  assert.ok(a.running);
  assert.ok(!b.running);
  assert.equal(b.starts, 0);
});

test('a module registered while stopped is stopped and starts on playAll', () => {
  const t = createTransport();
  t.register(fake(1));
  t.stopAll();
  const late = fake(2);
  t.register(late);
  assert.ok(!late.running);
  t.playAll();
  assert.ok(late.running);
});

test('unregister forgets the module', () => {
  const t = createTransport();
  const a = fake(1);
  t.register(a);
  t.stopAll();
  t.unregister(1);
  t.playAll();
  assert.equal(a.starts, 0);
});

test('playAll while another module runs does not start hand-stopped ones', () => {
  const t = createTransport();
  const a = fake(1, false), b = fake(2, true);
  t.register(a); t.register(b);
  assert.doesNotThrow(() => t.playAll());
  assert.equal(a.starts, 0);
  assert.equal(t.isStopped(), false);
});

test('manual start then stop after stopAll is not undone by playAll', () => {
  const t = createTransport();
  const a = fake(1), b = fake(2);
  t.register(a); t.register(b);
  t.stopAll();
  a.start(); t.manual(1);
  a.stop(); t.manual(1);
  t.playAll();
  assert.ok(b.running);
  assert.ok(!a.running);
});

test('playAll with nothing running and nothing remembered starts everything', () => {
  const t = createTransport();
  const a = fake(1, false), b = fake(2, false);
  t.register(a); t.register(b);
  t.playAll();
  assert.ok(a.running && b.running);
});

test('anyRunning reflects module state', () => {
  const t = createTransport();
  const a = fake(1);
  assert.equal(t.anyRunning(), false);
  t.register(a);
  assert.equal(t.anyRunning(), true);
  a.stop();
  assert.equal(t.anyRunning(), false);
});

test('stopAll with nothing running leaves the transport un-stopped', () => {
  const t = createTransport();
  t.stopAll();
  assert.equal(t.isStopped(), false);
  const late = fake(1);
  t.register(late);
  assert.ok(late.running);
});

test('stoppedByUs tells transport stops from hand-made ones', () => {
  const t = createTransport();
  const mk = (id) => ({ id, running: true, start() { this.running = true; }, stop() { this.running = false; } });
  const a = mk(1), b = mk(2), c = mk(3);
  [a, b, c].forEach((m) => t.register(m));
  b.stop();
  t.manual(2); // stopped by hand
  t.stopAll();
  assert.equal(t.stoppedByUs(1), true);
  assert.equal(t.stoppedByUs(2), false);
  assert.equal(t.stoppedByUs(3), true);
  assert.equal(t.stoppedByUs(99), false);
  t.manual(3); // restarted/stopped by hand afterwards: no longer ours
  assert.equal(t.stoppedByUs(3), false);
  t.playAll();
  assert.equal(t.stoppedByUs(1), false);
});

test('after stop all, removing every module leaves the transport not stopped, so the next module plays', () => {
  const mk = (id) => ({ id, running: true, start() { this.running = true; }, stop() { this.running = false; } });
  const t = createTransport();
  t.register(mk(1));
  t.stopAll();
  assert.equal(t.isStopped(), true);
  t.unregister(1);
  assert.equal(t.isStopped(), false);
  const next = mk(2);
  t.register(next);
  assert.equal(next.running, true);
});

test('removing one module keeps the transport stopped while another is still held by stop all', () => {
  const mk = (id) => ({ id, running: true, start() { this.running = true; }, stop() { this.running = false; } });
  const t = createTransport();
  t.register(mk(1));
  t.register(mk(2));
  t.stopAll();
  t.unregister(1);
  assert.equal(t.isStopped(), true);
});
