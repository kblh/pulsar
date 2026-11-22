# Step grid and keyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rhythmic module is edited with a 4×4 step grid, a kick/snare/hat lane selector and a mute per lane. The melodic module gets the same grid for its rhythm and a one-octave keyboard that picks the pitch classes.

**Architecture:** Pure logic first (pattern flip, empty lanes, mute, pitch classes) in `rhythm.js`, `module.js`, `scene.js`, `scales.js`, each with `node --test` tests. Two small DOM components (`js/step-grid.js`, `js/keyboard.js`) in the style of `createSlider`/`createSegmented`, then wired into `ui.js`. No DOM tests exist in this project, so the logic the components need is exported as pure functions and tested.

**Tech Stack:** vanilla JS/CSS/HTML, Web Audio, `node --test` (`npm test`). No dependencies.

**Spec:** `docs/superpowers/specs/2026-11-22-step-grid-and-keyboard-design.md`

## Global Constraints

- Vanilla JS/CSS, no dependencies, no DOM tests; all logic that can be pure is pure and tested.
- Every touch target at least 44 px tall; pads at least 44 × 44 px. Ruling against the spec: the **white keys fill the row width**, which is about 38–40 px each at 320 px (7 keys in a 288 px row), and are at least 100 px tall. 44 px wide cannot fit 7 keys in 288 px.
- `tests/no-text-buttons.test.js` stays green (no `textContent: '['`, `'×'`, `'■'`, play glyphs in `js/*.js`).
- `tests/css-theme.test.js` stays green: no literal cyan outside the first `:root` block. Colours only through `var(--accent)`, `var(--line)`, `color-mix(in srgb, var(--accent) N%, transparent)` and the other tokens.
- Scenes and module files keep `version: 1`; new fields are optional and a missing one means the old behaviour.
- `sw.js`: `CACHE = 'pulsar-v20'`, `FILES` must equal `ls js` (plus the fixed non-js entries).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Work on `main`, do not push.

## Review Focus

1. A lane emptied in the grid saves, loads and imports as empty (not snapped back to one hit); an emptied lane is not refilled by evolution.
2. The last hit of the melodic rhythm cannot be switched off: the pad snaps back on the next repaint, nothing breaks.
3. An old scene or module file with `notes: "C4 E4 G4 A4"` plays exactly the same pitches, and the keyboard shows C, E, G, A lit.
4. Old scenes without `mute`, and junk `mute` values (`"true"`, `1`, arrays), load unmuted.
5. Tapping a key in `scale` mode switches to `notes` mode seeded with the scale's classes; the last lit key cannot be switched off.

---

### Task 1: Empty lanes, step flip and mute in the pattern core

**Files:**
- Modify: `js/rhythm.js`, `js/module.js`, `js/scene.js`
- Test: `tests/rhythm.test.js`, `tests/module.test.js`, `tests/scene.test.js`

**Interfaces:**
- Produces (`js/rhythm.js`):
  - `parsePattern(str, { allowEmpty = false } = {}) → boolean[16]` (default unchanged: an empty pattern gets step 0 on; with `allowEmpty` it stays all false).
  - `flipStep(pattern: boolean[], i: number) → boolean[]` (a copy with step `i` inverted; an `i` outside 0–15 returns an unchanged copy).
  - `mutateRhythm` keeps its signature; new rule: a pattern whose `anchor ?? hitCount(base)` is 0 is returned unchanged (`{ current: [...current], base: [...base], anchor: 0 }`) and never gets a forced hit.
- Produces (`js/module.js`): rhythmic modules have `params.mute = { kick, snare, hat }` (booleans, default false). `m.setParam('mute:<drum>', value)` sets it to `value === true`; an unknown drum is ignored. `createRhythmicModule({ mute })` accepts the object, anything but `=== true` per drum becomes false. `m.setParam('voice:<drum>', str)` now allows an empty pattern. A muted drum is not played; its pattern keeps evolving.
- Produces (`js/scene.js`): a rhythmic module's cleaned params may contain `mute: { kick, snare, hat }` (all three booleans, only `=== true` counts) when the input has an object `mute`; applying a scene or module file calls `setParam('mute:<drum>')` for each. `serializeModule` already clones `params`, so it carries `mute`.

- [ ] **Step 1: Write the failing tests**

`tests/rhythm.test.js` (add):
```js
test('parsePattern keeps an empty pattern empty only when allowed', () => {
  assert.equal(parsePattern('................').some(Boolean), true);
  assert.equal(parsePattern('................', { allowEmpty: true }).some(Boolean), false);
  assert.equal(parsePattern('', { allowEmpty: true }).length, 16);
});

test('flipStep inverts one step on a copy', () => {
  const p = parsePattern('x...............');
  const q = flipStep(p, 3);
  assert.equal(q[3], true);
  assert.equal(p[3], false);
  assert.deepEqual(flipStep(p, 16), p);
  assert.deepEqual(flipStep(p, -1), p);
  assert.notEqual(flipStep(p, 16), p);
});

test('mutateRhythm leaves a pattern that started empty empty', () => {
  const empty = { current: parsePattern('', { allowEmpty: true }), base: parsePattern('', { allowEmpty: true }) };
  for (const mode of ['drift', 'walk']) {
    let s = empty;
    for (let i = 0; i < 50; i++) s = mutateRhythm(s, { level: 10, mode }, Math.random);
    assert.equal(s.current.some(Boolean), false, mode);
  }
});

test('mutateRhythm still never empties a pattern that has hits', () => {
  let s = { current: parsePattern('x...............'), base: parsePattern('x...............') };
  for (let i = 0; i < 200; i++) {
    s = mutateRhythm(s, { level: 10, mode: 'walk' }, Math.random);
    assert.equal(s.current.some(Boolean), true);
  }
});
```
`tests/module.test.js` (add; `recordingCtx` is the recording stub already imported there, look at an existing test using it for the call that counts drum starts, or count `createOscillator` + `createBufferSource` calls with the local `stubCtx().created`):
```js
test('rhythmic mute: defaults, setParam, junk values and unknown drums', () => {
  const m = createRhythmicModule();
  assert.deepEqual(m.params.mute, { kick: false, snare: false, hat: false });
  m.setParam('mute:kick', true);
  assert.equal(m.params.mute.kick, true);
  m.setParam('mute:kick', 'true');
  assert.equal(m.params.mute.kick, false);
  m.setParam('mute:tom', true);
  assert.equal('tom' in m.params.mute, false);
  assert.deepEqual(createRhythmicModule({ mute: { hat: true, kick: 1, snare: 'yes' } }).params.mute, { kick: false, snare: false, hat: true });
  assert.deepEqual(createRhythmicModule({ mute: 'x' }).params.mute, { kick: false, snare: false, hat: false });
});

test('a muted drum makes no sound but its pattern keeps evolving state', () => {
  const play = (mute) => {
    const { ctx, created } = stubCtx();
    const m = createRhythmicModule({ bpm: 240, voices: { kick: 'xxxxxxxxxxxxxxxx', snare: '................', hat: '................' }, mute });
    run(m, ctx, 2);
    return created.length;
  };
  assert.ok(play({}) > 0);
  assert.equal(play({ kick: true }), 0);
});

test('a rhythmic voice can be emptied and stays empty', () => {
  const m = createRhythmicModule();
  m.setParam('voice:snare', '................');
  assert.equal(m.state.voices.snare.current.some(Boolean), false);
  const e = createRhythmicModule({ voices: { hat: '................' } });
  assert.equal(e.state.voices.hat.current.some(Boolean), false);
});

test('the melodic rhythm still keeps one hit', () => {
  const m = createMelodicModule();
  m.setParam('rhythm', '................');
  assert.equal(m.state.rhythm.current.some(Boolean), true);
});
```
`tests/scene.test.js` (add, using the file's existing imports; import `cleanModule`, `serializeModule`, `createRhythmicModule` if missing):
```js
test('a rhythmic module saves and cleans mute and an emptied lane', () => {
  const m = createRhythmicModule({ voices: { snare: '................' }, mute: { hat: true } });
  const data = serializeModule(m);
  assert.deepEqual(data.params.mute, { kick: false, snare: false, hat: true });
  const cleaned = cleanModule(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(cleaned.params.mute, { kick: false, snare: false, hat: true });
  assert.equal(cleaned.params.voices.snare, '................');
});

test('mute from untrusted data: only true counts, missing means none', () => {
  const base = { type: 'rhythmic', name: 'r', params: {}, volume: 1, pan: 0, running: true, sends: [] };
  assert.equal(cleanModule(base).params.mute, undefined);
  assert.deepEqual(cleanModule({ ...base, params: { mute: { kick: 'true', snare: 1, hat: true } } }).params.mute, { kick: false, snare: false, hat: true });
  assert.equal(cleanModule({ ...base, params: { mute: [true] } }).params.mute, undefined);
  assert.equal(cleanModule({ ...base, params: { mute: { kick: true } } }).type, 'rhythmic');
});

test('applying a saved rhythmic module restores mute and the empty lane', () => {
  // use the fake engine and addModuleFromData exactly as the existing apply tests in tests/scene-apply.test.js do
});
```
Fill the third test from `tests/scene-apply.test.js` (copy its fake-engine helper if it is not exported): build `e` from `cleanModule(serializeModule(createRhythmicModule({ voices: { snare: '................' }, mute: { kick: true } })))` plus `sends: []`, call `addModuleFromData(fakeEngine, e)`, and assert the module added to the engine has `params.mute.kick === true` and an empty snare state.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/rhythm.test.js tests/module.test.js tests/scene.test.js`
Expected: FAIL (`flipStep` not exported, `params.mute` undefined, snare lane not empty).

- [ ] **Step 3: Implement**

`js/rhythm.js`: add the `allowEmpty` option to `parsePattern`, export `flipStep`, and in `mutateRhythm` return early for `anchored === 0` (compute `anchored` first). The forced-hit line at the end stays for patterns with hits.
`js/module.js`: a `cleanMute(raw)` helper (object → three booleans via `=== true`, else all false); `createRhythmicModule` builds `params.mute` after the `...overrides` spread (like `voices`) and builds its state with `parsePattern(voices[d], { allowEmpty: true })`; `applyParam`'s `voice:` branch uses `allowEmpty: true`; add a `mute:` branch (`DRUMS.includes`); the `onStep` of the rhythmic module skips drums with `mod.params.mute[kind]`.
`js/scene.js`: in `cleanModuleParams` for `type === 'rhythmic'` copy `mute` through the same `=== true` rule (only when `isObj(p.mute)`); in `applyParams` handle key `mute` (object) like `voices`, by calling `m.setParam('mute:<drum>', value)` for each drum.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/rhythm.test.js tests/module.test.js tests/scene.test.js && npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add js/rhythm.js js/module.js js/scene.js tests/rhythm.test.js tests/module.test.js tests/scene.test.js docs/superpowers
git commit -m "feat: empty rhythmic lanes, flipStep and per-lane mute in the pattern core"
```

---

### Task 2: Pitch classes for the keyboard

**Files:**
- Modify: `js/scales.js`
- Test: `tests/scales.test.js`

**Interfaces:**
- Produces (`js/scales.js`):
  - `PITCH_CLASS_NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']`.
  - `parsePitchClass(name: string) → number | null` (`'C'`→0, `'c#'`→1, `'Bb'`→10, `'B'`→11, `'C4'`→null, `''`→null).
  - `buildPitchPool(cfg)` in `notes` mode: a token with an octave (`C4`) is one pitch as before; a token without one (`C`) is expanded over `cfg.octaves` (default 2, clamped 1–4, floor) starting at octave `cfg.baseOctave ?? 3` (the same base the `scale` mode uses); result unique and ascending; if nothing parses it falls back to the default scale pool as before.
  - `pitchClasses(cfg) → number[]`: sorted unique `buildPitchPool(cfg)` values mod 12.
  - `toggleClass(cfg, pc) → cfg'`: starts from `pitchClasses(cfg)` (so in `scale` mode it seeds from the scale), flips `pc`; if the result would be empty returns `cfg` unchanged (same object); otherwise returns `{ ...cfg, mode: 'notes', notes: <names of the classes ascending, joined by one space> }`.
- Consumes: `buildPitchPool`, `parseNote` (existing).

- [ ] **Step 1: Write the failing tests** (`tests/scales.test.js`, add; import the new names)

```js
test('parsePitchClass', () => {
  assert.equal(parsePitchClass('C'), 0);
  assert.equal(parsePitchClass('c#'), 1);
  assert.equal(parsePitchClass('Bb'), 10);
  assert.equal(parsePitchClass('B'), 11);
  assert.equal(parsePitchClass('C4'), null);
  assert.equal(parsePitchClass(''), null);
});

test('class tokens expand over the octaves from octave 3', () => {
  assert.deepEqual(buildPitchPool({ mode: 'notes', notes: 'C E', octaves: 2 }), [48, 52, 60, 64]);
  assert.deepEqual(buildPitchPool({ mode: 'notes', notes: 'A', octaves: 1 }), [57]);
  assert.equal(buildPitchPool({ mode: 'notes', notes: 'C', octaves: 9 }).length, 4);
});

test('tokens with an octave still mean exactly those pitches, and may mix with classes', () => {
  assert.deepEqual(buildPitchPool({ mode: 'notes', notes: 'C4 E4 G4 A4', octaves: 3 }), [60, 64, 67, 69]);
  assert.deepEqual(buildPitchPool({ mode: 'notes', notes: 'C4 C', octaves: 1 }), [48, 60]);
});

test('pitchClasses of a scale and of legacy notes', () => {
  assert.deepEqual(pitchClasses({ mode: 'scale', root: 'C', scale: 'pentatonicMinor', octaves: 2 }), [0, 3, 5, 7, 10]);
  assert.deepEqual(pitchClasses({ mode: 'notes', notes: 'C4 E4 G4 A4' }), [0, 4, 7, 9]);
});

test('toggleClass seeds from the scale, switches to notes and flips the class', () => {
  const cfg = { mode: 'scale', root: 'C', scale: 'pentatonicMinor', octaves: 2 };
  const off = toggleClass(cfg, 3);
  assert.equal(off.mode, 'notes');
  assert.equal(off.octaves, 2);
  assert.deepEqual(pitchClasses(off), [0, 5, 7, 10]);
  assert.deepEqual(pitchClasses(toggleClass(off, 4)), [0, 4, 5, 7, 10]);
  assert.equal(off.root, 'C');
});

test('toggleClass never turns the last key off', () => {
  const one = { mode: 'notes', notes: 'E', octaves: 2 };
  assert.equal(toggleClass(one, 4), one);
  assert.deepEqual(pitchClasses(toggleClass(one, 0)), [0, 4]);
});

test('names written by toggleClass parse back', () => {
  const cfg = toggleClass({ mode: 'notes', notes: 'C', octaves: 1 }, 3);
  assert.equal(cfg.notes, 'C Eb');
  assert.deepEqual(pitchClasses(cfg), [0, 3]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/scales.test.js`
Expected: FAIL (`parsePitchClass is not a function` / import error).

- [ ] **Step 3: Implement** in `js/scales.js` as specified (regex `^([A-Ga-g])([#b]?)$` for classes, using the existing `NOTE_BASE`; the expansion base is `(baseOctave + 1) * 12`).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/scales.test.js && npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add js/scales.js tests/scales.test.js
git commit -m "feat: pitch classes, class tokens in notes mode and toggleClass"
```

---

### Task 3: Step grid, keyboard, icons and styles

**Files:**
- Create: `js/step-grid.js`, `js/keyboard.js`, `tests/keyboard.test.js`, `tests/css-pads.test.js`
- Modify: `js/icons.js`, `css/style.css`, `tests/icons.test.js`

**Interfaces:**
- Produces (`js/step-grid.js`): `createStepGrid({ ariaLabel, onToggle }) → { node, set(pattern: boolean[]), setPlayhead(i: number) }`. `node` is a `div.pads` of 16 `button.pad` (type button, `aria-pressed`, `aria-label` `step N`, tabindex natural). `onToggle(i)` runs on click (click does not fire when a touch turns into a scroll). `set` and `setPlayhead` change a button only when its state changed (no per-frame DOM writes). `setPlayhead(-1)` clears the marker.
- Produces (`js/keyboard.js`): `KEYS` = 12 entries `{ pc, name, black }` in order C to B (`name` from `PITCH_CLASS_NAMES`); `createKeyboard({ onToggle }) → { node, set(classes: number[]) }`. `node` is `div.keys` with 12 `button.key` (`aria-pressed`, `aria-label` the name, class `black` for the five black ones); `onToggle(pc)` on click; `set` marks lit keys.
- Produces (`js/icons.js`): icons `mute` and `sound` (27 names total).
- Produces (CSS): `.pads`, `.pad`, `.pad.now`, `.keys`, `.key`, `.key.black`, `.mute-row`, `.mute-btn` (used in Task 4).
- Consumes: `PITCH_CLASS_NAMES` from Task 2, `icon`/`setIcon` from `js/icons.js`.

- [ ] **Step 1: Write the failing tests**

`tests/icons.test.js`: add `'mute'` and `'sound'` to `NAMES` in sorted position (`mute` after `menu`/`metronome`, `sound` after `save`; the test sorts the actual keys, so keep `NAMES` sorted).
`tests/keyboard.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYS } from '../js/keyboard.js';
import { PITCH_CLASS_NAMES } from '../js/scales.js';

test('the keyboard is one octave: 7 white and 5 black keys, C to B', () => {
  assert.equal(KEYS.length, 12);
  assert.deepEqual(KEYS.map((k) => k.pc), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(KEYS.filter((k) => k.black).length, 5);
  assert.deepEqual(KEYS.filter((k) => k.black).map((k) => k.pc), [1, 3, 6, 8, 10]);
  assert.deepEqual(KEYS.map((k) => k.name), PITCH_CLASS_NAMES);
});
```
`tests/css-pads.test.js` (reads `css/style.css` as text; helper `block(selector)` returns the declaration text of the first rule that is exactly that selector):
```js
test('pads and keys are touch sized', () => {
  assert.match(block('.pad'), /min-height:\s*44px/);
  assert.match(block('.pad'), /min-width:\s*44px/);
  assert.match(block('.key'), /min-height:\s*(1\d\d|[2-9]\d\d)px/); // at least 100 px
  assert.match(block('.mute-btn'), /min-height:\s*44px/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/icons.test.js tests/keyboard.test.js tests/css-pads.test.js`
Expected: FAIL (icons missing, `js/keyboard.js` not found, no `.pad` rule).

- [ ] **Step 3: Implement**

`js/icons.js`: add paths
`mute: 'M11 5L6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6'`, `sound: 'M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13'`.
`js/step-grid.js`, `js/keyboard.js`: as specified; local `el` helper like `controls.js` (it is not exported, copy the six lines). The `KEYS` array is exported for the test; `createKeyboard` builds the white keys as flex children and positions each black key absolutely between its white neighbours (left in percent of the row: black key after the white key of index `w` sits at `(w + 1) / 7 * 100%` centred with `translateX(-50%)`, width `9%`), and extends the black key's touch area with the height, not the width.
`css/style.css` (colours only through tokens):
- `.pads { display: grid; grid-template-columns: repeat(4, minmax(44px, 64px)); gap: 6px; justify-content: start; touch-action: manipulation; }`
- `.pad { min-width: 44px; min-height: 44px; aspect-ratio: 1; border: 1px solid var(--line); border-radius: 4px; background: transparent; }`, `.pad[aria-pressed=true]` with `background: color-mix(in srgb, var(--accent) 35%, transparent); border-color: var(--accent);`, `.pad.now` with `box-shadow: inset 0 0 0 2px var(--accent), 0 0 6px var(--glow);`.
- `.keys { position: relative; display: flex; max-width: 420px; height: 128px; touch-action: manipulation; }`, `.key` white keys `flex: 1; min-height: 128px; border: 1px solid var(--line); background: var(--fg)` dimmed with `color-mix` (a light key in a dark UI: use `color-mix(in srgb, var(--fg) 14%, var(--bg))`), pressed (lit) = `background: var(--accent)`; `.key.black` absolutely positioned, `top: 0; height: 62%; z-index: 1; background: var(--bg)`, lit = accent.
- `.mute-row { display: flex; gap: 6px; flex-wrap: wrap; }`, `.mute-btn { min-height: 44px; min-width: 44px; padding: 0 10px; border: 1px solid var(--line); border-radius: 4px; display: inline-flex; align-items: center; gap: 6px; color: var(--accent); }`, `.mute-btn[aria-pressed=true] { color: var(--dim); }`.
Check the real token names in the first `:root` block (`--fg`, `--bg`, `--dim`, `--line`, `--glow`, `--accent`) before using them.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/icons.test.js tests/keyboard.test.js tests/css-pads.test.js tests/css-theme.test.js tests/no-text-buttons.test.js && npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add js/step-grid.js js/keyboard.js js/icons.js css/style.css tests/icons.test.js tests/keyboard.test.js tests/css-pads.test.js
git commit -m "feat: step grid and keyboard components, mute and sound icons, styles"
```

---

### Task 4: Wire into the cards, service worker, README

**Files:**
- Modify: `js/ui.js`, `sw.js`, `README.md`
- Test: `tests/sw-files.test.js` (new, only if no existing test compares `FILES` with `ls js`; check first with `grep -rn "FILES" tests`)

**Interfaces:**
- Consumes: `createStepGrid`, `createKeyboard` (Task 3), `parsePattern`, `formatPattern`, `flipStep` (Task 1), `pitchClasses`, `toggleClass` (Task 2), `createSegmented`/`seg`, `iconButton`/`setIcon`, `m.setParam('voice:<d>' | 'rhythm' | 'mute:<d>' | 'pitchConfig', …)`.
- Produces: `rhythmicControls(m, live)` and `melodicControls(m, live)` take an array `live` and push `{ update(playhead) }` objects into it; `addPanel` passes one array and appends it to `rows` so the existing frame loop (`rows.forEach((r) => r.update(module.playhead))`, only while the card is open) keeps them current.

- [ ] **Step 1: Test first for the one pure piece**

If no test checks that `sw.js` `FILES` lists every file in `js/`, add `tests/sw-files.test.js`: read `sw.js` text, assert every `js/*.js` file name appears as `'js/<name>'` and `CACHE` is `'pulsar-v20'`. Run it: it fails (new files and v19).
Run: `node --test tests/sw-files.test.js`
Expected: FAIL.

- [ ] **Step 2: Implement in `js/ui.js`**

- Imports: `createStepGrid` from `./step-grid.js`, `createKeyboard` from `./keyboard.js`, `flipStep`, `formatPattern` from `./rhythm.js`, `pitchClasses`, `toggleClass` from `./scales.js`.
- `rhythmicControls(m, live)`: local `let lane = 'kick'`. `createSegmented` for kick/snare/hat (`ariaLabel: 'lane'`, `onChange` sets `lane` and repaints the grid). `createStepGrid({ ariaLabel: 'steps', onToggle: (i) => { m.setParam(\`voice:${lane}\`, formatPattern(flipStep(m.state.voices[lane].current, i))); paint(); } })`, where `paint()` does `grid.set(m.state.voices[lane].current)`. A mute row: three `button.mute-btn` (aria-pressed from `m.params.mute[d]`, an `icon('sound')` or `icon('mute')` plus a text span with the drum name, click calls `m.setParam('mute:<d>', !m.params.mute[d])` and repaints; use `setIcon`-style swap). Order: bpm, swing, `row('lane', laneSeg)`, `row('mute', muteRow)`, `row('steps', grid.node)`, rhythm mod, evolution. `live.push({ update: (playhead) => { paint(); grid.setPlayhead(playhead); } })`. Remove the three `text(...)` voice rows.
- `melodicControls(m, live)`: replace the `notes` text row with `row('keys', keyboard.node)` where `createKeyboard({ onToggle: (pc) => { m.setParam('pitchConfig', toggleClass(m.params.pitchConfig, pc)); paintKeys(); } })` and `paintKeys = () => keyboard.set(pitchClasses(m.params.pitchConfig))`; replace the `rhythm` text row with `row('rhythm', rhythmGrid.node)` whose `onToggle` does `m.setParam('rhythm', formatPattern(flipStep(m.state.rhythm.current, i)))`. `pitchRows` loses its `notes` row (keep `pitch`, `root`+`scale`, `octaves`; the `setCfg` default for `notes` stays). `live.push` one updater that calls `paintKeys()`, repaints the rhythm grid and sets its playhead; the `octaves` slider and `pitch` mode seg do not change the lit keys except through `paintKeys` on each update, which is enough. The drone also uses `pitchRows`: give it no keyboard, so keep the `notes` text row available to the drone by making `pitchRows(m, { withNotes })` return the notes row only when `withNotes` is true (drone passes true, melodic passes false).
- `addPanel`: `const live = []`; the melodic `rows` keeps only the `pitch` `gridRow`, the rhythmic `rows` becomes `[]`; call the controls builders with `live`, then `rows.push(...live)` before `panels.set`. Build the `.grid` footer only when `rows` has read-only nodes (melodic pitch, drone status): filter on `r.node`.
- `sw.js`: `pulsar-v20`, add `'js/step-grid.js'`, `'js/keyboard.js'` to `FILES`.
- `README.md`: one short paragraph under the module descriptions: rhythmic edited with the 4×4 grid, lane selector and per-lane mute; melodic with the grid and the one-octave keyboard (pitch classes spread over the octaves slider).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: all green (previous 371 plus the new tests), including `no-text-buttons`, `css-theme`, `css-pads`, `sw-files`.

- [ ] **Step 4: Check in the browser if the extension connects**

Serve `http://localhost:<free port>/` from the repo root (not the port of another app), add a rhythmic and a melodic module and check: tapping a pad toggles the step and the sound; lane switch shows the other lane; mute silences only that lane and the grid still evolves; emptied lane stays empty after reload of a saved scene; keyboard keys light and change the pitches heard; at a 320 px wide window grid and keyboard fit without horizontal scroll. If the extension cannot open local pages, say so in the ledger and in the final message; do not claim these as verified.

- [ ] **Step 5: Commit**

```bash
git add js/ui.js sw.js README.md tests
git commit -m "feat: step grid, lane mute and one-octave keyboard in the module cards"
```
