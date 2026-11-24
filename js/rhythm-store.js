import { RHYTHM_PRESETS, lanePatternLength } from './rhythm.js';

/** The grooves of Buddy, with their own step counts (Tresillo has 8 steps, Bembé 12) and rotations, and one of Pulsar's own. */
export const BUILT_IN_RHYTHMS = [
  { id: 'metronome', name: 'Metronome', voices: { kick: 'x...............', snare: '................', hat: 'x...x...x...x...' } },
  { id: 'basic-rock', name: 'Basic Rock', voices: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' } },
  { id: 'bossa-nova', name: 'Bossa Nova', voices: { kick: 'x..x..x...x..x..', snare: '..x...x....x..x.', hat: 'x.x.x.x.x.x.x.x.' } },
  { id: 'tresillo', name: 'Tresillo', voices: { kick: 'x..x..x.', snare: '....x...', hat: 'xxxxxxxx' } },
  { id: 'son-clave', name: 'Son Clave', voices: { kick: 'x..x..x...x.x...', snare: '....x....x....x.', hat: 'x.x.x.x.x.x.x.x.' } },
  { id: 'rumba-clave', name: 'Rumba Clave', voices: { kick: 'x..x...x..x.x...', snare: '....x....x....x.', hat: 'x.x.x.x.x.x.x.x.' } },
  { id: 'shiko', name: 'Shiko', voices: { kick: 'x...x...', snare: '..x...x.', hat: 'x..x..x.' } },
  { id: 'bembe', name: 'Bembé', voices: { kick: 'x.x.x..x.x..', snare: '...x..x...x.', hat: 'xx.xx.xx.xx.' } },
  { id: 'samba', name: 'Samba', voices: { kick: 'x..x...x..x...x.', snare: '..x..x....x..x..', hat: 'xxxxxxxxxxxxxxxx' } },
  { id: 'gahu', name: 'Gahu', voices: { kick: 'x..x..x.', snare: '.x..x..x', hat: 'x.x.x.x.' } },
  { id: 'soukous', name: 'Soukous', voices: { kick: 'x...x...x...x...', snare: '..x...x...x...x.', hat: 'x.xx.xx.xx.xx.x.' } },
  { id: 'steve-reich', name: 'Steve Reich', voices: { kick: 'x..x..x..x..', snare: 'x..x..x..x..', hat: 'x..x..x..x..' }, rotation: { kick: 0, snare: 1, hat: 2 } },
  { id: 'fume-fume', name: 'Fume-fume', voices: { kick: 'x.x..x.x..', snare: '...x....x.', hat: 'xxxxxxxxxx' } },
  { id: 'four-on-floor', name: 'Four on the floor', voices: { kick: RHYTHM_PRESETS.fourOnFloor, snare: '....x.......x...', hat: RHYTHM_PRESETS.offbeat } },
];

const KEY = 'pulsar.rhythms';
const MAX_SAVED = 50;
const DRUMS = ['kick', 'snare', 'hat'];
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const smallInt = (v, max) => (Number.isInteger(v) && v >= 0 && v < max ? v : 0);
const cleanPattern = (s) => {
  const len = lanePatternLength(s);
  return Array.from({ length: len }, (_, i) => (String(s ?? '')[i] === 'x' ? 'x' : '.')).join('');
};

/** A rhythm from untrusted data: the three patterns (2 to 32 steps each), the rotations and the sound choices, or null. */
export function cleanRhythm(r) {
  if (!isObj(r) || !isObj(r.voices)) return null;
  const voices = Object.fromEntries(DRUMS.map((d) => [d, cleanPattern(r.voices[d])]));
  const rotation = isObj(r.rotation) ? Object.fromEntries(DRUMS.map((d) => [d, smallInt(r.rotation[d], voices[d].length)])) : undefined;
  const sounds = isObj(r.sounds) ? Object.fromEntries(DRUMS.map((d) => [d, smallInt(r.sounds[d], 8)])) : undefined;
  return { voices, ...(rotation ? { rotation } : {}), ...(sounds ? { sounds } : {}) };
}

/** The rhythms the user saved, in a Storage-like object. Nothing here throws; failures come back as { ok: false, error }. */
export function createRhythmStore(storage, now = Date.now) {
  let counter = 0;
  const read = () => {
    try {
      const data = JSON.parse(storage.getItem(KEY));
      if (!Array.isArray(data)) return [];
      return data.flatMap((e) => {
        const r = isObj(e) && typeof e.id === 'string' && typeof e.name === 'string' ? cleanRhythm(e) : null;
        return r ? [{ id: e.id, name: e.name, ...r }] : [];
      });
    } catch {
      return [];
    }
  };
  const write = (list) => {
    try {
      storage.setItem(KEY, JSON.stringify(list));
      return { ok: true };
    } catch {
      return { ok: false, error: 'could not save (storage full or blocked)' };
    }
  };
  return {
    list: read,
    get: (id) => read().find((r) => r.id === id) ?? null,
    save(name, rhythm) {
      const clean = cleanRhythm(rhythm);
      const label = String(name ?? '').trim().slice(0, 24);
      if (!clean) return { ok: false, error: 'nothing to save' };
      if (!label) return { ok: false, error: 'name it first' };
      const list = read();
      const same = list.find((r) => r.name === label);
      if (!same && list.length >= MAX_SAVED) return { ok: false, error: `at most ${MAX_SAVED} rhythms` };
      const id = same ? same.id : `r${now().toString(36)}${(counter++).toString(36)}`;
      const entry = { id, name: label, ...clean };
      const r = write(same ? list.map((x) => (x === same ? entry : x)) : [...list, entry]);
      return r.ok ? { ok: true, id } : r;
    },
    remove(id) {
      const list = read();
      if (!list.some((r) => r.id === id)) return { ok: false, error: 'no such rhythm' };
      return write(list.filter((r) => r.id !== id));
    },
  };
}
