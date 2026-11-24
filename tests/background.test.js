import test from 'node:test';
import assert from 'node:assert/strict';
import { silentWav, holdsSession, setupBackgroundAudio } from '../js/background.js';

test('silentWav is a valid 8-bit mono PCM file of silence', () => {
  const b = silentWav(1, 8000);
  const v = new DataView(b.buffer);
  const tag = (at) => String.fromCharCode(...b.slice(at, at + 4));
  assert.deepEqual([tag(0), tag(8), tag(12), tag(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.equal(v.getUint32(4, true), b.length - 8);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 8000);
  assert.equal(v.getUint16(34, true), 8);
  assert.equal(v.getUint32(40, true), 8000);
  assert.equal(b.length, 44 + 8000);
  assert.ok(b.slice(44).every((x) => x === 128));
});

test('the session is held while something runs and the context is alive', () => {
  assert.equal(holdsSession({ running: true, state: 'running' }), true);
  assert.equal(holdsSession({ running: true, state: 'suspended' }), true);
  assert.equal(holdsSession({ running: true, state: 'interrupted' }), true);
  assert.equal(holdsSession({ running: false, state: 'running' }), false);
  assert.equal(holdsSession({ running: true, state: 'closed' }), false);
});

function setup({ running = false, state = 'running', mediaSession = true } = {}) {
  const log = [];
  const listeners = {};
  const audio = {
    paused: true, attrs: {}, style: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    play() { this.paused = false; log.push('play'); return Promise.resolve(); },
    pause() { this.paused = true; log.push('pause'); },
    remove() { log.push('remove'); },
  };
  const doc = {
    visibilityState: 'visible', body: { append() {} },
    createElement: () => audio,
    addEventListener: (t, f) => { (listeners[t] ??= []).push(f); },
    removeEventListener: (t, f) => { listeners[t] = (listeners[t] ?? []).filter((x) => x !== f); },
  };
  const handlers = {};
  const nav = { audioSession: {}, mediaSession: mediaSession ? { setActionHandler: (n, f) => { handlers[n] = f; }, playbackState: 'none' } : undefined };
  const win = { MediaMetadata: class { constructor(o) { Object.assign(this, o); } }, addEventListener: (t, f) => { (listeners['win:' + t] ??= []).push(f); } };
  const state_ = { running, ctxState: state, modules: true };
  const engine = {
    ctx: { get state() { return state_.ctxState; } },
    anyRunning: () => state_.running,
    hasModules: () => state_.modules,
    resume: () => { state_.ctxState = 'running'; log.push('resume'); return Promise.resolve(); },
    playAll: () => { state_.running = true; log.push('playAll'); },
    stopAll: () => { state_.running = false; log.push('stopAll'); },
  };
  globalThis.URL.createObjectURL ??= () => 'blob:x';
  const bg = setupBackgroundAudio(engine, { doc, nav, win, interval: 1e9 });
  return { bg, audio, doc, nav, handlers, listeners, state: state_, log, engine };
}

test('the audio session is declared playback and a silent looping element is added', () => {
  const { bg, audio, nav } = setup();
  assert.equal(nav.audioSession.type, 'playback');
  assert.equal(audio.loop, true);
  assert.equal(audio.attrs.playsinline, '');
  bg.dispose();
});

test('the silent element plays while something runs and pauses when nothing does', () => {
  const t = setup();
  t.bg.sync();
  assert.equal(t.audio.paused, true);
  assert.equal(t.nav.mediaSession.playbackState, 'paused');
  t.state.running = true;
  t.bg.sync();
  assert.equal(t.audio.paused, false);
  assert.equal(t.nav.mediaSession.playbackState, 'playing');
  t.state.running = false;
  t.bg.sync();
  assert.equal(t.audio.paused, true);
  t.bg.dispose();
});

test('lock-screen play and pause drive the transport', async () => {
  const t = setup({ state: 'suspended' });
  await t.handlers.play();
  assert.deepEqual(t.log.filter((x) => x !== 'play' && x !== 'pause'), ['resume', 'playAll']);
  assert.equal(t.audio.paused, false);
  t.handlers.pause();
  assert.equal(t.state.running, false);
  assert.equal(t.audio.paused, true);
  t.bg.dispose();
});

test('coming back to the page resumes an interrupted context, but only while something runs', async () => {
  const t = setup({ running: true, state: 'interrupted' });
  t.listeners.visibilitychange[0]();
  assert.ok(t.log.includes('resume'));
  t.bg.dispose();
  const idle = setup({ running: false, state: 'suspended' });
  idle.listeners.visibilitychange[0]();
  assert.ok(!idle.log.includes('resume'));
  idle.bg.dispose();
  const hidden = setup({ running: true, state: 'suspended' });
  hidden.doc.visibilityState = 'hidden';
  hidden.listeners.visibilitychange[0]();
  assert.ok(!hidden.log.includes('resume'));
  hidden.bg.dispose();
});

test('without the Media Session API everything else still works', () => {
  const t = setup({ mediaSession: false });
  t.state.running = true;
  t.bg.sync();
  assert.equal(t.audio.paused, false);
  t.bg.dispose();
});
