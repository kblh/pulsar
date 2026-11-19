import { cleanName, validateScene } from './scene.js';

const KEY = 'pulsar.scenes';
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const UNAVAILABLE = 'storage unavailable';
const NEWER = 'saved scenes use a newer format';

/** Named scenes in a Storage-like object; no method throws, failures come back as { ok: false, error }. */
export function createSceneStore(storage, now = Date.now) {
  let counter = 0;

  /** { scenes, error }: `error` set means writing is not allowed (unavailable or newer format). */
  function read() {
    if (!storage) return { scenes: [], error: UNAVAILABLE };
    let raw;
    try {
      raw = storage.getItem(KEY);
    } catch {
      return { scenes: [], error: UNAVAILABLE };
    }
    if (raw === null || raw === undefined) return { scenes: [] };
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { scenes: [] };
    }
    if (isObj(data) && typeof data.version === 'number' && data.version > 1) return { scenes: [], error: NEWER };
    if (!isObj(data) || data.version !== 1 || !Array.isArray(data.scenes)) return { scenes: [] };
    const scenes = data.scenes
      .filter((s) => isObj(s) && typeof s.id === 'string' && typeof s.name === 'string' && isObj(s.data))
      .map((s) => ({ id: s.id, name: s.name, savedAt: Number.isFinite(s.savedAt) ? s.savedAt : 0, data: s.data }));
    return { scenes };
  }

  function write(scenes) {
    try {
      storage.setItem(KEY, JSON.stringify({ version: 1, scenes }));
      return { ok: true };
    } catch {
      return { ok: false, error: 'could not save (storage full or blocked)' };
    }
  }

  const failure = (error) => ({ ok: false, error });
  const uniqueId = (scenes) => {
    let id;
    do id = `s${now().toString(36)}${(counter++).toString(36)}`; while (scenes.some((s) => s.id === id));
    return id;
  };

  return {
    list() {
      const { scenes } = read();
      return scenes
        .map((s, i) => ({ s, i }))
        .sort((a, b) => b.s.savedAt - a.s.savedAt || b.i - a.i)
        .map(({ s }) => ({ id: s.id, name: s.name, savedAt: s.savedAt }));
    },
    get(id) {
      const found = read().scenes.find((s) => s.id === id);
      return found ? validateScene(found.data).scene : null;
    },
    save(name, scene) {
      const { scenes, error } = read();
      if (error) return failure(error);
      if (!isObj(scene)) return failure('nothing to save');
      const clean = cleanName(name, 'scene');
      const existing = scenes.find((s) => s.name === clean);
      const id = existing ? existing.id : uniqueId(scenes);
      const entry = { id, name: clean, savedAt: now(), data: scene };
      const next = existing ? scenes.map((s) => (s === existing ? entry : s)) : [...scenes, entry];
      const r = write(next);
      return r.ok ? { ok: true, id } : r;
    },
    rename(id, name) {
      const { scenes, error } = read();
      if (error) return failure(error);
      const target = scenes.find((s) => s.id === id);
      if (!target) return failure('no such scene');
      const clean = cleanName(name, 'scene');
      if (scenes.some((s) => s !== target && s.name === clean)) return failure('name already used');
      return write(scenes.map((s) => (s === target ? { ...s, name: clean } : s)));
    },
    remove(id) {
      const { scenes, error } = read();
      if (error) return failure(error);
      if (!scenes.some((s) => s.id === id)) return failure('no such scene');
      return write(scenes.filter((s) => s.id !== id));
    },
  };
}
