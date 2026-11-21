import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const rest = css.replace(/:root\s*\{[^}]*\}/, ''); // the first :root block holds the default theme

test('no cyan is written outside the :root defaults, so the accent recolours everything', () => {
  const found = [
    /rgba\(\s*94\s*,\s*238\s*,\s*255/, /#5eeeff/i, /#9fe8f2/i, /#4f8c98/i, /#1f5663/i, /#080d10/i, /#0d171c/i, /#11222a/i,
  ].filter((re) => re.test(rest)).map(String);
  assert.deepEqual(found, []);
});
