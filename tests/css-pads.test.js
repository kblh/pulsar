import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `rule ${selector}`);
  return css.slice(at, css.indexOf('}', at));
};

test('pads, keys and mute buttons are touch sized', () => {
  assert.match(rule('.pad'), /min-height:\s*44px/);
  assert.match(rule('.pad'), /min-width:\s*44px/);
  assert.match(rule('.key'), /min-height:\s*(1\d\d|[2-9]\d\d)px/); // at least 100 px
  assert.match(rule('.mute-btn'), /min-height:\s*44px/);
});

test('black keys are at least 32 px wide', () => {
  assert.match(rule('.key.black'), /width:\s*max\(9%,\s*32px\)/);
});
