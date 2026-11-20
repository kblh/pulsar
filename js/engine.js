import { createClock } from './clock.js';
import { createTransport } from './transport.js';
import { connectMix, clampVolume, clampPan } from './mix.js';
import { createRouting } from './sends.js';
import { loadWorklet, hasWorklet } from './worklet.js';

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
  const clock = createClock(() => {
    for (const m of modules) m.tick(ctx, m.out, ctx.currentTime);
  });

  return {
    ctx,
    modules,
    ready,
    hasWorklet: () => hasWorklet(ctx),
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
      if (modules.length === 1) clock.start();
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
      if (!modules.length) clock.stop();
    },
  };
}
