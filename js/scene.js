import { clampFxParam, FX_TYPES } from './fx.js';
import { clampVolume, clampPan, clampLevel } from './mix.js';
import { SLOTS } from './sends.js';
import { SCALES } from './scales.js';
import { DEFAULT_ENV } from './synth.js';
import { WAVES, ROOTS } from './options.js';
import { createMelodicModule, createRhythmicModule, createDroneModule, createSynthModule, cleanOscs, cleanSounds, cleanRotation } from './module.js';
import { cleanDuration, MAX_PARTS } from './sequence.js';
import { cleanTempo, DEFAULT_TEMPO } from './timing.js';

export const NAME_MAX = 24;
const MODULE_TYPES = ['melodic', 'rhythmic', 'drone', 'synth'];
export const MAX_MODULES = 64;
export const MAX_EFFECTS = 32;
const MAX_PATTERN = 64;
export const DEFAULT_SEND_LEVEL = 0.3;
const NUMBER_KEYS = { melodic: ['bpm', 'swing', 'randomize', 'rhythmMod'], rhythmic: ['bpm', 'swing', 'rhythmMod'], drone: ['rate', 'maxExtra', 'fade'], synth: ['glide'] };

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const clone = (x) => JSON.parse(JSON.stringify(x));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A user-given name: trimmed, at most NAME_MAX characters, or the fallback. */
export function cleanName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, NAME_MAX).trim() || fallback;
}

/** One module as plain data, without its sends (those point at effects of the scene). */
export function serializeModule(m, stoppedByTransport = () => false) {
  return {
    type: m.type,
    name: m.name ?? m.type,
    params: clone(m.params),
    volume: m.volume ?? 1,
    pan: m.pan ?? 0,
    running: m.running || stoppedByTransport(m), // [stop all] is not a hand-made stop
  };
}

/** Plain-data snapshot of what the user set up (not the evolved state). `stoppedByTransport(m)` marks modules only [stop all] stopped. */
export function serializeScene({ modules, effects, stoppedByTransport = () => false, sequence = null, tempo = null }) {
  const index = new Map(effects.map((fx, i) => [fx.id, i]));
  const position = new Map(modules.map((m, i) => [m.id, i]));
  const seq = sequence?.toData();
  return {
    version: 1,
    ...(tempo ? { tempo: cleanTempo(tempo) } : {}),
    effects: effects.map((fx) => ({ type: fx.type, name: fx.name ?? fx.type, enabled: fx.enabled !== false, params: clone(fx.params) })),
    modules: modules.map((m) => ({
      ...serializeModule(m, stoppedByTransport),
      sends: (m.sends ?? []).map((s) => ({ fx: index.has(s.fx) ? index.get(s.fx) : null, level: s.level })),
    })),
    // Members are saved as positions in `modules`, so the scene does not depend on module ids.
    ...(seq
      ? {
        sequence: {
          name: seq.name,
          loop: seq.loop,
          parts: seq.parts.map((p) => ({ name: p.name, duration: p.duration, modules: p.modules.filter((id) => position.has(id)).map((id) => position.get(id)) })),
        },
      }
      : {}),
  };
}

/** A sequence from untrusted data: `remap` turns saved module positions into positions in the cleaned scene. Null when unusable. */
function cleanSequence(raw, remap, problems) {
  if (!isObj(raw) || !Array.isArray(raw.parts)) {
    problems.push('sequence: nothing usable in it');
    return null;
  }
  if (raw.parts.length > MAX_PARTS) problems.push(`sequence: only the first ${MAX_PARTS} parts are used`);
  const parts = raw.parts.slice(0, MAX_PARTS).map((p, i) => {
    const o = isObj(p) ? p : {};
    const members = [];
    if (Array.isArray(o.modules)) {
      for (const x of o.modules.slice(0, MAX_MODULES * 2)) {
        if (Number.isInteger(x) && remap.has(x) && !members.includes(remap.get(x))) members.push(remap.get(x));
      }
    }
    return { name: cleanName(o.name, `part ${i + 1}`), duration: cleanDuration(o.duration), modules: members };
  });
  return { name: cleanName(raw.name, 'sequence'), loop: raw.loop === true, parts };
}

function cleanPitchConfig(c) {
  if (!isObj(c)) return undefined;
  const out = { mode: c.mode === 'notes' ? 'notes' : 'scale' };
  if (ROOTS.includes(c.root)) out.root = c.root;
  if (Object.hasOwn(SCALES, c.scale)) out.scale = c.scale;
  if (isNum(c.octaves)) out.octaves = clamp(Math.round(c.octaves), 1, 4);
  if (typeof c.notes === 'string') out.notes = c.notes.slice(0, 200);
  return out;
}

function cleanEnv(e) {
  if (!isObj(e)) return undefined;
  const env = { ...DEFAULT_ENV };
  for (const k of ['a', 'd', 'r']) if (isNum(e[k])) env[k] = clamp(e[k], 0, 5);
  if (isNum(e.s)) env.s = clamp(e.s, 0, 1);
  return env;
}

function cleanModuleParams(type, p) {
  const out = {};
  if (!isObj(p)) return out;
  for (const k of NUMBER_KEYS[type]) if (isNum(p[k])) out[k] = p[k];
  if (WAVES.includes(p.wave) && type !== 'rhythmic' && type !== 'synth') out.wave = p.wave;
  if ((p.evolution === 'drift' || p.evolution === 'walk') && type !== 'drone' && type !== 'synth') out.evolution = p.evolution;
  if (type !== 'rhythmic') {
    const pc = cleanPitchConfig(p.pitchConfig);
    if (pc) out.pitchConfig = pc;
    // The second oscillator; a scene without these keys keeps the module's defaults (mix 0 = one oscillator).
    if (type !== 'synth' && WAVES.includes(p.wave2)) out.wave2 = p.wave2;
    if (type !== 'synth' && isNum(p.mix)) out.mix = clamp(p.mix, 0, 1);
    if (type !== 'synth' && isNum(p.detune)) out.detune = clamp(Math.round(p.detune), -50, 50);
  }
  if (type === 'synth') {
    if (Array.isArray(p.oscs)) out.oscs = cleanOscs(p.oscs);
    if (isNum(p.octave)) out.octave = clamp(Math.round(p.octave), -2, 2);
    const env = cleanEnv(p.env);
    if (env) out.env = env;
  }
  if (type === 'melodic') {
    if (typeof p.rhythm === 'string') out.rhythm = p.rhythm.slice(0, MAX_PATTERN);
    const env = cleanEnv(p.env);
    if (env) out.env = env;
  }
  if (type === 'rhythmic' && isObj(p.voices)) {
    const voices = {};
    for (const d of ['kick', 'snare', 'hat']) if (typeof p.voices[d] === 'string') voices[d] = p.voices[d].slice(0, MAX_PATTERN);
    if (Object.keys(voices).length) out.voices = voices;
  }
  if (type === 'rhythmic' && isObj(p.sounds)) out.sounds = cleanSounds(p.sounds);
  if (type === 'rhythmic' && isObj(p.rotation)) out.rotation = cleanRotation(p.rotation, out.voices);
  if (type === 'rhythmic' && isObj(p.mute)) {
    out.mute = Object.fromEntries(['kick', 'snare', 'hat'].map((d) => [d, p.mute[d] === true]));
  }
  if (type === 'drone' && typeof p.rootNote === 'string') out.rootNote = p.rootNote.slice(0, 8);
  return out;
}

/**
 * One module from untrusted data, or null when it is not an object or of an unknown type.
 * `fxRemap` turns saved effect positions into positions of the scene being built; without one every send is empty.
 */
export function cleanModule(m, fxRemap = new Map()) {
  if (!isObj(m) || !MODULE_TYPES.includes(m.type)) return null;
  const given = Array.isArray(m.sends) ? m.sends.slice(0, SLOTS) : [];
  const sends = Array.from({ length: SLOTS }, (_, s) => {
    const x = isObj(given[s]) ? given[s] : {};
    return {
      fx: Number.isInteger(x.fx) && fxRemap.has(x.fx) ? fxRemap.get(x.fx) : null,
      level: isNum(x.level) ? clampLevel(x.level) : DEFAULT_SEND_LEVEL,
    };
  });
  return {
    type: m.type,
    name: cleanName(m.name, m.type),
    params: cleanModuleParams(m.type, m.params),
    volume: isNum(m.volume) ? clampVolume(m.volume) : 1,
    pan: isNum(m.pan) ? clampPan(m.pan) : 0,
    running: typeof m.running === 'boolean' ? m.running : true,
    sends,
  };
}

/** Normalizes untrusted scene data; unusable parts are dropped and reported in `problems`. */
export function validateScene(data) {
  const problems = [];
  if (!isObj(data) || data.version !== 1) return { scene: null, problems: ['not a version 1 scene'] };

  const remap = new Map(); // old effect index -> new index
  const effects = [];
  let effectsCapped = false;
  (Array.isArray(data.effects) ? data.effects : []).forEach((e, i) => {
    if (effects.length >= MAX_EFFECTS) {
      if (!effectsCapped) problems.push(`only the first ${MAX_EFFECTS} effects are used`);
      effectsCapped = true;
      return;
    }
    if (!isObj(e) || !FX_TYPES.includes(e.type)) {
      problems.push(`effect ${i + 1}: unknown type`);
      return;
    }
    const params = {};
    if (isObj(e.params)) {
      for (const [k, v] of Object.entries(e.params)) {
        const n = clampFxParam(e.type, k, v);
        if (n !== null) params[k] = n;
      }
    }
    remap.set(i, effects.length);
    effects.push({ type: e.type, name: cleanName(e.name, e.type), enabled: typeof e.enabled === 'boolean' ? e.enabled : true, params });
  });

  const modules = [];
  const moduleRemap = new Map(); // saved module position -> position after cleaning
  let modulesCapped = false;
  (Array.isArray(data.modules) ? data.modules : []).forEach((m, i) => {
    if (modules.length >= MAX_MODULES) {
      if (!modulesCapped) problems.push(`only the first ${MAX_MODULES} modules are used`);
      modulesCapped = true;
      return;
    }
    const clean = cleanModule(m, remap);
    if (!clean) {
      problems.push(`module ${i + 1}: unknown type`);
      return;
    }
    moduleRemap.set(i, modules.length);
    modules.push(clean);
  });

  if (!effects.length && !modules.length) return { scene: null, problems: [...problems, 'scene is empty'] };
  const sequence = data.sequence === undefined ? null : cleanSequence(data.sequence, moduleRemap, problems);
  const tempo = isObj(data.tempo) ? cleanTempo(data.tempo) : null; // older scenes have none
  return { scene: { version: 1, effects, modules, ...(sequence ? { sequence } : {}), ...(tempo ? { tempo } : {}) }, problems };
}

const FACTORIES = { melodic: createMelodicModule, rhythmic: createRhythmicModule, drone: createDroneModule, synth: createSynthModule };

function applyParams(m, params) {
  for (const [key, value] of Object.entries(params)) {
    if (m.type === 'rhythmic' && key === 'voices') {
      for (const [drum, pattern] of Object.entries(value)) m.setParam(`voice:${drum}`, pattern);
    } else if (m.type === 'rhythmic' && key === 'rotation') {
      for (const [drum, n] of Object.entries(value)) m.setParam(`rotation:${drum}`, n);
    } else if (m.type === 'rhythmic' && key === 'sounds') {
      for (const [drum, n] of Object.entries(value)) m.setParam(`sound:${drum}`, n);
    } else if (m.type === 'rhythmic' && key === 'mute') {
      for (const [drum, on] of Object.entries(value)) m.setParam(`mute:${drum}`, on);
    } else {
      m.setParam(key, value);
    }
  }
}

/**
 * Builds one module from cleaned data (see cleanModule) and adds it to the engine: parameters, name, volume, pan,
 * sends (`fxs` are the effects built so far, by saved position) and the running state. A module that cannot be finished
 * is removed again and the error is thrown. The caller adds the panel.
 */
export function addModuleFromData(engine, e, { fxs = [] } = {}) {
  const m = FACTORIES[e.type]();
  applyParams(m, e.params);
  m.name = e.name;
  engine.addModule(m);
  try {
    engine.setVolume(m, e.volume);
    engine.setPan(m, e.pan);
    e.sends.forEach((s, slot) => engine.setSend(m, slot, { fx: fxs[s.fx]?.id ?? null, level: s.level }));
    if (!e.running) engine.setRunning(m, false); // not toggle: a module registered while [stop all] is active is stopped already
  } catch (err) {
    try { engine.removeModule(m.id); } catch { /* already gone */ }
    throw err;
  }
  return m;
}

/**
 * Replaces the current setup with a validated scene.
 * `ui` = { clear(), addFxPanel(fx), addModulePanel(m), addSequencePanel?(sequence) }; clear() must remove every module, effect and the sequence.
 * Parts that fail to build are skipped (and reported), never left half-built.
 */
export function applyScene(engine, scene, ui) {
  const skipped = [];
  ui.clear();
  engine.setTempo(scene.tempo ?? DEFAULT_TEMPO); // a scene without a tempo plays at the modules' own
  if (engine.isStopped()) engine.playAll(); // a leftover [stop all] would otherwise start the new modules stopped

  const fxs = scene.effects.map((e, i) => {
    let fx = null;
    try {
      fx = engine.addEffect(e.type, e.params);
      fx.name = e.name;
      if (!e.enabled) engine.setFxEnabled(fx, false);
      ui.addFxPanel(fx);
      return fx;
    } catch {
      if (fx) {
        try { engine.removeEffect(fx.id); } catch { /* already gone */ }
      }
      skipped.push(`effect ${i + 1} (${e.type})`);
      return null;
    }
  });

  const built = []; // scene module position -> id of the module that was built (undefined when it failed)
  scene.modules.forEach((e, i) => {
    let m = null;
    try {
      m = addModuleFromData(engine, e, { fxs });
      ui.addModulePanel(m);
      built[i] = m.id;
    } catch {
      if (m) {
        try { engine.removeModule(m.id); } catch { /* already gone */ }
      }
      skipped.push(`module ${i + 1} (${e.type})`);
    }
  });

  if (scene.sequence) {
    try {
      const { name, loop, parts } = scene.sequence;
      const sequence = engine.addSequence({
        name,
        loop,
        parts: parts.map((p) => ({ name: p.name, duration: p.duration, modules: p.modules.map((i) => built[i]).filter((id) => id !== undefined) })),
      });
      ui.addSequencePanel?.(sequence);
    } catch {
      skipped.push('sequence');
    }
  }
  return { skipped };
}
