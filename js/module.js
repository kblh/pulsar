import { buildPitchPool, midiToFreq } from './scales.js';
import { createTrack, advance } from './track.js';
import { stepDuration } from './timing.js';
import { mutationEvery } from './evolution.js';
import { mutateMelody, randomMelody } from './melody.js';
import { mutateRhythm, parsePattern, RHYTHM_PRESETS } from './rhythm.js';
import { playNote, playDrum, DEFAULT_ENV } from './synth.js';

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
