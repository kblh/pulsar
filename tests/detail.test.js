import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetail } from '../js/detail.js';

function fakeNode() {
  const classes = new Set();
  return { style: {}, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } };
}

function env(extra = {}) {
  const popstate = [];
  const keydown = [];
  const h = { entries: [null], index: 0, pushes: 0, replaces: 0, backs: 0 };
  const history = {
    get state() { return h.entries[h.index]; },
    pushState(s) { h.entries.splice(h.index + 1); h.entries.push(s); h.index++; h.pushes++; },
    replaceState(s) { h.entries[h.index] = s; h.replaces++; },
    back() { h.backs++; h.index--; popstate.forEach((f) => f({ state: h.entries[h.index] })); },
  };
  const win = { history, addEventListener: (type, f) => { if (type === 'popstate') popstate.push(f); } };
  const doc = { body: fakeNode(), addEventListener: (type, f) => { if (type === 'keydown') keydown.push(f); } };
  const detail = createDetail({ win, doc, ...extra });
  const card = () => ({ node: fakeNode() });
  return {
    h, doc, detail, card,
    esc: (key = 'Escape', extra = {}) => keydown.forEach((f) => f({ key, ...extra })),
    userBack: () => history.back(),
  };
}
const isOpen = (c) => c.node.classList.contains('open');

test('open shows the card, locks the page and adds one history entry', () => {
  const { detail, doc, card, h } = env();
  const a = card();
  detail.open(a);
  assert.ok(isOpen(a));
  assert.ok(doc.body.classList.contains('detail-open'));
  assert.equal(h.pushes, 1);
  assert.equal(detail.current(), a);
});

test('close hides at once and goes back in history exactly once', () => {
  const { detail, doc, card, h } = env();
  const a = card();
  detail.open(a);
  detail.close();
  assert.ok(!isOpen(a));
  assert.ok(!doc.body.classList.contains('detail-open'));
  assert.equal(detail.current(), null);
  assert.equal(h.backs, 1);
  assert.equal(h.index, 0);
});

test('closing twice in a row goes back once; closing with nothing open does nothing', () => {
  const { detail, card, h } = env();
  detail.close();
  assert.equal(h.backs, 0);
  detail.open(card());
  detail.close();
  detail.close();
  assert.equal(h.backs, 1);
});

test('Escape closes, other keys do not', () => {
  const { detail, card, esc } = env();
  const a = card();
  detail.open(a);
  esc('Enter');
  assert.ok(isOpen(a));
  esc();
  assert.ok(!isOpen(a));
});

test('the Back button closes without navigating again', () => {
  const { detail, card, userBack, h } = env();
  const a = card();
  detail.open(a);
  userBack();
  assert.ok(!isOpen(a));
  assert.equal(h.backs, 1); // the user's own, ours was not added
  assert.equal(detail.current(), null);
});

test('opening another card swaps them and replaces the history entry', () => {
  const { detail, card, h } = env();
  const a = card();
  const b = card();
  detail.open(a);
  detail.open(b);
  assert.ok(!isOpen(a));
  assert.ok(isOpen(b));
  assert.equal(detail.current(), b);
  assert.equal(h.pushes, 1);
  assert.equal(h.replaces, 1);
  detail.close();
  assert.equal(h.backs, 1);
});

test('opening the card that is already open does nothing', () => {
  const { detail, card, h } = env();
  const a = card();
  detail.open(a);
  detail.open(a);
  assert.equal(h.pushes, 1);
  assert.equal(h.replaces, 0);
  assert.ok(isOpen(a));
});

test('a late popstate from our own back does not close a card opened right after', () => {
  const popstate = [];
  const h = { state: { pulsarDetail: true }, backs: 0 };
  const win = {
    history: { get state() { return h.state; }, pushState(s) { h.state = s; }, replaceState(s) { h.state = s; }, back() { h.backs++; } },
    addEventListener: (type, f) => { if (type === 'popstate') popstate.push(f); },
  };
  const doc = { body: fakeNode(), addEventListener() {} };
  const detail = createDetail({ win, doc });
  const a = { node: fakeNode() };
  const b = { node: fakeNode() };
  detail.open(a);
  detail.close(); // back() is asynchronous in a browser
  detail.open(b);
  popstate.forEach((f) => f({ state: null })); // arrives only now
  assert.ok(isOpen(b));
  assert.equal(detail.current(), b);
});

test('the transition callback owns the class change; the view-transition name lives only during it', async () => {
  let release;
  const finished = new Promise((r) => { release = r; });
  const seen = [];
  const { detail, card } = env({
    transition: (fn) => {
      seen.push('transition');
      fn();
      return { finished };
    },
  });
  const a = card();
  detail.open(a);
  assert.deepEqual(seen, ['transition']);
  assert.ok(isOpen(a));
  assert.equal(a.node.style.viewTransitionName, 'card');
  release();
  await finished;
  await Promise.resolve();
  assert.ok(!a.node.style.viewTransitionName);
});

test('state is decided immediately even when the transition applies the change later', () => {
  const pending = [];
  const { detail, card, h } = env({ transition: (fn) => { pending.push(fn); } });
  const a = card();
  detail.open(a);
  detail.close();
  detail.close();
  assert.equal(h.backs, 1);
  assert.equal(detail.current(), null);
  pending.forEach((fn) => fn());
  assert.ok(!isOpen(a));
});

test('Escape that something else already handled (e.g. cancelling a rename) does not close the detail', () => {
  const { detail, card, esc } = env();
  const a = card();
  detail.open(a);
  esc('Escape', { defaultPrevented: true });
  assert.ok(isOpen(a));
  assert.equal(detail.current(), a);
  esc();
  assert.ok(!isOpen(a));
});

test('cards are told when they open and close, so they can manage focus', () => {
  const { detail } = env();
  const log = [];
  const mk = (id) => ({ node: fakeNode(), setOpen: (on) => log.push(`${id}:${on}`) });
  const a = mk('a');
  const b = mk('b');
  detail.open(a);
  detail.open(b);
  detail.close();
  assert.deepEqual(log, ['a:true', 'a:false', 'b:true', 'b:false']);
});
