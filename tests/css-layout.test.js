import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `rule ${selector}`);
  return css.slice(at, css.indexOf('}', at));
};

test('the status line is readable over the page and never blocks taps', () => {
  const r = rule('.status');
  assert.match(r, /background:/);
  assert.match(r, /pointer-events:\s*none/);
});

test('with viewport-fit=cover the side edges respect the safe area', () => {
  assert.match(css, /--pad-l:\s*max\(var\(--pad\),\s*env\(safe-area-inset-left/);
  assert.match(css, /--pad-r:\s*max\(var\(--pad\),\s*env\(safe-area-inset-right/);
  assert.match(rule('.transport'), /var\(--pad-l\)/);
  assert.match(rule('.transport'), /var\(--pad-r\)/);
  assert.match(rule('header.bar'), /var\(--pad-l\)/);
});
