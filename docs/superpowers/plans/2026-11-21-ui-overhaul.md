# UI overhaul 21/11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace text buttons with SVG icons, add a global BPM (on/off) and a fixed bottom transport bar, reduce the header to name + `+` + hamburger menus, and let the user pick an accent colour.

**Architecture:** Four new small modules (`icons.js`, `menu.js`, `keys.js`, `theme.js`), each with a pure, tested core and a thin DOM part. The global BPM is an override read in the module `tick` (module params are never rewritten). All UI work stays vanilla JS/CSS; pure logic gets `node --test` tests, UI is verified in Chrome.

**Tech Stack:** Vanilla JS ES modules, CSS, Web Audio, `node --test` (`npm test`), Chrome for UI checks. Baseline: 340 tests green.

**Spec:** `docs/superpowers/specs/2026-11-21-ui-overhaul-design.md`

## Global Constraints

- Work directly on `main`; commit per task; do NOT push (the user says "push to origin main").
- Every commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Scene and module file `version` stays `1`. A module file never contains `tempo`.
- Tempo range 20–300 (integer), default `{ on: false, bpm: 120 }`. Drone is unaffected by global BPM.
- Touch targets at least 44 px; everything works at 320 px with no horizontal page scroll.
- Every icon button keeps `title` and `aria-label`. Names (`.name-btn`, `.scene-name`, chips) stay text. The numeric `−`/`+` nudges stay text.
- Accent choice is stored in `localStorage` key `pulsar.accent`, every access in `try/catch`.
- No cyan literal (`rgba(94, 238, 255`, `#5eeeff`, `#9fe8f2`, `#4f8c98`, `#1f5663`, `#080d10`, `#0d171c`, `#11222a`) in `css/style.css` outside the `:root` block when the plan is done.
- Service worker becomes `pulsar-v19`; `FILES` lists every file in `js/` (new: `icons.js`, `menu.js`, `keys.js`, `theme.js`).
- Chrome test pitfalls (from earlier work): the dev server's HTTP cache serves stale modules — use a fresh port per check (`python3 -m http.server 80xx` in the repo, stop only your own server); programmatic `click()` gives no audio activation, use a real click once; `localhost` and `127.0.0.1` are different origins.

## Review Focus

- Space pressed while typing in a text field (notes, rhythm, rename, save-as) or on a focused button/slider: no play/stop, no `preventDefault` (Task 4 tests).
- A scene or file with a missing, non-object or out-of-range `tempo` (`bpm: 5000`, `'x'`, `on: 'yes'`) loads as clamped or off/120, never throws (Task 6 tests).
- `localStorage` unavailable or throwing: theme still applies, nothing throws (Task 8 tests).
- Open fullscreen detail with the bottom bar: content is not hidden under the bar and the bar stays clickable; status line sits above the bar (Task 4 Chrome check).
- Old scenes and all module files (no `tempo`) load unchanged (Task 6 tests).
- Menu `Escape` closes only the menu and must not close a detail or clear a field (Task 3/4 Chrome check).

---

### Task 1: Icon set (`js/icons.js`)

**Files:**
- Create: `js/icons.js`, `tests/icons.test.js`

**Interfaces:**
- Produces:
  - `ICON_PATHS: Record<string, string>` — SVG path data, viewBox 24, stroke-only.
  - `icon(name: string): SVGElement` — `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` with one `<path>`; throws `Error('unknown icon: <name>')` for an unknown name **before touching `document`**.
  - `iconButton(name: string, { label: string, className?: string, onClick?: Function }): HTMLButtonElement` — `type=button`, `title` = `aria-label` = `label`, class `icon-btn` plus `className`, contains `icon(name)`.
  - `setIcon(button, name, label)` — replaces the button's icon and updates `title`/`aria-label`.

- [ ] **Step 1: Write the failing test** `tests/icons.test.js`:
  - `ICON_PATHS` has exactly these keys (sorted compare): `check, close, down, drum, export, fx, import, list, load, menu, metronome, new, next, note, play, plus, prev, rename, save, stop, theme, trash, up, use, wave`.
  - every path is a non-empty string matching `/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/`.
  - `assert.throws(() => icon('nope'), /unknown icon: nope/)` (Node has no `document`, so this proves the throw comes first).
- [ ] **Step 2: Run** `node --test tests/icons.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `js/icons.js` with the signatures above. Draw simple 24×24 line icons (stroke only; play = triangle outline, stop = square outline). `setIcon` replaces `svg.icon` only and keeps any text sibling.
- [ ] **Step 4: Run** `npm test` — Expected: all pass (340 + the new ones).
- [ ] **Step 5: Commit** `feat: SVG icon set`.

---

### Task 2: Icons replace every text button

**Files:**
- Modify: `js/ui.js`, `js/card.js`, `js/sequence-ui.js`, `js/scenes-ui.js` (panel rows only), `css/style.css`
- Create: `tests/no-text-buttons.test.js`

**Interfaces:**
- Consumes: `icon`, `iconButton`, `setIcon` (Task 1).
- Produces: nothing new. CSS: `.icon { width: 22px; height: 22px; display: block; }`, `.icon-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; }`.

- [ ] **Step 1: Write the failing test** `tests/no-text-buttons.test.js`: read every `js/*.js` (except `icons.js`) as text; assert none matches `/textContent:\s*'\[/`, none contains `'■'`, `'×'` as a button label (`/textContent:\s*'×'/`), or the `PLAY` glyph constants (`/\\u25B6|▶︎/`). The `+ part` / `use running` / `↑ ↓ ◀ ▶` text button labels must also be gone: assert no `/btn\('(\+ part|use running|↑|↓|◀|▶)'/`.
- [ ] **Step 2: Run** it — Expected: FAIL listing the offending patterns.
- [ ] **Step 3: Replace the buttons.** Mapping (label kept as `title`/`aria-label`):
  - card close `×` → `close`; `[remove]` (module, effect, sequence) → `trash` "remove"; `[export]` → `export` "export module".
  - module/sequence/global play toggles: drop `PLAY`/`■`; use `setIcon(toggle, running ? 'stop' : 'play', title)` inside the existing state-change guard.
  - sequence buttons: `◀ ▶` → `prev`/`next`; `↑ ↓` → `up`/`down`; part `×` → `close` "remove part N"; `+ part` → `plus` "add a part"; `use running` → `use` "use the running modules in part N". `btn()` in `sequence-ui.js` takes an icon name instead of text.
  - scenes panel: `[ok]` → `check`; `[cancel]` → `close`; `[export file]`, `[export]`, `[export all]` → `export` with distinct labels; `[rename]` → `rename`; `[x]`/`[sure?]` → `trash` / `check` (label "sure? tap again"); `[import]` → `import`. Header buttons `[save] [load]` and the `+` menu are replaced in Task 4 — leave them as they are now.
  - CSS: add `.icon`, `.icon-btn`; keep `.seq-btn.wide` bordered style working for icon buttons.
- [ ] **Step 4: Run** the new test then `npm test` — Expected: PASS, all green.
- [ ] **Step 5: Chrome check** (fresh port, 320 px and desktop): add a melodic module, open its detail; play/stop, remove, export, close, sequence prev/next/up/down/add part/use running, scene save row and load list all show icons, are ≥ 44 px, and still work; icon colour follows hover/`running` state (play icon cyan when running).
- [ ] **Step 6: Commit** `feat: icons instead of text buttons`.

---

### Task 3: Menu component and status line (`js/menu.js`)

**Files:**
- Create: `js/menu.js`, `tests/menu.test.js`
- Modify: `css/style.css` (`.menu`, `.menu-item`, `.status`)

**Interfaces:**
- Consumes: `ICON_PATHS`/`icon` (Task 1), `FX_TYPES`, `FX_NEEDS_WORKLET` (`js/fx.js`), `FX_LABELS` (`js/fx-fields.js`).
- Produces:
  - `addMenuItems({ hasWorklet: boolean, hasSequence: boolean }): Array<{ id: string, icon: string, label: string }>` — pure. Order: `melodic` (icon `note`), `rhythmic` (`drum`), `drone` (`wave`), then one `fx:<type>` per `FX_TYPES` entry (icon `fx`, label `FX_LABELS[type]`; types in `FX_NEEDS_WORKLET` omitted when `!hasWorklet`), then `sequence` (icon `list`; omitted when `hasSequence`), last `import` (icon `import`, label `import module`). Labels for the first three are `melodic`, `rhythmic`, `drone`.
  - `menuItem({ icon, label, onSelect, disabled?, keepOpen? }): HTMLButtonElement` — `role=menuitem`, icon + visible label, min-height 44 px.
  - `createMenu({ button, panel, render }): { open(), close(), isOpen() }` — `render(panel, close)` fills the panel each time it opens. Sets `aria-haspopup`, `aria-expanded` on `button`, toggles `panel.hidden`. Closes on: pointerdown outside panel+button, `Escape` (capture-phase `document` keydown, only while open, calls `preventDefault()` so a detail underneath does not also close), selecting an item unless `keepOpen`. Opening one menu closes any other open one (module-level reference). After close, focus returns to `button` (not after an outside pointerdown).
  - `createStatus(node): (text: string) => void` — sets `node.textContent`, `node.setAttribute('aria-live','polite')`, clears after 5 s (previous timer cancelled).

- [ ] **Step 1: Write the failing tests** `tests/menu.test.js`:
  - with `{ hasWorklet: true, hasSequence: false }` the ids start `['melodic','rhythmic','drone']`, contain `fx:<t>` for every `FX_TYPES` entry, then `'sequence'`, and end with `'import'`.
  - `hasWorklet: false` → no id for any type in `FX_NEEDS_WORKLET`, but all other fx remain.
  - `hasSequence: true` → no `'sequence'`.
  - every item's `icon` is a key of `ICON_PATHS`; every `label` is a non-empty string; ids are unique.
- [ ] **Step 2: Run** `node --test tests/menu.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `js/menu.js` (pure part first, DOM part after; the module must import in Node without touching `document` at load time). Add CSS: `.menu` is `position: absolute; top: 100%` under the header, `right: var(--pad)`, `min-width: 220px`; at `max-width: 480px` it is `left: 0; right: 0` (full width); `.menu[hidden] { display: none }`; `.status` fixed above the transport bar (positioned in Task 4).
- [ ] **Step 4: Run** `npm test` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: menu component and status line`.

---

### Task 4: Header, menus, status line, bottom transport bar, Space

**Files:**
- Create: `js/keys.js`, `tests/keys.test.js`
- Modify: `index.html`, `js/main.js`, `js/ui.js`, `js/scenes-ui.js`, `css/style.css`

**Interfaces:**
- Consumes: `iconButton`, `setIcon` (Task 1); `addMenuItems`, `menuItem`, `createMenu`, `createStatus` (Task 3).
- Produces:
  - `shouldHandleSpace(e: { code, key, repeat, ctrlKey, metaKey, altKey, shiftKey, target }): boolean` in `js/keys.js` — true only for `code === 'Space'` (or `key === ' '`), no modifiers, `repeat` false, and `!(e.target?.isContentEditable || e.target?.closest?.('input, textarea, select, button, [role=slider], [contenteditable]'))`.
  - `mountScenes({ engine, store, sceneUi, panelEl, say, download? }): { openSave(), openLoad() }` — no header buttons or message span any more; `say` is injected; its hidden file input is appended to `document.body`. `openSave()`/`openLoad()` set the panel mode (not toggle).
  - `mountUi({ engine, effectsEl, modulesEl, sequenceEl, addBtn, addMenuEl, menuBtn, mainMenuEl, statusEl, transportEl, scenePanelEl, store })`.

- [ ] **Step 1: Write the failing tests** `tests/keys.test.js` with a `base = { code:'Space', key:' ', repeat:false, ctrlKey:false, metaKey:false, altKey:false, shiftKey:false, target:{ closest: () => null } }`:
  - `shouldHandleSpace(base) === true`.
  - false when each of `repeat`, `ctrlKey`, `metaKey`, `altKey` is true; false for `code:'Enter', key:'Enter'`.
  - false when `target.closest` returns an object (input/textarea/button/slider case) and when `target.isContentEditable` is true.
- [ ] **Step 2: Run** `node --test tests/keys.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `js/keys.js`. Run the test — Expected: PASS.
- [ ] **Step 4: Restructure `index.html`:** `<header class="bar">` holds `.brand` and `<span class="bar-actions">` with two icon buttons (`#add-btn`, `#menu-btn`); two hidden popover containers `#add-menu`, `#main-menu` inside the header's positioning context; keep `#scene-panel` and `<main>`; after `<main>` add `<div id="status" class="status">` and `<nav id="transport" class="transport" aria-label="transport">`. Add `viewport-fit=cover` to the viewport meta. Update `main.js` to pass the new element ids and the new `mountUi` parameters.
- [ ] **Step 5: Rewire `ui.js`/`scenes-ui.js`:**
  - `+` menu: `createMenu` with `render` built from `addMenuItems({ hasWorklet: engine.hasWorklet(), hasSequence: !!engine.sequence })` mapped to `menuItem`s calling the existing `add(factory)`, `addEffect(type)`, `engine.addSequence({})` + `addSequencePanel`, and the module-file input click (keep the `engine.resume()` call before the picker). Remove the old inline menu and `[+]`.
  - Hamburger menu (icons `new`, `load`, `save`; `theme` arrives in Task 8): **new scene** (`new`): when `engine.modules.length || engine.effects.length || engine.sequence`, the first click changes that item's own label to `sure? tap again` / icon `check` for 5 s and keeps the menu open; the second click runs `sceneUi.clear()`. When the scene is empty it does nothing and just closes. **load** → `scenes.openLoad()`; **save** → `scenes.openSave()`.
  - All former header messages and the module-import message go through `createStatus(statusEl)`'s `say`.
  - Transport bar: `transportEl` gets the play/stop `iconButton` (same `showsPlay()` logic and `setIcon` guard as the old global button). Register one `document` `keydown` listener: when `shouldHandleSpace(e)`, `e.preventDefault()` and run the same handler as the button click (`await engine.resume()` then `playAll`/`stopAll`).
- [ ] **Step 6: CSS:** header is a single row (brand left, actions right); `.transport { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex; align-items: center; gap: 8px; min-height: var(--transport-h); padding: 0 var(--pad) env(safe-area-inset-bottom); background: var(--bg); border-top: 1px solid var(--line); }` with `:root { --transport-h: 56px }`; `body` gets `padding-bottom: calc(var(--transport-h) + env(safe-area-inset-bottom) + var(--pad))`; `.status` is `position: fixed; left: var(--pad); right: var(--pad); bottom: calc(var(--transport-h) + env(safe-area-inset-bottom) + 8px); z-index: 30` and hidden when empty; `.card.open` gets `padding-bottom: calc(24px + var(--transport-h) + env(safe-area-inset-bottom))` and stays below the bar (`z-index: 20` < `30`); remove the `#scenes`/`#adder` rules; `body.detail-open header.bar` stays hidden, the transport bar does not.
- [ ] **Step 7: Run** `npm test` — Expected: all pass.
- [ ] **Step 8: Chrome check** (fresh port; 320 px and desktop):
  - header shows only name, `+`, hamburger; both menus open, close on outside click and `Escape`, only one open at a time; `Escape` with a menu open does not close an open detail or clear a field.
  - `+` adds melodic, rhythmic, drone, an effect and the sequence (sequence item disappears after adding it); import module opens the file picker.
  - hamburger: save/load open the panel; new scene asks twice, then empties everything; empty scene does nothing.
  - transport bar visible at the bottom, never overlaps content (scroll to the last card; open a detail and scroll to its end); play/stop works; Space plays/stops, but not while typing in the notes/rhythm/save-as fields and not on a focused card button; status messages appear above the bar and vanish after 5 s.
- [ ] **Step 9: Commit** `feat: header menus, status line, bottom transport bar, space shortcut`.

---

### Task 5: Global tempo core

**Files:**
- Modify: `js/timing.js`, `js/module.js`, `js/engine.js`, `tests/timing.test.js`, `tests/module.test.js`

**Interfaces:**
- Produces in `js/timing.js`:
  - `TEMPO_MIN = 20`, `TEMPO_MAX = 300`, `DEFAULT_TEMPO = Object.freeze({ on: false, bpm: 120 })`.
  - `cleanTempo(raw: unknown): { on: boolean, bpm: number }` — non-object → copy of default; `on` is true only for `=== true`; `bpm` must be a finite **number** (strings → default 120), rounded, clamped to 20–300.
  - `effectiveBpm(ownBpm: number, tempo?: { on, bpm }): number` — `tempo?.on === true && Number.isFinite(tempo.bpm)` → `tempo.bpm` clamped to 20–300, else `ownBpm`.
  - `createTempo(initial?): { state: { on, bpm }, set(partial): void }` — `state` is one stable object; `set` merges the partial into it through `cleanTempo`.
- Module: `tick(ctx, dest, now, tempo?)`; before `advance`, sets `m.bpm = effectiveBpm(m.params.bpm, tempo)`; `advance(...)` and the melodic `onStep` note duration both use `m.bpm` (`mod.bpm`). `makeModule` initialises `bpm: params.bpm`. The drone module ignores the 4th argument.
- Engine: `engine.tempo` (the stable state object), `engine.setTempo(partial)`; the clock callback calls `m.tick(ctx, m.out, ctx.currentTime, tempo.state)`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/timing.test.js`: `effectiveBpm(100, {on:false,bpm:200}) === 100`; `(100,{on:true,bpm:200}) === 200`; `(100,{on:true,bpm:NaN}) === 100`; `(100,{on:true,bpm:999}) === 300`; `(100) === 100`. `cleanTempo(undefined)` deep-equals `{on:false,bpm:120}`; `cleanTempo({on:true,bpm:90.6})` → `{on:true,bpm:91}`; `cleanTempo({on:'yes',bpm:'90'})` → `{on:false,bpm:120}`; `cleanTempo({bpm:5}).bpm === 20`. `createTempo()`: `set({on:true})` keeps `bpm 120`; `set({bpm:500})` → 300; `state` identity unchanged across sets.
  - `tests/module.test.js` (use `stubCtx` from `tests/helpers/stub-ctx.js`, which records `osc.starts`/`stops`): a melodic module `{ bpm: 60, rhythm: 'xxxxxxxxxxxxxxxx', swing: 0 }` ticked in 0.025 s steps for 4 s with `tempo = { on:true, bpm:240 }` has consecutive oscillator `starts` spaced `60/240/4` (±1e-6); without tempo the spacing is `60/60/4`. After a tick with tempo on, `m.bpm === 240`; with `undefined`, `m.bpm === 60`. Note duration follows the effective tempo: `stops[0]-starts[0]` with tempo 240 is strictly smaller than without tempo.
- [ ] **Step 2: Run** `npm test` — Expected: the new tests FAIL (missing exports / wrong spacing), the rest pass.
- [ ] **Step 3: Implement** the functions above, the `tick` change and the engine wiring. Do not rewrite `m.params.bpm` anywhere.
- [ ] **Step 4: Run** `npm test` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: global tempo override in module tick`.

---

### Task 6: Tempo in scenes

**Files:**
- Modify: `js/scene.js`, `js/scenes-ui.js`, `tests/scene.test.js`, `tests/scene-apply.test.js`, `tests/scene-file.test.js`

**Interfaces:**
- Consumes: `cleanTempo`, `DEFAULT_TEMPO` (Task 5), `engine.tempo`, `engine.setTempo`.
- Produces: `serializeScene({ modules, effects, stoppedByTransport?, sequence?, tempo? })` adds `tempo: { on, bpm }` (through `cleanTempo`) **only when `tempo` is passed**. `validateScene` returns `tempo: cleanTempo(data.tempo)` **only when `data.tempo` is a plain object** (otherwise no key). `applyScene` calls `engine.setTempo(scene.tempo ?? DEFAULT_TEMPO)` right after `ui.clear()`. Both `serializeScene` calls in `scenes-ui.js` pass `tempo: engine.tempo`.

- [ ] **Step 1: Write the failing tests:**
  - `scene.test.js`: serialize with `tempo: {on:true,bpm:140}` includes it; without the argument the result has no `tempo` key; `validateScene` with `tempo: {on:true,bpm:5000}` → `{on:true,bpm:300}`; with `tempo: 'x'` and with no `tempo` → no `tempo` key; with `{on:'yes',bpm:'x'}` → `{on:false,bpm:120}`.
  - `scene-apply.test.js` (stub engine gains `setTempo` recording its argument): applying a scene with `tempo` passes it; one without passes `{on:false,bpm:120}`.
  - `scene-file.test.js`: a scene with `tempo` survives `sceneToFile` → `parseSceneFile`; a module file produced by `moduleToFile(serializeModule(...))` has no `tempo` anywhere in its text.
- [ ] **Step 2: Run** `npm test` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** the changes above (the existing exact-equality scene tests must keep passing — that is why `tempo` is conditional).
- [ ] **Step 4: Run** `npm test` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: global tempo is saved in scenes`.

---

### Task 7: Global BPM controls in the transport bar

**Files:**
- Modify: `js/ui.js`, `css/style.css`

**Interfaces:**
- Consumes: `createSlider` (`js/controls.js`), `iconButton`/`setIcon`, `engine.tempo`, `engine.setTempo`, `DEFAULT_TEMPO`.
- Produces: in the transport bar after the play button: a **toggle** `iconButton('metronome', { label: 'global bpm' })` with `aria-pressed`, and a **slider** `createSlider({ min: 20, max: 300, step: 1, nudge: 1, ariaLabel: 'global bpm', value: engine.tempo.bpm, onInput })` (`onInput` → `engine.setTempo({ bpm: v })` then `slider.set(engine.tempo.bpm)`). `paramSlider('bpm', …)` rows get class `bpm-row`.

- [ ] **Step 1: Implement.**
  - Toggle click: `engine.setTempo({ on: !engine.tempo.on })`.
  - In the `frame()` loop, on change only: set toggle `aria-pressed`, `slider.set(engine.tempo.bpm)` when the value differs (a scene load changes it), toggle `body.tempo-on`, and set/remove `title="global BPM is on"` on every `.bpm-row`.
  - CSS: `body.tempo-on .bpm-row { opacity: 0.45 }` (still editable); the bar's slider is dimmed with the toggle off (`.transport:not(.tempo-on) .hud-slider { opacity: 0.55 }`, still adjustable); toggle uses accent colour when pressed.
  - New scene (Task 4 menu item) additionally calls `engine.setTempo(DEFAULT_TEMPO)`.
  - Layout must fit 320 px without horizontal scroll with all controls ≥ 44 px. If one row does not fit, wrap to two rows (play + toggle + value, slider below) and raise `--transport-h` for `max-width: 400px` accordingly (content padding follows `--transport-h`).
- [ ] **Step 2: Run** `npm test` — Expected: all pass.
- [ ] **Step 3: Chrome check** (fresh port; patch `OscillatorNode.prototype.start` before the first real click to record start times): a melodic module `rhythm: xxxxxxxxxxxxxxxx` shows step spacing `60/own/4` with global off and `60/global/4` with global on (e.g. 60 → 0.25 s vs global 240 → 0.0625 s), switching live without a restart or silence; module BPM sliders dim with a title while on and keep their own values after switching off; slider and toggle work by touch (simulated) and keyboard; saving a scene with global on and loading it restores toggle and value; new scene resets to off/120; bar fits 320 px.
- [ ] **Step 4: Commit** `feat: global BPM controls in the transport bar`.

---

### Task 8: Theme (accent colour), service worker, README

**Files:**
- Create: `js/theme.js`, `tests/theme.test.js`, `tests/css-theme.test.js`
- Modify: `css/style.css`, `js/main.js`, `js/ui.js`, `index.html` (only if the `theme-color` meta needs an id), `sw.js`, `README.md`

**Interfaces:**
- Consumes: `createMenu`/`menuItem` with `keepOpen` (Task 3), `icon('theme')`.
- Produces in `js/theme.js`:
  - `ACCENTS: Array<{ id: string, name: string, hue: number }>` — in order: `cyan 188`, `green 135`, `amber 40`, `magenta 320`, `violet 265`, `red 5` (id = name).
  - `DEFAULT_ACCENT = 'cyan'`, `STORAGE_KEY = 'pulsar.accent'`.
  - `deriveTheme(hue: number): Record<string, string>` — exactly the keys `--accent`, `--fg`, `--dim`, `--line`, `--glow`, `--panel`, `--panel-hi`, `--bg` with values `hsl(H, 100%, 68%)`, `hsl(H, 76%, 79%)`, `hsl(H, 32%, 44%)`, `hsl(H, 53%, 26%)`, `hsla(H, 100%, 68%, 0.35)`, `hsl(H, 36%, 8%)`, `hsl(H, 42%, 12%)`, `hsl(H, 33%, 5%)` (`H` = hue).
  - `loadAccent(storage): string` — returns a valid `ACCENTS` id from `storage.getItem(STORAGE_KEY)`, else `DEFAULT_ACCENT`; any throw or a `null` storage → `DEFAULT_ACCENT`.
  - `saveAccent(storage, id): boolean` — false for an unknown id, a `null` storage or a throw.
  - `applyTheme(root: HTMLElement, themeMeta: HTMLMetaElement | null, id: string): void` — sets each derived variable via `root.style.setProperty`, sets `themeMeta.content` to the `--bg` value; unknown id → default.

- [ ] **Step 1: Write the failing tests.**
  - `theme.test.js`: ids unique; hues are integers 0–359 and pairwise ≥ 20 apart; `deriveTheme(188)` has exactly the 8 keys and `['--accent']` equals `'hsl(188, 100%, 68%)'`, `['--glow']` equals `'hsla(188, 100%, 68%, 0.35)'`, `['--bg']` equals `'hsl(188, 33%, 5%)'`; `loadAccent` with `{getItem: () => 'green'}` → `'green'`, with `'nope'`/`null` return/throwing `getItem`/`null` storage → `'cyan'`; `saveAccent` stores the id with a stub `setItem`, returns false for `'nope'`, for a throwing `setItem`, and for `null`.
  - `css-theme.test.js`: read `css/style.css`, remove the first `:root { … }` block, assert the rest matches none of `/rgba\(\s*94\s*,\s*238\s*,\s*255/`, `/#5eeeff/i`, `/#9fe8f2/i`, `/#4f8c98/i`, `/#1f5663/i`, `/#080d10/i`, `/#0d171c/i`, `/#11222a/i`.
- [ ] **Step 2: Run** `npm test` — Expected: both new test files FAIL (`theme.js` missing; the CSS still has `rgba(94, 238, 255, …)` in `.hud-bar`, `.hud-fill`, `.env-area`).
- [ ] **Step 3: Implement.**
  - `theme.js` as specified. In `css/style.css` replace the three cyan literals with `color-mix(in srgb, var(--accent) N%, transparent)` using the same N as the old alpha (0.22→22%, 0.55→55%, 0.1→10%). Keep the `:root` defaults as they are (they are the cyan default, matching `deriveTheme(188)` closely).
  - `main.js`: before `mountUi`, `applyTheme(document.documentElement, document.querySelector('meta[name=theme-color]'), loadAccent(storage))` (reuse the guarded `storage`).
  - Hamburger menu: add item `theme` (`keepOpen: true`) that toggles a row of six round swatch buttons (44 px, `aria-pressed`, `title`/`aria-label` = accent name, background from `deriveTheme(hue)['--accent']`) appended to the menu panel; a click calls `applyTheme(...)` and `saveAccent(storage, id)` and updates `aria-pressed`; the menu stays open.
  - `sw.js`: `CACHE = 'pulsar-v19'`, `FILES` includes `js/icons.js`, `js/menu.js`, `js/keys.js`, `js/theme.js`; confirm `FILES` equals the files in `js/` (`ls js` compared by eye or `diff`).
  - `README.md`: update the controls section (icon buttons, `+` and hamburger menus, bottom transport bar with global BPM and Space, accent picker).
- [ ] **Step 4: Run** `npm test` — Expected: all pass.
- [ ] **Step 5: Chrome check** (fresh port; 320 px and desktop): each of the six accents recolours slider bars, envelope area and line, glow, panels, card corners, icons, the theme-colour meta; choice survives a reload; with `localStorage` blocked (`Object.defineProperty(window, 'localStorage', { get() { throw new Error() } })` before load via a fresh origin if practical) the app still starts in cyan; swatches are ≥ 44 px and readable; menu stays open while picking; cyan default looks like the previous version.
- [ ] **Step 6: Commit** `feat: accent colour theme, service worker v19, README`.
