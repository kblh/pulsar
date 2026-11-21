export const STEPS_PER_BAR = 16;

export function stepDuration(bpm) {
  return 60 / bpm / 4;
}

export function swingDelay(stepIndex, swing, bpm) {
  return stepIndex % 2 === 1 ? (swing * stepDuration(bpm)) / 2 : 0;
}

export const TEMPO_MIN = 20;
export const TEMPO_MAX = 300;
export const DEFAULT_TEMPO = Object.freeze({ on: false, bpm: 120 });

const clampBpm = (v) => Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, v));

/** The global tempo from untrusted data: `on` only for a real `true`, `bpm` only for a finite number (rounded, 20-300). */
export function cleanTempo(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_TEMPO };
  const bpm = typeof raw.bpm === 'number' && Number.isFinite(raw.bpm) ? clampBpm(Math.round(raw.bpm)) : DEFAULT_TEMPO.bpm;
  return { on: raw.on === true, bpm };
}

/** The tempo a module plays at: the global one while it is on, otherwise the module's own. */
export function effectiveBpm(ownBpm, tempo) {
  if (tempo?.on === true && Number.isFinite(tempo.bpm)) return clampBpm(tempo.bpm);
  return ownBpm;
}

/** The global tempo as one stable object (`state`) that is changed in place. */
export function createTempo(initial) {
  const state = cleanTempo(initial);
  return {
    state,
    set(partial) {
      Object.assign(state, cleanTempo({ ...state, ...partial }));
    },
  };
}
