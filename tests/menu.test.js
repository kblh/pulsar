import test from 'node:test';
import assert from 'node:assert/strict';
import { addMenuItems } from '../js/menu.js';
import { ICON_PATHS } from '../js/icons.js';
import { FX_TYPES, FX_NEEDS_WORKLET } from '../js/fx.js';

const ids = (o) => addMenuItems(o).map((i) => i.id);

test('the add menu lists modules, effects, the sequence and import in that order', () => {
  const list = ids({ hasWorklet: true, hasSequence: false });
  assert.deepEqual(list.slice(0, 3), ['melodic', 'rhythmic', 'drone']);
  for (const t of FX_TYPES) assert.ok(list.includes(`fx:${t}`), t);
  assert.equal(list.at(-1), 'import');
  assert.equal(list.at(-2), 'sequence');
});

test('effects that need the worklet are left out without it', () => {
  const list = ids({ hasWorklet: false, hasSequence: false });
  for (const t of FX_NEEDS_WORKLET) assert.ok(!list.includes(`fx:${t}`), t);
  for (const t of FX_TYPES.filter((x) => !FX_NEEDS_WORKLET.includes(x))) assert.ok(list.includes(`fx:${t}`), t);
});

test('the sequence is offered only while there is none', () => {
  assert.ok(!ids({ hasWorklet: true, hasSequence: true }).includes('sequence'));
});

test('every item has a known icon, a label and a unique id', () => {
  const items = addMenuItems({ hasWorklet: true, hasSequence: false });
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const i of items) {
    assert.ok(Object.hasOwn(ICON_PATHS, i.icon), i.id);
    assert.ok(typeof i.label === 'string' && i.label.length > 0, i.id);
  }
});
