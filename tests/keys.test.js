import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandleSpace } from '../js/keys.js';

const base = () => ({
  code: 'Space', key: ' ', repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  target: { closest: () => null },
});

test('a plain Space on the page toggles play', () => {
  assert.equal(shouldHandleSpace(base()), true);
});

test('Space with a modifier or held down is not handled', () => {
  for (const k of ['repeat', 'ctrlKey', 'metaKey', 'altKey']) assert.equal(shouldHandleSpace({ ...base(), [k]: true }), false, k);
});

test('other keys are not handled', () => {
  assert.equal(shouldHandleSpace({ ...base(), code: 'Enter', key: 'Enter' }), false);
});

test('Space in a field, button or slider is left alone', () => {
  assert.equal(shouldHandleSpace({ ...base(), target: { closest: () => ({}) } }), false);
  assert.equal(shouldHandleSpace({ ...base(), target: { closest: () => null, isContentEditable: true } }), false);
});
