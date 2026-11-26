import test from 'node:test';
import assert from 'node:assert/strict';
import { ICON_PATHS, icon } from '../js/icons.js';

const NAMES = [
  'check', 'clone', 'close', 'down', 'drum', 'export', 'fx', 'import', 'list', 'load', 'menu', 'metronome', 'mute', 'new', 'next', 'note',
  'pads', 'play', 'plus', 'prev', 'rename', 'save', 'sound', 'stop', 'theme', 'trash', 'up', 'use', 'wave',
];

test('the icon set has exactly the agreed names', () => {
  assert.deepEqual(Object.keys(ICON_PATHS).sort(), NAMES);
});

test('every icon is plain SVG path data', () => {
  for (const [name, d] of Object.entries(ICON_PATHS)) {
    assert.equal(typeof d, 'string', name);
    assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/, name);
  }
});

test('an unknown icon throws before touching the document', () => {
  assert.throws(() => icon('nope'), /unknown icon: nope/);
});
