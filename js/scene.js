import { clampFxParam, FX_TYPES } from './fx.js';
import { clampVolume, clampPan, clampLevel } from './mix.js';
import { SCALES } from './scales.js';
import { DEFAULT_ENV } from './synth.js';
import { WAVES, ROOTS } from './options.js';
import { createMelodicModule, createRhythmicModule, createDroneModule } from './module.js';

export const NAME_MAX = 24;
const MODULE_TYPES = ['melodic', 'rhythmic', 'drone'];
const SLOTS = 3;
export const MAX_MODULES = 64;
export const MAX_EFFECTS = 32;
const MAX_PATTERN = 64;
const DEFAULT_SEND_LEVEL = 0.3;
const NUMBER_KEYS = { melodic: ['bpm', 'swing', 'randomize', 'rhythmMod'], rhythmic: ['bpm', 'swing', 'rhythmMod'], drone: ['rate', 'maxExtra', 'fade'] };

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const clone = (x) => JSON.parse(JSON.stringify(x));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A user-given name: trimmed, at most NAME_MAX characters, or the fallback. */
export function cleanName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, NAME_MAX).trim() || fallback;
}

/** Plain-data snapshot of what the user set up (not the evolved state). `stoppedByTransport(m)` marks modules only [stop all] stopped. */
export function serializeScene({ modules, effects, stoppedByTransport = () => false }) {
  const index = new Map(effects.map((fx, i) => [fx.id, i]));
  return {
    version: 1,
    effects: effects.map((fx) => ({ type: fx.type, name: fx.name ?? fx.type, enabled: fx.enabled !== false, params: clone(fx.params) })),
    modules: modules.map((m) => ({
      type: m.type,
      name: m.name ?? m.type,
      params: clone(m.params),
      volume: m.volume ?? 1,
      pan: m.pan ?? 0,
      running: m.running || stoppedByTransport(m), // [stop all] is not a hand-made stop
      sends: (m.sends ?? []).map((s) => ({ fx: index.has(s.fx) ? index.get(s.fx) : null, level: s.level })),
    })),
  };
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
  if (WAVES.includes(p.wave) && type !== 'rhythmic') out.wave = p.wave;
  if ((p.evolution === 'drift' || p.evolution === 'walk') && type !== 'drone') out.evolution = p.evolution;
  if (type !== 'rhythmic') {
    const pc = cleanPitchConfig(p.pitchConfig);
    if (pc) out.pitchConfig = pc;
    // The second oscillator; a scene without these keys keeps the module's defaults (mix 0 = one oscillator).
    if (WAVES.includes(p.wave2)) out.wave2 = p.wave2;
    if (isNum(p.mix)) out.mix = clamp(p.mix, 0, 1);
    if (isNum(p.detune)) out.detune = clamp(Math.round(p.detune), -50, 50);
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
  if (type === 'drone' && typeof p.rootNote === 'string') out.rootNote = p.rootNote.slice(0, 8);
  return out;
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
  let modulesCapped = false;
  (Array.isArray(data.modules) ? data.modules : []).forEach((m, i) => {
    if (modules.length >= MAX_MODULES) {
      if (!modulesCapped) problems.push(`only the first ${MAX_MODULES} modules are used`);
      modulesCapped = true;
      return;
    }
    if (!isObj(m) || !MODULE_TYPES.includes(m.type)) {
      problems.push(`module ${i + 1}: unknown type`);
      return;
    }
    const given = Array.isArray(m.sends) ? m.sends.slice(0, SLOTS) : [];
    const sends = Array.from({ length: SLOTS }, (_, s) => {
      const x = isObj(given[s]) ? given[s] : {};
      return {
        fx: Number.isInteger(x.fx) && remap.has(x.fx) ? remap.get(x.fx) : null,
        level: isNum(x.level) ? clampLevel(x.level) : DEFAULT_SEND_LEVEL,
      };
    });
    modules.push({
      type: m.type,
      name: cleanName(m.name, m.type),
      params: cleanModuleParams(m.type, m.params),
      volume: isNum(m.volume) ? clampVolume(m.volume) : 1,
      pan: isNum(m.pan) ? clampPan(m.pan) : 0,
      running: typeof m.running === 'boolean' ? m.running : true,
      sends,
    });
  });

  if (!effects.length && !modules.length) return { scene: null, problems: [...problems, 'scene is empty'] };
  return { scene: { version: 1, effects, modules }, problems };
}

const FACTORIES = { melodic: createMelodicModule, rhythmic: createRhythmicModule, drone: createDroneModule };

function applyParams(m, params) {
  for (const [key, value] of Object.entries(params)) {
    if (m.type === 'rhythmic' && key === 'voices') {
      for (const [drum, pattern] of Object.entries(value)) m.setParam(`voice:${drum}`, pattern);
    } else {
      m.setParam(key, value);
    }
  }
}

/**
 * Replaces the current setup with a validated scene.
 * `ui` = { clear(), addFxPanel(fx), addModulePanel(m) }; clear() must remove every module and effect.
 * Parts that fail to build are skipped (and reported), never left half-built.
 */
export function applyScene(engine, scene, ui) {
  const skipped = [];
  ui.clear();
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

  scene.modules.forEach((e, i) => {
    let m = null;
    let added = false;
    try {
      m = FACTORIES[e.type]();
      applyParams(m, e.params);
      m.name = e.name;
      engine.addModule(m);
      added = true;
      engine.setVolume(m, e.volume);
      engine.setPan(m, e.pan);
      e.sends.forEach((s, slot) => engine.setSend(m, slot, { fx: fxs[s.fx]?.id ?? null, level: s.level }));
      if (!e.running) engine.toggle(m);
      ui.addModulePanel(m);
    } catch {
      if (added) {
        try { engine.removeModule(m.id); } catch { /* already gone */ }
      }
      skipped.push(`module ${i + 1} (${e.type})`);
    }
  });
  return { skipped };
}
