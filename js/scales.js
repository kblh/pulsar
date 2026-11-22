const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const DEFAULT_CFG = { mode: 'scale', root: 'C', scale: 'pentatonicMinor', octaves: 2 };

export function parseNote(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(name).trim());
  if (!m) return null;
  const semis = NOTE_BASE[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return (Number(m[3]) + 1) * 12 + semis;
}

export const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** A note name without an octave ('C', 'F#', 'Bb') as 0-11, or null. */
export function parsePitchClass(name) {
  const m = /^([A-Ga-g])([#b]?)$/.exec(String(name).trim());
  if (!m) return null;
  return (NOTE_BASE[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function buildPitchPool(cfg) {
  if (cfg && cfg.mode === 'notes') {
    const octaves = Math.min(4, Math.max(1, Math.floor(cfg.octaves) || 2));
    const base = ((cfg.baseOctave ?? 3) + 1) * 12;
    const pool = [];
    for (const token of String(cfg.notes ?? '').split(/[\s,]+/)) {
      const note = parseNote(token);
      if (note !== null) {
        pool.push(note);
        continue;
      }
      const pc = parsePitchClass(token);
      if (pc !== null) for (let o = 0; o < octaves; o++) pool.push(base + pc + 12 * o); // a class token: every octave
    }
    if (pool.length) return [...new Set(pool)].sort((a, b) => a - b);
    return buildPitchPool(DEFAULT_CFG);
  }
  const c = { ...DEFAULT_CFG, ...cfg };
  const intervals = SCALES[c.scale] ?? SCALES[DEFAULT_CFG.scale];
  const rootSemis = parseNote(`${c.root}${c.baseOctave ?? 3}`);
  const base = rootSemis ?? parseNote(`C${c.baseOctave ?? 3}`);
  const octaves = Math.max(1, Math.floor(c.octaves) || 1);
  const pool = [];
  for (let o = 0; o < octaves; o++) for (const i of intervals) pool.push(base + 12 * o + i);
  return pool;
}

/** The pitch classes (0-11) in the pool, ascending. */
export function pitchClasses(cfg) {
  return [...new Set(buildPitchPool(cfg).map((n) => n % 12))].sort((a, b) => a - b);
}

/** `cfg` with pitch class `pc` switched on or off, as a `notes` config. The last class stays on (returns `cfg` itself). */
export function toggleClass(cfg, pc) {
  const set = new Set(pitchClasses(cfg));
  if (set.has(pc)) set.delete(pc);
  else set.add(pc);
  if (!set.size) return cfg;
  return { ...cfg, mode: 'notes', notes: [...set].sort((a, b) => a - b).map((c) => PITCH_CLASS_NAMES[c]).join(' ') };
}
