import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../js/', import.meta.url);
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.js') && f !== 'icons.js')
  .map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]);

const BAD = [
  [/textContent:\s*'\[/, "a '[text]' button label"],
  [/textContent:\s*'×'/, "a '×' button label"],
  [/'■'/, "the '■' stop glyph"],
  [/\\u25B6|▶︎/, 'a play glyph constant'],
  [/btn\('(\+ part|use running|↑|↓|◀|▶)'/, 'a text sequence button'],
];

test('no button is labelled with text or a glyph; icons do that', () => {
  const found = [];
  for (const [file, text] of sources) {
    for (const [re, what] of BAD) if (re.test(text)) found.push(`${file}: ${what}`);
  }
  assert.deepEqual(found, []);
});
