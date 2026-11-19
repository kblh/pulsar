import { cleanName, validateScene, NAME_MAX } from './scene.js';

export const MAX_FILE_BYTES = 1_000_000;
export const MAX_SCENES_PER_FILE = 100;
const MAX_FILENAME = 80;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** A file name that cannot escape a folder or carry markup: only letters, digits, . _ - and space survive. */
export function exportFilename(name, suffix = '.pulsar.json') {
  const base = String(name ?? '')
    .replace(/[^\p{L}\p{N}._ -]+/gu, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, MAX_FILENAME);
  return `${base || 'scene'}${suffix}`;
}

export function sceneToFile(name, scene) {
  const clean = cleanName(name, 'scene');
  return { filename: exportFilename(clean), text: JSON.stringify({ pulsar: 'scene', name: clean, scene }, null, 2) };
}

export function scenesToFile(entries) {
  const scenes = entries.map(({ name, scene }) => ({ name: cleanName(name, 'scene'), scene }));
  return { filename: 'pulsar-scenes.json', text: JSON.stringify({ pulsar: 'scenes', scenes }, null, 2) };
}

/** The first of `name`, `name (2)`, `name (3)`… that is not in `taken`; never longer than NAME_MAX. */
export function uniqueName(name, taken) {
  if (!taken.includes(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = name.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** Reads an exported file. Nothing here throws; unusable parts come back as `problems`. */
export function parseSceneFile(text, fallbackName) {
  const fail = (problem) => ({ entries: [], problems: [problem] });
  if (typeof text !== 'string') return fail('not a text file');
  // UTF-8 never takes fewer bytes than there are UTF-16 units, so a long string is over the limit without encoding it.
  if (text.length > MAX_FILE_BYTES || new TextEncoder().encode(text).length > MAX_FILE_BYTES) return fail('file is larger than 1 MB');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('not valid JSON');
  }
  if (!isObj(data)) return fail('not a Pulsar scene file');

  const problems = [];
  let items;
  if (data.pulsar === 'scenes') {
    if (!Array.isArray(data.scenes)) return fail('"scenes" is not a list');
    items = data.scenes;
    if (items.length > MAX_SCENES_PER_FILE) {
      problems.push(`only the first ${MAX_SCENES_PER_FILE} of ${items.length} scenes are used`);
      items = items.slice(0, MAX_SCENES_PER_FILE);
    }
  } else if (data.pulsar === 'scene') {
    items = [data];
  } else if (data.version === 1) {
    const fromFile = String(fallbackName ?? '').replace(/(\.pulsar)?\.json$/i, '');
    items = [{ name: fromFile, scene: data }];
  } else {
    return fail('not a Pulsar scene file');
  }

  const entries = [];
  items.forEach((item, i) => {
    if (!isObj(item) || !isObj(item.scene)) {
      problems.push(`scene ${i + 1}: nothing usable in it`);
      return;
    }
    const name = cleanName(item.name, 'scene');
    const { scene, problems: why } = validateScene(item.scene);
    if (!scene) problems.push(`${name}: ${why.join(', ')}`);
    else entries.push({ name, scene });
  });
  return { entries, problems };
}
