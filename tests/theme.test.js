import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCENTS, DEFAULT_ACCENT, STORAGE_KEY, deriveTheme, loadAccent, saveAccent } from '../js/theme.js';

test('the seven accents are distinct and the default exists', () => {
  assert.deepEqual(ACCENTS.map((a) => a.id), ['cyan', 'green', 'amber', 'magenta', 'violet', 'red', 'grey']);
  assert.deepEqual(ACCENTS.map((a) => a.hue), [188, 135, 40, 320, 265, 5, 0]);
  for (const a of ACCENTS) assert.ok(Number.isInteger(a.hue) && a.hue >= 0 && a.hue < 360, a.id);
  const hues = ACCENTS.filter((a) => !a.mono).map((a) => a.hue).sort((x, y) => x - y);
  for (let i = 1; i < hues.length; i++) assert.ok(hues[i] - hues[i - 1] >= 20);
  assert.ok(ACCENTS.some((a) => a.id === DEFAULT_ACCENT));
  assert.equal(STORAGE_KEY, 'pulsar.accent');
});

test('deriveTheme gives every colour variable from one hue', () => {
  const t = deriveTheme(188);
  assert.deepEqual(Object.keys(t).sort(), ['--accent', '--bg', '--dim', '--fg', '--glow', '--line', '--panel', '--panel-hi'].sort());
  assert.equal(t['--accent'], 'hsl(188, 100%, 68%)');
  assert.equal(t['--glow'], 'hsla(188, 100%, 68%, 0.35)');
  assert.equal(t['--bg'], 'hsl(188, 33%, 5%)');
  assert.equal(t['--fg'], 'hsl(188, 76%, 79%)');
  assert.equal(t['--dim'], 'hsl(188, 32%, 44%)');
  assert.equal(t['--line'], 'hsl(188, 53%, 26%)');
  assert.equal(t['--panel'], 'hsl(188, 36%, 8%)');
  assert.equal(t['--panel-hi'], 'hsl(188, 42%, 12%)');
});

test('the grey theme has no saturation', () => {
  const t = deriveTheme(0, true);
  assert.equal(t['--accent'], 'hsl(0, 0%, 68%)');
  assert.equal(t['--bg'], 'hsl(0, 0%, 5%)');
  assert.equal(t['--glow'], 'hsla(0, 0%, 68%, 0.35)');
});

test('loadAccent falls back to the default for anything unusable', () => {
  assert.equal(loadAccent({ getItem: () => 'green' }), 'green');
  assert.equal(loadAccent({ getItem: () => 'nope' }), DEFAULT_ACCENT);
  assert.equal(loadAccent({ getItem: () => null }), DEFAULT_ACCENT);
  assert.equal(loadAccent({ getItem: () => { throw new Error('blocked'); } }), DEFAULT_ACCENT);
  assert.equal(loadAccent(null), DEFAULT_ACCENT);
});

test('saveAccent stores a known id and reports failure instead of throwing', () => {
  const seen = [];
  assert.equal(saveAccent({ setItem: (k, v) => seen.push([k, v]) }, 'amber'), true);
  assert.deepEqual(seen, [['pulsar.accent', 'amber']]);
  assert.equal(saveAccent({ setItem: () => seen.push('x') }, 'nope'), false);
  assert.equal(saveAccent({ setItem: () => { throw new Error('full'); } }, 'amber'), false);
  assert.equal(saveAccent(null, 'amber'), false);
});
