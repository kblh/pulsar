export const MAX_PARTS = 32;
export const MIN_DURATION = 1;
export const MAX_DURATION = 600;
export const DEFAULT_DURATION = 30;
export const MIN_BARS = 1;
export const MAX_BARS = 256;
export const DEFAULT_BARS = 8;
export const UNITS = ['sec', 'bars'];
const NAME_MAX = 24;

const usable = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cleanText = (v, fallback) => (typeof v === 'string' ? v.trim().slice(0, NAME_MAX).trim() || fallback : fallback);

/** The unit part lengths are given in: 'sec' or 'bars' (a bar is four beats at the global tempo); anything else is 'sec'. */
export const cleanUnit = (u) => (u === 'bars' ? 'bars' : 'sec');

/** A part length in whole seconds (1..600) or whole bars (1..256); anything unusable means the default. */
export function cleanDuration(v, unit = 'sec') {
  if (unit === 'bars') return usable(v) ? clamp(Math.round(Number(v)), MIN_BARS, MAX_BARS) : DEFAULT_BARS;
  return usable(v) ? clamp(Math.round(Number(v)), MIN_DURATION, MAX_DURATION) : DEFAULT_DURATION;
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The song structure: parts that play one after another, each with the modules that sound in it.
 * Pure state machine; `host` is { ids(), isRunning(id), setRunning(id, on), barSeconds()? } and is only called when a part is entered
 * (`barSeconds` is the length of a bar at the global tempo, asked whenever lengths are given in bars; 2 s when the host has none).
 * `running` means the progress runs; stop() pauses it (position kept), start() resumes.
 */
export function createSequence({ name, loop, parts, unit } = {}, host) {
  const unitNow = cleanUnit(unit);
  const existing = () => new Set(host.ids());
  const cleanMembers = (list, known) => {
    const out = [];
    if (Array.isArray(list)) for (const id of list) if (Number.isInteger(id) && known.has(id) && !out.includes(id)) out.push(id);
    return out;
  };
  const known = existing();
  const given = (Array.isArray(parts) ? parts : []).slice(0, MAX_PARTS).map((p, i) => {
    const o = isObj(p) ? p : {};
    return { name: cleanText(o.name, `part ${i + 1}`), duration: cleanDuration(o.duration, unitNow), modules: cleanMembers(o.modules, known) };
  });

  let last = null; // audio time of the previous tick while running
  const seq = {
    id: 'sequence',
    type: 'sequence',
    name: cleanText(name, 'sequence'),
    loop: loop === true,
    unit: unitNow,
    parts: given,
    index: 0,
    elapsed: 0,
    running: false,
  };

  /**
   * Members of the current part run, controlled modules outside it stop. Every controlled module is told its state,
   * also when it already has it: the host makes that a hand-made state, so the transport's [play all] cannot bring back
   * a module this part does not want. Starting a module that already runs does nothing there.
   */
  function enter() {
    const part = seq.parts[seq.index];
    if (!part) return;
    const here = new Set(part.modules);
    const live = existing();
    const controlled = new Set(seq.parts.flatMap((p) => p.modules));
    for (const id of controlled) {
      if (!live.has(id)) continue;
      host.setRunning(id, here.has(id));
    }
  }

  function jump(i) {
    seq.index = i;
    seq.elapsed = 0;
    if (seq.running) enter();
  }

  const barSeconds = () => {
    const s = host.barSeconds?.();
    return Number.isFinite(s) && s > 0 ? s : 2;
  };
  /** The length of a part in seconds, whatever the unit (bars follow the global tempo as it is now). */
  const secondsOf = (p) => (seq.unit === 'bars' ? p.duration * barSeconds() : p.duration);
  const total = () => seq.parts.reduce((s, p) => s + secondsOf(p), 0);
  const before = (i) => seq.parts.slice(0, i).reduce((s, p) => s + secondsOf(p), 0);
  const partIndex = (i) => Number.isInteger(i) && i >= 0 && i < seq.parts.length;

  Object.assign(seq, {
    start() {
      if (!seq.parts.length || seq.running) return;
      seq.running = true;
      last = null;
      if (seq.elapsed === 0) enter();
    },
    stop() {
      seq.running = false;
      last = null;
    },
    rewind() {
      seq.elapsed = 0;
      last = null;
    },
    /** The user's own play: make the modules match the current part, also when it is resumed mid-part. */
    apply() {
      if (seq.running) enter();
    },
    /** Called by the transport after [play all] has restarted everything: a part that was just entered has the last word. */
    settle() {
      if (seq.running && seq.elapsed === 0) enter();
    },
    tick(now) {
      if (!seq.running) {
        last = null;
        return;
      }
      if (!Number.isFinite(now)) return;
      if (last === null) {
        last = now;
        return;
      }
      const dt = Math.max(0, now - last);
      last = now;
      if (!seq.parts.length) return;
      let pos = before(seq.index) + seq.elapsed + dt;
      const all = total();
      if (pos >= all) {
        if (!seq.loop) {
          seq.running = false;
          seq.index = 0;
          seq.elapsed = 0;
          last = null;
          return;
        }
        pos %= all; // however long the gap was, one step is enough
      }
      let i = 0;
      while (i < seq.parts.length - 1 && pos >= secondsOf(seq.parts[i])) {
        pos -= secondsOf(seq.parts[i]);
        i++;
      }
      const changed = i !== seq.index;
      seq.index = i;
      seq.elapsed = pos;
      if (changed) enter();
    },
    next() {
      if (!seq.parts.length) return;
      let i = seq.index + 1;
      if (i >= seq.parts.length) {
        if (!seq.loop) return;
        i = 0;
      }
      jump(i);
    },
    prev() {
      if (!seq.parts.length) return;
      let i = seq.index - 1;
      if (i < 0) {
        if (!seq.loop) return;
        i = seq.parts.length - 1;
      }
      jump(i);
    },
    /** The length of part `i` in seconds. */
    partSeconds: (i) => (seq.parts[i] ? secondsOf(seq.parts[i]) : 0),
    remaining: () => (seq.parts[seq.index] ? Math.max(0, secondsOf(seq.parts[seq.index]) - seq.elapsed) : 0),
    /** Switches the unit of every part length, keeping each part about as long as it was (a bar is taken at the global tempo now). */
    setUnit(next) {
      const to = cleanUnit(next);
      if (to === seq.unit) return;
      const bar = barSeconds();
      for (const p of seq.parts) p.duration = cleanDuration(to === 'bars' ? p.duration / bar : p.duration * bar, to);
      seq.unit = to;
    },
    addPart() {
      if (seq.parts.length >= MAX_PARTS) return -1;
      const duration = seq.parts.length ? seq.parts[seq.parts.length - 1].duration : seq.unit === 'bars' ? DEFAULT_BARS : DEFAULT_DURATION;
      seq.parts.push({ name: `part ${seq.parts.length + 1}`, duration, modules: [] });
      return seq.parts.length - 1;
    },
    removePart(i) {
      if (!partIndex(i)) return;
      seq.parts.splice(i, 1);
      if (!seq.parts.length) {
        seq.index = 0;
        seq.elapsed = 0;
        seq.running = false;
        last = null;
      } else if (i < seq.index) {
        seq.index--;
      } else if (i === seq.index) {
        seq.index = Math.min(seq.index, seq.parts.length - 1);
        seq.elapsed = 0;
        if (seq.running) enter();
      }
    },
    movePart(i, dir) {
      const j = i + dir;
      if (!partIndex(i) || (dir !== -1 && dir !== 1) || !partIndex(j)) return;
      [seq.parts[i], seq.parts[j]] = [seq.parts[j], seq.parts[i]];
      if (seq.index === i) seq.index = j;
      else if (seq.index === j) seq.index = i;
    },
    setPart(i, patch) {
      if (!partIndex(i) || !isObj(patch)) return;
      const part = seq.parts[i];
      if (typeof patch.name === 'string') part.name = cleanText(patch.name, `part ${i + 1}`);
      if ('duration' in patch) part.duration = cleanDuration(patch.duration, seq.unit);
    },
    toggleMember(i, id) {
      if (!partIndex(i) || !Number.isInteger(id) || !existing().has(id)) return;
      const members = seq.parts[i].modules;
      const at = members.indexOf(id);
      if (at >= 0) members.splice(at, 1);
      else members.push(id);
    },
    useRunning(i) {
      if (!partIndex(i)) return;
      seq.parts[i].modules = host.ids().filter((id) => host.isRunning(id));
    },
    forgetModule(id) {
      for (const p of seq.parts) p.modules = p.modules.filter((m) => m !== id);
    },
    setLoop(on) {
      seq.loop = on === true;
    },
    setName(value) {
      seq.name = cleanText(value, 'sequence');
    },
    toData: () => ({
      name: seq.name,
      loop: seq.loop,
      unit: seq.unit,
      parts: seq.parts.map((p) => ({ name: p.name, duration: p.duration, modules: [...p.modules] })),
    }),
  });
  return seq;
}
