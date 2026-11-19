import { createClock } from './clock.js';

export function createEngine() {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  const modules = [];
  const clock = createClock(() => {
    for (const m of modules) m.tick(ctx, m.out, ctx.currentTime);
  });

  return {
    ctx,
    modules,
    resume: () => (ctx.state === 'running' ? Promise.resolve() : ctx.resume()),
    addModule(m) {
      m.out = ctx.createGain();
      m.out.gain.value = 0.4;
      m.out.connect(master);
      modules.push(m);
      if (modules.length === 1) clock.start();
    },
    removeModule(id) {
      const i = modules.findIndex((m) => m.id === id);
      if (i < 0) return;
      modules[i].dispose();
      modules.splice(i, 1);
      if (!modules.length) clock.stop();
    },
  };
}
