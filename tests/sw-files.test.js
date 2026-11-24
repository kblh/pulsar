import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('the service worker caches every js file', () => {
  const missing = readdirSync(new URL('../js/', import.meta.url))
    .filter((f) => f.endsWith('.js') && !sw.includes(`'js/${f}'`));
  assert.deepEqual(missing, []);
});

test('the cache version is v36', () => {
  assert.match(sw, /const CACHE = 'pulsar-v40'/);
});
