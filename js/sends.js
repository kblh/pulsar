import { createDelay, createReverb } from './fx.js';
import { clampLevel } from './mix.js';

const SLOTS = 3;
const DEFAULT_LEVEL = 0.3;
const RETIRE_MS = 150; // long enough for a send's ramp to reach silence
const TAIL_PAD_MS = 100;
const MAKERS = { delay: createDelay, reverb: createReverb };

/** Effects and the module -> effect sends. Owns the effect instances and every send gain. */
export function createRouting(ctx, master) {
  const effects = [];
  const attached = new Map(); // module id -> { m, mix, active: [null | { fxId, send }] }
  let counter = 0;

  function retire(entry) {
    entry.send.setLevel(0);
    setTimeout(() => entry.send.disconnect(), RETIRE_MS);
  }

  function setSend(m, slot, patch = {}) {
    const a = attached.get(m.id);
    if (!a || !Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return;
    const s = m.sends[slot];
    const levelChanged = 'level' in patch;
    if (levelChanged) s.level = clampLevel(patch.level);
    if ('fx' in patch) s.fx = effects.some((e) => e.id === patch.fx) ? patch.fx : null;

    let cur = a.active[slot];
    if (cur && cur.fxId !== s.fx) {
      retire(cur);
      cur = a.active[slot] = null;
    }
    if (!cur && s.fx) {
      const fx = effects.find((e) => e.id === s.fx);
      cur = a.active[slot] = { fxId: s.fx, send: a.mix.send(fx.input) };
      cur.send.setLevel(s.level);
    } else if (cur && levelChanged) {
      cur.send.setLevel(s.level);
    }
  }

  return {
    effects,
    addEffect(type, params) {
      const make = MAKERS[type];
      if (!make) throw new Error(`unknown effect: ${type}`);
      const fx = make(ctx, params);
      fx.id = `fx${++counter}`;
      fx.name = type;
      fx.output.connect(master);
      effects.push(fx);
      return fx;
    },
    setFxParam: (fx, key, value) => fx.setParam(key, value),
    removeEffect(id) {
      const i = effects.findIndex((e) => e.id === id);
      if (i < 0) return;
      const fx = effects[i];
      for (const { m } of attached.values()) {
        m.sends.forEach((s, slot) => {
          if (s.fx === id) setSend(m, slot, { fx: null });
        });
      }
      effects.splice(i, 1);
      fx.dispose();
      setTimeout(() => fx.disconnect(), fx.tailMs() + TAIL_PAD_MS);
    },
    attach(m, mix) {
      m.sends = Array.from({ length: SLOTS }, () => ({ fx: null, level: DEFAULT_LEVEL }));
      attached.set(m.id, { m, mix, active: Array(SLOTS).fill(null) });
    },
    detach(m) {
      const a = attached.get(m.id);
      if (!a) return;
      for (const entry of a.active) entry?.send.disconnect();
      attached.delete(m.id);
    },
    setSend,
  };
}
