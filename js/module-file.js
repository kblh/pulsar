import { exportFilename, MAX_FILE_BYTES } from './scene-file.js';
import { cleanModule, DEFAULT_SEND_LEVEL } from './scene.js';

export const MODULE_FILE_SUFFIX = '.pulsar-module.json';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export const moduleFilename = (name) => exportFilename(name, MODULE_FILE_SUFFIX, 'module');

/** The text of a module file: `moduleData` comes from serializeModule. */
export const moduleToFile = (moduleData) => JSON.stringify({ pulsar: 'module', module: moduleData }, null, 2);

/**
 * Reads a module file. Nothing here throws. `entries` has one cleaned module or none, `problems` says why.
 * Sends are not part of a module file: the imported module starts with three empty slots.
 */
export function parseModuleFile(text) {
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
  if (!isObj(data)) return fail('not a Pulsar module file');
  let candidate;
  if (data.pulsar === 'module') candidate = data.module;
  else if (data.pulsar === undefined && typeof data.type === 'string') candidate = data; // a bare module object
  else return fail('not a Pulsar module file');
  const module = cleanModule(candidate);
  if (!module) return fail('no usable module in it (unknown type)');
  module.sends = Array.from({ length: 3 }, () => ({ fx: null, level: DEFAULT_SEND_LEVEL }));
  return { entries: [module], problems: [] };
}
