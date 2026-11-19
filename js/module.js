import { buildPitchPool, midiToFreq, parseNote } from './scales.js';
import { pickChange, nextChangeDelay, clampFade } from './drone.js';
import { createTrack, advance } from './track.js';
import { stepDuration } from './timing.js';
import { mutationEvery } from './evolution.js';
import { mutateMelody, randomMelody } from './melody.js';
import { mutateRhythm, parsePattern, RHYTHM_PRESETS } from './rhythm.js';
import { playNote, playDrum, createDroneVoice, DEFAULT_ENV } from './synth.js';

let nextId = 1;
const DRUMS = ['kick', 'snare', 'hat'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const evolved = (pattern) => ({ current: pattern, base: [...pattern] });

const LIMITS = {
  bpm: [20, 300, false],
  swing: [0, 1, true],
  randomize: [1, 10, false],
  rhythmMod: [1, 10, false],
};

function applyParam(m, key, value) {
  if (key in LIMITS) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const [lo, hi, float] = LIMITS[key];
    m.params[key] = clamp(float ? n : Math.round(n), lo, hi);
  } else if (key.startsWith('voice:')) {
    const v = key.slice(6);
    m.params.voices[v] = value;
    m.state.voices[v] = evolved(parsePattern(value));
  } else if (key === 'rhythm') {
    m.params.rhythm = value;
    m.state.rhythm = evolved(parsePattern(value));
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
    tick(ctx, dest, now) {
      if (m.disposed || !m.running) return;
      if (!m.track) m.track = createTrack(now);
      for (const { time, stepIndex } of advance(m.track, now, m.params.bpm, m.params.swing)) {
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
      duration: stepDuration(mod.params.bpm) * 0.9,
      wave: mod.params.wave,
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
  };
  const state = { voices: Object.fromEntries(DRUMS.map((d) => [d, evolved(parsePattern(voices[d]))])) };
  const m = makeModule('rhythmic', params, state, [], (mod, ctx, dest, time, step) => {
    for (const kind of DRUMS) if (mod.state.voices[kind].current[step]) playDrum(ctx, dest, { kind, time });
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

  const spawn = (midi, peak) =>
    createDroneVoice(env.ctx, env.dest, { freq: midiToFreq(midi), wave: params.wave, peak, fade: params.fade });

  const isReleasing = (midi) => (releasing.get(midi) ?? 0) > 0;

  const release = (midi, voice) => {
    releasing.set(midi, (releasing.get(midi) ?? 0) + 1);
    voice.release(params.fade, () => releasing.set(midi, releasing.get(midi) - 1));
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
      if (rootVoice) rootVoice.kill();
      for (const v of active.values()) v.kill();
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

  m.setParam = (key, value) => {
    if (key === 'wave') {
      params.wave = value;
      if (!env || m.disposed) return;
      // Switching osc.type in place would be an instant jump: crossfade to new voices instead.
      if (rootVoice) {
        const old = rootVoice;
        rootVoice = spawn(rootMidi, ROOT_PEAK);
        release(rootMidi, old);
      }
      for (const [midi, old] of [...active]) {
        active.set(midi, spawn(midi, EXTRA_PEAK));
        release(midi, old);
      }
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
