import { clampFxParam } from './fx.js';
import { clampVolume, clampPan, clampLevel } from './mix.js';
import { SCALES } from './scales.js';
import { DEFAULT_ENV } from './synth.js';
import { WAVES, ROOTS } from './options.js';

export const NAME_MAX = 24;
const FX_TYPES = ['delay', 'reverb'];
const MODULE_TYPES = ['melodic', 'rhythmic', 'drone'];
const SLOTS = 3;
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

/** Plain-data snapshot of what the user set up (not the evolved state). */
export function serializeScene({ modules, effects }) {
  const index = new Map(effects.map((fx, i) => [fx.id, i]));
  return {
    version: 1,
    effects: effects.map((fx) => ({ type: fx.type, name: fx.name ?? fx.type, params: clone(fx.params) })),
    modules: modules.map((m) => ({
      type: m.type,
      name: m.name ?? m.type,
      params: clone(m.params),
      volume: m.volume ?? 1,
      pan: m.pan ?? 0,
      running: m.running,
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
  }
  if (type === 'melodic') {
    if (typeof p.rhythm === 'string') out.rhythm = p.rhythm;
    const env = cleanEnv(p.env);
    if (env) out.env = env;
  }
  if (type === 'rhythmic' && isObj(p.voices)) {
    const voices = {};
    for (const d of ['kick', 'snare', 'hat']) if (typeof p.voices[d] === 'string') voices[d] = p.voices[d];
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
  (Array.isArray(data.effects) ? data.effects : []).forEach((e, i) => {
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
    effects.push({ type: e.type, name: cleanName(e.name, e.type), params });
  });

  const modules = [];
  (Array.isArray(data.modules) ? data.modules : []).forEach((m, i) => {
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
