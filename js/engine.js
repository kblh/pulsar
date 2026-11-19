import { createClock } from './clock.js';
import { createTransport } from './transport.js';

export function createEngine() {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  const modules = [];
  const transport = createTransport();
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
      m.out.connect(master);
      modules.push(m);
      transport.register(m);
      if (modules.length === 1) clock.start();
    },
    removeModule(id) {
      const i = modules.findIndex((m) => m.id === id);
      if (i < 0) return;
      transport.unregister(id);
      modules[i].dispose();
      modules.splice(i, 1);
      if (!modules.length) clock.stop();
    },
  };
}
