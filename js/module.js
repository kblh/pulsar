import { buildPitchPool, melodicPool, midiToFreq, parseNote, OCTAVE_SHIFT_MAX, RAND_OCTAVES_MAX } from './scales.js';
import { pickChange, nextChangeDelay, clampFade } from './drone.js';
import { createTrack, advance } from './track.js';
import { stepDuration, effectiveBpm } from './timing.js';
import { mutationEvery } from './evolution.js';
import { mutateMelody, randomMelody } from './melody.js';
import { mutateRhythm, parsePattern, RHYTHM_PRESETS, lanePatternLength, remapPattern, positionsIn, stepAt, formatPattern, SUBS_MIN, SUBS_MAX } from './rhythm.js';
import { playNote, playDrum, createDroneVoice, startVoice, DEFAULT_ENV, DRUM_SOUNDS } from './synth.js';
import { WAVES } from './options.js';

let nextId = 1;
const DRUMS = ['kick', 'snare', 'hat'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finiteNum = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));
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
const OSC_COUNT = 3;
const OSC_DEFAULTS = [
  { wave: 'triangle', level: 1, octave: 0, detune: 0 },
  { wave: 'sawtooth', level: 0.4, octave: 0, detune: 7 },
  { wave: 'square', level: 0, octave: -1, detune: 0 },
];
/** One oscillator of the live synth from untrusted values; whatever is unusable keeps `base`'s value. */
export function cleanOsc(raw, base = OSC_DEFAULTS[0]) {
  const o = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    wave: WAVES.includes(o.wave) ? o.wave : base.wave,
    level: finiteNum(o.level) ? clamp(Number(o.level), 0, 1) : base.level,
    octave: finiteNum(o.octave) ? clamp(Math.round(Number(o.octave)), -2, 2) : base.octave,
    detune: finiteNum(o.detune) ? clamp(Math.round(Number(o.detune)), -50, 50) : base.detune,
  };
}
/** The three oscillators of the live synth; missing ones come from the defaults. */
export const cleanOscs = (raw) => OSC_DEFAULTS.map((d, i) => cleanOsc(Array.isArray(raw) ? raw[i] : undefined, d));
const evolved = (pattern) => ({ current: pattern, base: [...pattern] });

const LIMITS = {
  bpm: [20, 300, false],
  swing: [0, 1, true],
  randomize: [0, 10, false],
  rhythmMod: [0, 10, false],
  randOctaves: [0, RAND_OCTAVES_MAX, false],
  octave: [-2, 2, false],
  glide: [0, 0.15, true],
};


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

/** A melodic pitch config: one octave of the scale, moved by `octave` (the pool repeats it upward, see `melodicPool`). */
function cleanMelodicConfig(c) {
  const octave = Math.round(Number(c?.octave));
  return { ...c, octaves: 1, octave: Number.isFinite(octave) ? clamp(octave, -OCTAVE_SHIFT_MAX, OCTAVE_SHIFT_MAX) : 0 };
}

/** Rebuilds the pool after the pitch config (or the octaves the notes may climb) changed, and keeps the melody inside it. */
function refreshPool(m) {
  m.pool = m.type === 'melodic' ? melodicPool(m.params.pitchConfig, m.params.randOctaves) : buildPitchPool(m.params.pitchConfig);
  if (!m.state.melody) return; // the live synth has no melody to fit
  const max = m.pool.length - 1;
  const fit = (a) => a.map((i) => Math.min(i, max));
  m.state.melody = { current: fit(m.state.melody.current), base: fit(m.state.melody.base) };
}

function applyParam(m, key, value) {
  if (key === 'wave2' || key === 'mix' || key === 'detune') {
    if (key in m.params) applyOscParam(m.params, key, value); // the rhythmic module has none
  } else if (key in LIMITS) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const [lo, hi, float] = LIMITS[key];
    m.params[key] = clamp(float ? n : Math.round(n), lo, hi);
    if (key === 'randOctaves') refreshPool(m);
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
  } else if (key.startsWith('osc:')) {
    const i = Number(key.slice(4));
    if (Array.isArray(m.params.oscs) && Number.isInteger(i) && i >= 0 && i < OSC_COUNT) {
      m.params.oscs = m.params.oscs.map((o, k) => (k === i ? cleanOsc(value, o) : o));
    }
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
    m.params.pitchConfig = m.type === 'melodic' ? cleanMelodicConfig(value) : value;
    refreshPool(m);
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
    pitchConfig: { mode: 'scale', root: 'C', scale: 'pentatonicMinor' },
    rhythm: pick(Object.values(RHYTHM_PRESETS)),
    swing: 0,
    randomize: 5, // how much the notes change (0 = not at all)
    rhythmMod: 5, // how much the rhythm changes (0 = not at all)
    randOctaves: 0, // how many octaves above the base one the notes may climb to
    evolution: 'drift',
    ...overrides,
  };
  Object.assign(params, withOscParams(params, overrides));
  params.pitchConfig = cleanMelodicConfig(params.pitchConfig);
  const ro = Math.round(Number(params.randOctaves));
  params.randOctaves = Number.isFinite(ro) ? clamp(ro, 0, RAND_OCTAVES_MAX) : 0;
  const pool = melodicPool(params.pitchConfig, params.randOctaves);
  const baseSize = melodicPool(params.pitchConfig, 0).length; // the first melody stays in the base octave
  const state = {
    melody: evolved(randomMelody(16, baseSize, Math.random)),
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
    if (p.randomize > 0 && m.bars % mutationEvery(p.randomize) === 0) {
      m.state.melody = mutateMelody(m.state.melody, {
        level: p.randomize,
        mode: p.evolution,
        poolSize: m.pool.length,
        amount: Math.ceil(p.randomize * 0.8), // level 10 changes half of the steps in every loop
        active: m.state.rhythm.current,
        octaveSize: melodicPool(p.pitchConfig, 0).length,
        octaves: p.randOctaves,
      }, Math.random);
    }
    if (p.rhythmMod > 0 && m.bars % mutationEvery(p.rhythmMod) === 0) {
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
    if (!(p.rhythmMod > 0) || m.bars % mutationEvery(p.rhythmMod) !== 0) return;
    for (const d of DRUMS) {
      m.state.voices[d] = mutateRhythm(m.state.voices[d], { level: p.rhythmMod, mode: p.evolution }, Math.random);
    }
  };
  return m;
}

/** Number of pads of the live synth (a 4 x 4 grid). */
export const PADS = 16;

/** The MIDI note of a pad: the scale's notes in ascending order from the bottom left, repeating an octave higher. */
export function padNote(pitchConfig, pad, octave = 0) {
  const degrees = buildPitchPool({ ...pitchConfig, octaves: 1 });
  const n = degrees.length;
  const note = degrees[pad % n] + 12 * Math.floor(pad / n) + 12 * octave;
  return clamp(note, 0, 127);
}

/** 'root' for the scale's root note, 'fifth' for the note a fifth above it (any octave), otherwise null. */
export function padRole(pitchConfig, pad) {
  const diff = (((padNote(pitchConfig, pad) - padNote(pitchConfig, 0)) % 12) + 12) % 12;
  return diff === 0 ? 'root' : diff === 7 ? 'fifth' : null;
}

export function createSynthModule(overrides = {}) {
  const params = {
    env: { ...DEFAULT_ENV, a: 0.02, r: 0.4 },
    pitchConfig: { mode: 'scale', root: 'C', scale: 'pentatonicMinor', octaves: 1 },
    octave: 0,
    glide: 0,
    ...overrides,
    oscs: cleanOscs(overrides.oscs),
  };
  params.octave = clamp(Math.round(Number(params.octave)) || 0, -2, 2);
  params.glide = clamp(Number(params.glide) || 0, 0, 0.15);
  const voices = new Map(); // pad -> the sounding voice
  const m = makeModule('synth', params, { held: voices }, buildPitchPool(params.pitchConfig), () => {});
  let audio = null;
  m.attach = (ctx, dest) => { audio = { ctx, dest }; };
  m.tick = () => {}; // nothing is scheduled: the player is the clock
  m.padNote = (pad) => padNote(m.params.pitchConfig, pad, m.params.octave);
  m.padRole = (pad) => padRole(m.params.pitchConfig, pad);
  m.noteOn = (pad) => {
    if (!audio || m.disposed || !m.running || !Number.isInteger(pad) || pad < 0 || pad >= PADS) return;
    voices.get(pad)?.release();
    if (voices.size >= PADS * 2) return;
    voices.set(pad, startVoice(audio.ctx, audio.dest, { freq: midiToFreq(m.padNote(pad)), oscs: m.params.oscs, env: m.params.env }));
  };
  m.noteOff = (pad) => {
    voices.get(pad)?.release();
    voices.delete(pad);
  };
  // A finger sliding from one pad to the next: with portamento the held note glides to the new pitch (legato), else a new note.
  m.slide = (from, to) => {
    const v = voices.get(from);
    if (!v || m.params.glide <= 0 || voices.has(to) || !Number.isInteger(to) || to < 0 || to >= PADS) {
      m.noteOff(from);
      m.noteOn(to);
      return;
    }
    voices.delete(from);
    voices.set(to, v);
    v.glideTo(midiToFreq(m.padNote(to)), m.params.glide);
  };
  m.releaseAll = () => {
    for (const v of voices.values()) v.release();
    voices.clear();
  };
  const stop = m.stop;
  m.stop = () => {
    m.releaseAll();
    stop();
  };
  const dispose = m.dispose;
  m.dispose = () => {
    for (const v of voices.values()) v.kill();
    voices.clear();
    dispose();
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
