import { createClock } from './clock.js';
import { createTransport } from './transport.js';
import { connectMix, clampVolume, clampPan } from './mix.js';
import { createRouting } from './sends.js';
import { loadWorklet, hasWorklet } from './worklet.js';
import { createSequence } from './sequence.js';

export function createEngine() {
  const ctx = new AudioContext();
  const ready = loadWorklet(ctx).then(() => {}); // never rejects: without the worklet only the bitcrusher is missing
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  const modules = [];
  const transport = createTransport();
  const mixes = new Map();
  const routing = createRouting(ctx, master);
  let sequence = null; // the song structure, at most one
  const clock = createClock(() => {
    for (const m of modules) m.tick(ctx, m.out, ctx.currentTime);
    sequence?.tick(ctx.currentTime);
  });
  // The clock runs while there is anything to tick: a module or the sequence.
  let clockOn = false;
  const syncClock = () => {
    const need = modules.length > 0 || sequence !== null;
    if (need && !clockOn) clock.start();
    else if (!need && clockOn) clock.stop();
    clockOn = need;
  };
  /** Starts or stops a module on the sequence's behalf; like a hand-made toggle it is no longer the transport's to restart. */
  const setRunning = (m, on) => {
    if (on && !m.running) m.start();
    else if (!on && m.running) m.stop();
    transport.manual(m.id);
  };
  const host = {
    ids: () => modules.map((m) => m.id),
    isRunning: (id) => modules.find((m) => m.id === id)?.running === true,
    setRunning: (id, on) => {
      const m = modules.find((x) => x.id === id);
      if (m) setRunning(m, on);
    },
  };

  return {
    ctx,
    modules,
    ready,
    hasWorklet: () => hasWorklet(ctx),
    get sequence() { return sequence; },
    setRunning,
    addSequence(data) {
      if (sequence) throw new Error('there is already a sequence');
      sequence = createSequence(data ?? {}, host);
      transport.register(sequence);
      syncClock();
      return sequence;
    },
    removeSequence() {
      if (!sequence) return;
      sequence.stop();
      transport.unregister(sequence.id);
      sequence = null;
      syncClock();
    },
    effects: routing.effects,
    addEffect: routing.addEffect,
    setFxParam: routing.setFxParam,
    setFxEnabled: routing.setFxEnabled,
    removeEffect: routing.removeEffect,
    setSend: routing.setSend,
    stopAll: () => transport.stopAll(),
    playAll: () => transport.playAll(),
    isStopped: () => transport.isStopped(),
    stoppedByTransport: (m) => transport.stoppedByUs(m.id),
    anyRunning: () => transport.anyRunning(),
    hasModules: () => modules.length > 0,
    /** Hand-made start/stop from the UI. */
    toggle(m) {
      if (m.running) m.stop(); else m.start();
      transport.manual(m.id);
    },
    resume: () => (ctx.state === 'running' ? Promise.resolve() : ctx.resume()),
    addModule(m) {
      m.out = ctx.createGain();
      m.out.gain.value = m.outLevel ?? 0.4;
      m.volume = 1;
      m.pan = 0;
      const mix = connectMix(ctx, m.out, master);
      mixes.set(m.id, mix);
      routing.attach(m, mix);
      modules.push(m);
      transport.register(m);
      syncClock();
    },
    setVolume(m, v) {
      m.volume = clampVolume(v);
      mixes.get(m.id)?.setVolume(m.volume);
    },
    setPan(m, v) {
      m.pan = clampPan(v);
      mixes.get(m.id)?.setPan(m.pan);
    },
    removeModule(id) {
      const i = modules.findIndex((m) => m.id === id);
      if (i < 0) return;
      transport.unregister(id);
      sequence?.forgetModule(id);
      const m = modules[i];
      m.dispose();
      modules.splice(i, 1);
      const mix = mixes.get(id);
      mixes.delete(id);
      const delay = m.disposeDelay ? m.disposeDelay() : 0;
      const free = () => {
        routing.detach(m);
        mix?.disconnect();
      };
      if (delay) setTimeout(free, delay + 100); else free();
      syncClock();
    },
  };
}
