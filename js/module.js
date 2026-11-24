import { buildPitchPool, midiToFreq, parseNote } from './scales.js';
import { pickChange, nextChangeDelay, clampFade } from './drone.js';
import { createTrack, advance } from './track.js';
import { stepDuration, effectiveBpm } from './timing.js';
import { mutationEvery } from './evolution.js';
import { mutateMelody, randomMelody } from './melody.js';
import { mutateRhythm, parsePattern, RHYTHM_PRESETS, lanePatternLength, remapPattern, positionsIn, stepAt, formatPattern, SUBS_MIN, SUBS_MAX } from './rhythm.js';
import { playNote, playDrum, createDroneVoice, DEFAULT_ENV, DRUM_SOUNDS } from './synth.js';
import { WAVES } from './options.js';

let nextId = 1;
const DRUMS = ['kick', 'snare', 'hat'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const cleanMute = (raw) => Object.fromEntries(DRUMS.map((d) => [d, raw !== null && typeof raw === 'object' && raw[d] === true]));
/** A sound index per drum; a missing, fractional or out-of-range one becomes the first sound. */
export const cleanSounds = (raw) => Object.fromEntries(DRUMS.map((d) => {
  const n = raw !== null && typeof raw === 'object' ? raw[d] : undefined;
  return [d, Number.isInteger(n) && n >= 0 && n < DRUM_SOUNDS[d].length ? n : 0];
}));
/** A rotation per drum, whole steps inside the lane (0 up to its step count minus one). */
export const cleanRotation = (raw, voices) => Object.fromEntries(DRUMS.map((d) => {
  const n = raw !== null && typeof raw === 'object' ? raw[d] : undefined;
  const subs = lanePatternLength(voices?.[d]);
  return [d, Number.isInteger(n) ? ((n % subs) + subs) % subs : 0];
}));
const evolved = (pattern) => ({ current: pattern, base: [...pattern] });

const LIMITS = {
  bpm: [20, 300, false],
  swing: [0, 1, true],
  randomize: [1, 10, false],
  rhythmMod: [1, 10, false],
};

const finiteNum = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));

/** The second oscillator's parameters; unusable values leave `params` as they are. */
function applyOscParam(params, key, value) {
  if (key === 'wave2') {
    if (WAVES.includes(value)) params.wave2 = value;
  } else if (key === 'mix') {
    if (finiteNum(value)) params.mix = clamp(Number(value), 0, 1);
  } else if (key === 'detune') {
    if (finiteNum(value)) params.detune = clamp(Math.round(Number(value)), -50, 50);
  }
}

/** Gives a module the osc 2 parameters at their defaults and cleans any that were passed in as overrides. */
function withOscParams(params, overrides) {
  const out = { ...params, wave2: 'sawtooth', mix: 0, detune: 0 };
  for (const k of ['wave2', 'mix', 'detune']) if (k in overrides) applyOscParam(out, k, overrides[k]);
  return out;
}

function applyParam(m, key, value) {
  if (key === 'wave2' || key === 'mix' || key === 'detune') {
    if (key in m.params) applyOscParam(m.params, key, value); // the rhythmic module has none
  } else if (key in LIMITS) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const [lo, hi, float] = LIMITS[key];
    m.params[key] = clamp(float ? n : Math.round(n), lo, hi);
  } else if (key.startsWith('voice:')) {
    const v = key.slice(6);
    if (!DRUMS.includes(v)) return;
    m.params.voices[v] = value;
    m.state.voices[v] = evolved(parsePattern(value, { allowEmpty: true, length: lanePatternLength(value) }));
    m.params.rotation = cleanRotation(m.params.rotation, m.params.voices);
  } else if (key.startsWith('subs:')) {
    const d = key.slice(5);
    const n = Number(value);
    if (!DRUMS.includes(d) || !Number.isInteger(n) || n < SUBS_MIN || n > SUBS_MAX) return;
    applyParam(m, `voice:${d}`, formatPattern(remapPattern(m.state.voices[d].current, n)));
  } else if (key.startsWith('rotation:')) {
    const d = key.slice(9);
    const n = Number(value);
    if (DRUMS.includes(d) && Number.isInteger(n)) m.params.rotation = cleanRotation({ ...m.params.rotation, [d]: n }, m.params.voices);
  } else if (key.startsWith('sound:')) {
    const d = key.slice(6);
    const n = Number(value);
    if (DRUMS.includes(d) && Number.isInteger(n) && n >= 0 && n < DRUM_SOUNDS[d].length) m.params.sounds = { ...m.params.sounds, [d]: n };
  } else if (key.startsWith('mute:')) {
    const v = key.slice(5);
    if (DRUMS.includes(v)) m.params.mute[v] = value === true;
  } else if (key === 'rhythm') {
    m.params.rhythm = value;
    m.state.rhythm = evolved(parsePattern(value));
  } else if (key === 'env') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    const env = { ...m.params.env };
    for (const k of ['a', 'd', 's', 'r']) {
      const v = value[k];
      if (typeof v !== 'number' && !(typeof v === 'string' && v.trim() !== '')) continue;
      const n = Number(v);
      if (Number.isFinite(n)) env[k] = clamp(n, 0, k === 's' ? 1 : 5);
    }
    m.params.env = env;
  } else if (key === 'pitchConfig') {
    m.params.pitchConfig = value;
    m.pool = buildPitchPool(value);
    const max = m.pool.length - 1;
    const fit = (a) => a.map((i) => Math.min(i, max));
    m.state.melody = { current: fit(m.state.melody.current), base: fit(m.state.melody.base) };
  } else {
    m.params[key] = value;
  }
}

function makeModule(type, params, state, pool, onStep) {
  const m = {
    id: nextId++,
    type,
    name: type,
    params,
    state,
    pool,
    out: null,
    track: null,
    running: true,
    disposed: false,
    playhead: -1,
    bars: 0,
    bpm: params.bpm, // the tempo of the latest tick: the global one while it is on, else params.bpm
    setParam: (key, value) => applyParam(m, key, value),
    start() {
      m.running = true;
    },
    stop() {
      m.running = false;
      m.track = null;
      m.playhead = -1;
    },
    dispose() {
      m.disposed = true;
      m.running = false;
      if (m.out) m.out.disconnect();
    },
    tick(ctx, dest, now, tempo) {
      if (m.disposed || !m.running) return;
      if (!m.track) m.track = createTrack(now);
      m.bpm = effectiveBpm(m.params.bpm, tempo);
      for (const { time, stepIndex } of advance(m.track, now, m.bpm, m.params.swing)) {
        if (stepIndex === 0) {
          m.bars++;
          m.mutateBar();
        }
        m.playhead = stepIndex;
        onStep(m, ctx, dest, time, stepIndex);
      }
    },
  };
  return m;
}

export function createMelodicModule(overrides = {}) {
  const params = {
    wave: 'triangle',
    env: { ...DEFAULT_ENV },
    bpm: 90 + Math.floor(Math.random() * 51),
    pitchConfig: { mode: 'scale', root: 'C', scale: 'pentatonicMinor', octaves: 2 },
    rhythm: pick(Object.values(RHYTHM_PRESETS)),
    swing: 0,
    randomize: 3,
    rhythmMod: 3,
    evolution: 'drift',
    ...overrides,
  };
  Object.assign(params, withOscParams(params, overrides));
  const pool = buildPitchPool(params.pitchConfig);
  const state = {
    melody: evolved(randomMelody(16, pool.length, Math.random)),
    rhythm: evolved(parsePattern(params.rhythm)),
  };
  const m = makeModule('melodic', params, state, pool, (mod, ctx, dest, time, step) => {
    if (!mod.state.rhythm.current[step]) return;
    const idx = Math.min(mod.state.melody.current[step], mod.pool.length - 1);
    playNote(ctx, dest, {
      freq: midiToFreq(mod.pool[idx]),
      time,
      duration: stepDuration(mod.bpm) * 0.9,
      wave: mod.params.wave,
      wave2: mod.params.wave2,
      mix: mod.params.mix,
      detune: mod.params.detune,
      env: mod.params.env,
    });
  });
  m.mutateBar = () => {
    const p = m.params;
    if (m.bars % mutationEvery(p.randomize) === 0) {
      m.state.melody = mutateMelody(m.state.melody, { level: p.randomize, mode: p.evolution, poolSize: m.pool.length }, Math.random);
    }
    if (m.bars % mutationEvery(p.rhythmMod) === 0) {
      m.state.rhythm = mutateRhythm(m.state.rhythm, { level: p.rhythmMod, mode: p.evolution }, Math.random);
    }
  };
  return m;
}

export function createRhythmicModule(overrides = {}) {
  const voices = {
    kick: RHYTHM_PRESETS.fourOnFloor,
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.x.',
    ...(overrides.voices ?? {}),
  };
  const params = {
    bpm: 90 + Math.floor(Math.random() * 51),
    swing: 0,
    rhythmMod: 3,
    evolution: 'drift',
    ...overrides,
    voices,
    mute: cleanMute(overrides.mute),
    sounds: cleanSounds(overrides.sounds),
    rotation: cleanRotation(overrides.rotation, voices),
  };
  const state = {
    voices: Object.fromEntries(DRUMS.map((d) => [d, evolved(parsePattern(voices[d], { allowEmpty: true, length: lanePatternLength(voices[d]) }))])),
    positions: { kick: -1, snare: -1, hat: -1 }, // the latest position each lane passed, for the display
  };
  const m = makeModule('rhythmic', params, state, [], (mod, ctx, dest, time, step) => {
    const sixteenth = stepDuration(mod.bpm);
    for (const kind of DRUMS) {
      const { current } = mod.state.voices[kind];
      const rotation = mod.params.rotation[kind];
      for (const { pos, offset } of positionsIn(step, current.length)) {
        mod.state.positions[kind] = pos;
        if (!mod.params.mute[kind] && current[stepAt(pos, rotation, current.length)]) {
          playDrum(ctx, dest, { kind, sound: mod.params.sounds[kind], time: time + offset * sixteenth });
        }
      }
    }
  });
  m.mutateBar = () => {
    const p = m.params;
    if (m.bars % mutationEvery(p.rhythmMod) !== 0) return;
    for (const d of DRUMS) {
      m.state.voices[d] = mutateRhythm(m.state.voices[d], { level: p.rhythmMod, mode: p.evolution }, Math.random);
    }
  };
  return m;
}

const MAX_EXTRA_LIMIT = 6;
const ROOT_MIN = 12; // C0
const ROOT_MAX = 84; // C6
const validRoot = (midi) => midi !== null && midi >= ROOT_MIN && midi <= ROOT_MAX;
const ROOT_PEAK = 0.5;
const EXTRA_PEAK = 0.3;
const DRONE_OUT_LEVEL = 0.25;

export function createDroneModule(overrides = {}) {
  const params = {
    wave: 'sine',
    rootNote: 'C2',
    pitchConfig: { mode: 'scale', root: 'C', scale: 'pentatonicMinor', octaves: 2 },
    maxExtra: 2,
    rate: 3,
    fade: 4,
    ...overrides,
  };
  Object.assign(params, withOscParams(params, overrides));
  params.fade = clampFade(params.fade);
  const extra = Number(params.maxExtra);
  params.maxExtra = Number.isFinite(extra) ? clamp(Math.round(extra), 0, MAX_EXTRA_LIMIT) : 2;
  let rootMidi = parseNote(params.rootNote);
  if (!validRoot(rootMidi)) {
    params.rootNote = 'C2';
    rootMidi = parseNote('C2');
  }

  const active = new Map(); // extra midi -> voice (fading in or sustaining)
  const releasing = new Map(); // midi -> number of its voices still fading out (root included)
  let rootVoice = null;
  let nextChangeAt = null;
  let env = null; // { ctx, dest } from the latest tick

  const m = {
    id: nextId++,
    type: 'drone',
    name: 'drone',
    params,
    pool: buildPitchPool(params.pitchConfig),
    outLevel: DRONE_OUT_LEVEL,
    out: null,
    running: true,
    disposed: false,
    playhead: -1,
    state: {
      sounding: () => [rootMidi, ...[...active.keys()].sort((a, b) => a - b)],
      releasing: () => [...releasing].filter(([, n]) => n > 0).map(([midi]) => midi).sort((a, b) => a - b),
    },
  };

  const live = new Set(); // voices that still sound, fading ones included: mix and detune move all of them
  const spawn = (midi, peak) => {
    const voice = createDroneVoice(env.ctx, env.dest, {
      freq: midiToFreq(midi),
      wave: params.wave,
      wave2: params.wave2,
      mix: params.mix,
      detune: params.detune,
      peak,
      fade: params.fade,
    });
    live.add(voice);
    return voice;
  };

  const isReleasing = (midi) => (releasing.get(midi) ?? 0) > 0;

  const release = (midi, voice) => {
    releasing.set(midi, (releasing.get(midi) ?? 0) + 1);
    voice.release(params.fade, () => {
      releasing.set(midi, releasing.get(midi) - 1);
      live.delete(voice);
    });
  };

  const releaseExtra = (midi) => {
    const v = active.get(midi);
    if (!v) return;
    active.delete(midi);
    release(midi, v);
  };

  const rampOut = (target) => {
    if (m.out) m.out.gain.setTargetAtTime(target, m.out.context.currentTime, params.fade / 4);
  };

  m.tick = (ctx, dest, now) => {
    if (m.disposed || !m.running) return;
    env = { ctx, dest };
    if (!rootVoice && !isReleasing(rootMidi)) rootVoice = spawn(rootMidi, ROOT_PEAK);
    if (nextChangeAt === null) {
      nextChangeAt = now + nextChangeDelay(params.rate, Math.random);
      return;
    }
    if (now < nextChangeAt) return;
    const change = pickChange(
      { active: [...active.keys()], releasing: [...releasing].filter(([, n]) => n > 0).map(([midi]) => midi) },
      { pool: m.pool, root: rootMidi, maxExtra: params.maxExtra },
      Math.random,
    );
    if (change && 'add' in change) active.set(change.add, spawn(change.add, EXTRA_PEAK));
    else if (change) releaseExtra(change.remove);
    nextChangeAt = now + nextChangeDelay(params.rate, Math.random);
  };

  let shutdownTimer = null;
  const clearShutdown = () => {
    if (shutdownTimer !== null) clearTimeout(shutdownTimer);
    shutdownTimer = null;
  };

  m.start = () => {
    clearShutdown();
    m.running = true;
    nextChangeAt = null;
    rampOut(m.outLevel);
  };

  m.stop = () => {
    m.running = false;
    m.playhead = -1;
    rampOut(0);
    clearShutdown();
    // Once the output is silent, free the oscillators; start() brings the base back.
    shutdownTimer = setTimeout(() => {
      shutdownTimer = null;
      if (m.running || m.disposed) return;
      if (rootVoice) {
        live.delete(rootVoice);
        rootVoice.kill();
      }
      for (const v of active.values()) {
        live.delete(v);
        v.kill();
      }
      rootVoice = null;
      active.clear();
      nextChangeAt = null;
    }, params.fade * 2000 + 250);
  };

  m.dispose = () => {
    if (m.disposed) return;
    m.disposed = true;
    m.running = false;
    clearShutdown();
    rampOut(0);
    if (rootVoice) release(rootMidi, rootVoice);
    for (const midi of [...active.keys()]) releaseExtra(midi);
    const out = m.out;
    if (out) setTimeout(() => out.disconnect(), m.disposeDelay());
  };
  m.disposeDelay = () => params.fade * 2000 + 500;

  // Switching osc.type in place would be an instant jump: crossfade to new voices instead.
  const respawnVoices = () => {
    if (!env || m.disposed) return;
    if (rootVoice) {
      const old = rootVoice;
      rootVoice = spawn(rootMidi, ROOT_PEAK);
      release(rootMidi, old);
    }
    for (const [midi, old] of [...active]) {
      active.set(midi, spawn(midi, EXTRA_PEAK));
      release(midi, old);
    }
  };

  m.setParam = (key, value) => {
    if (key === 'wave') {
      params.wave = value;
      respawnVoices();
    } else if (key === 'wave2') {
      const before = params.wave2;
      applyOscParam(params, 'wave2', value);
      if (params.mix > 0 && params.wave2 !== before) respawnVoices(); // at mix 0 it only waits for the second oscillator
    } else if (key === 'mix' || key === 'detune') {
      applyOscParam(params, key, value);
      for (const voice of live) voice.setMix({ mix: params.mix, detune: params.detune, wave2: params.wave2 });
    } else if (key === 'rate') {
      const n = Number(value);
      if (Number.isFinite(n)) {
        params.rate = clamp(Math.round(n), 1, 10);
        nextChangeAt = null; // reschedule from the new rate on the next tick
      }
    } else if (key === 'maxExtra') {
      const n = Number(value);
      if (Number.isFinite(n)) params.maxExtra = clamp(Math.round(n), 0, MAX_EXTRA_LIMIT);
    } else if (key === 'fade') {
      params.fade = clampFade(Number(value));
    } else if (key === 'rootNote') {
      const midi = parseNote(String(value).trim());
      if (!validRoot(midi) || midi === rootMidi) return;
      const oldRoot = rootMidi;
      const oldVoice = rootVoice;
      params.rootNote = String(value).trim();
      rootMidi = midi;
      rootVoice = null;
      const promoted = active.get(midi);
      if (promoted) {
        // The tone already sounds as an extra: take it over rather than doubling it.
        active.delete(midi);
        rootVoice = promoted;
        promoted.setPeak(ROOT_PEAK);
      }
      if (oldVoice) {
        release(oldRoot, oldVoice);
        // A tone still fading out is not respawned; tick() does it once it has ended.
        if (!rootVoice && env && m.running && !m.disposed && !isReleasing(midi)) rootVoice = spawn(midi, ROOT_PEAK);
      }
    } else if (key === 'pitchConfig') {
      params.pitchConfig = value;
      m.pool = buildPitchPool(value);
      for (const midi of [...active.keys()]) if (!m.pool.includes(midi)) releaseExtra(midi);
    }
  };

  return m;
}
