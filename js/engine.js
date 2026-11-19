import { createClock } from './clock.js';
import { createTransport } from './transport.js';
import { connectMix, clampVolume, clampPan } from './mix.js';

export function createEngine() {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  const modules = [];
  const transport = createTransport();
  const mixes = new Map();
  const clock = createClock(() => {
    for (const m of modules) m.tick(ctx, m.out, ctx.currentTime);
  });

  return {
    ctx,
    modules,
    stopAll: () => transport.stopAll(),
    playAll: () => transport.playAll(),
    isStopped: () => transport.isStopped(),
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
      mixes.set(m.id, connectMix(ctx, m.out, master));
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
      if (mix) (delay ? setTimeout(() => mix.disconnect(), delay + 100) : mix.disconnect());
      if (!modules.length) clock.stop();
    },
  };
}
