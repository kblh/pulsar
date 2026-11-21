/** Accent colours the user can pick; one hue each, everything else is derived from it. */
export const ACCENTS = [
  { id: 'cyan', name: 'cyan', hue: 188 },
  { id: 'green', name: 'green', hue: 135 },
  { id: 'amber', name: 'amber', hue: 40 },
  { id: 'magenta', name: 'magenta', hue: 320 },
  { id: 'violet', name: 'violet', hue: 265 },
  { id: 'red', name: 'red', hue: 5 },
];
export const DEFAULT_ACCENT = 'cyan';
export const STORAGE_KEY = 'pulsar.accent';

/** Every colour variable of the stylesheet for one hue (the same saturation and lightness for each accent, so they read alike). */
export function deriveTheme(hue) {
  return {
    '--accent': `hsl(${hue}, 100%, 68%)`,
    '--fg': `hsl(${hue}, 76%, 79%)`,
    '--dim': `hsl(${hue}, 32%, 44%)`,
    '--line': `hsl(${hue}, 53%, 26%)`,
    '--glow': `hsla(${hue}, 100%, 68%, 0.35)`,
    '--panel': `hsl(${hue}, 36%, 8%)`,
    '--panel-hi': `hsl(${hue}, 42%, 12%)`,
    '--bg': `hsl(${hue}, 33%, 5%)`,
  };
}

const known = (id) => ACCENTS.some((a) => a.id === id);

/** The saved accent id, or the default when there is none, it is unknown or storage cannot be read. */
export function loadAccent(storage) {
  try {
    const id = storage?.getItem(STORAGE_KEY);
    return known(id) ? id : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

/** Remembers the accent; false when it could not be stored (the choice still applies for this visit). */
export function saveAccent(storage, id) {
  if (!storage || !known(id)) return false;
  try {
    storage.setItem(STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/** Paints the page: the variables on `root` and the browser's theme colour in `themeMeta`. */
export function applyTheme(root, themeMeta, id) {
  const accent = ACCENTS.find((a) => a.id === id) ?? ACCENTS.find((a) => a.id === DEFAULT_ACCENT);
  const vars = deriveTheme(accent.hue);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  themeMeta?.setAttribute('content', vars['--bg']);
}
