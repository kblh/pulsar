# Step grid and keyboard for the rhythmic and melodic modules — design

Date: 2026-11-22. Source: `instructions.md` request of 22/11 plus the answer given in chat.

## Intent

Typing `x...x...` into text fields is slow on a phone and unreadable at a glance. The two pattern modules get touch
controls, in the spirit of the Teenage Engineering PO-33 (4×4 pad grid) and the Korg NTS-1 mkii (one compact keyboard).
They have to be easy to use with a thumb on a 320 px wide screen.

## Goals

- **Rhythmic:** a 4×4 grid of switches (16 steps, row-major, step 1 top left) edits one lane at a time. A lane
  selector above the grid picks kick, snare or hat. Each lane has its own mute switch. This replaces the three text rows
  and the three read-only step lines.
- **Melodic:** the same 4×4 grid edits the rhythm (one lane). A one-octave keyboard (12 keys) toggles which pitch
  classes the generator may use. This replaces the `notes` and `rhythm` text rows and the read-only `rhythm` line.
- Every touch target is at least 44 px. The playhead is visible in the grid. Works with mouse, touch and keyboard.
- Old scenes and module files load unchanged.

## Non-goals

- Playing notes live from the keyboard (no audition, no octave shift). Possible follow-up.
- A per-step pitch editor. The melody is still generated and evolved.
- More than 16 steps, more lanes, velocity or accents.
- Changing the other pitch rows (`pitch` scale/notes, `root`, `scale`, `octaves`).

## Approaches considered

1. **Shared building blocks, one file each (chosen).** `js/step-grid.js` (4×4 switch grid) and `js/keyboard.js` (one-octave
   keyboard), both pure-ish DOM components in the style of `createSlider` / `createSegmented`, used by `ui.js`. Pure
   helpers (pattern flip, pitch-class sets) live beside them and are unit tested.
2. Inline the markup in `ui.js`. Smaller diff, but `ui.js` is already 620 lines and the DOM parts could not be reused
   by the melodic and rhythmic cards. Rejected.
3. A canvas drawn grid. Better for animation, worse for accessibility and focus. Rejected.

## Design

### Step grid (`createStepGrid`)

- 16 `button`s with `aria-pressed`, labelled `step N`, in a CSS grid of 4 columns with a gap; each at least 44 px square
  and growing to fill the width up to a cap.
- `set(pattern)` paints the 16 booleans; `setPlayhead(i)` marks the current step. Both are called from the existing
  frame loop (as `gridRow.update` is today) and must not rebuild nodes.
- A tap flips one step and calls `onToggle(i)`. The module gets the full new pattern string through the existing
  `setParam('voice:<drum>')` / `setParam('rhythm')`. The grid shows the live (`current`) pattern, so evolution stays
  visible while the user edits.
- Pointer Events like the sliders: a touch must not toggle when it turns into a page scroll.

### Rhythmic card

- Lane selector: `createSegmented` with kick, snare, hat (the lane the grid edits).
- Mute: one toggle per lane, next to the selector row, `aria-pressed`, dimmed look when muted. New icon `mute`
  (and `sound` for the unmuted state) in `js/icons.js`; the icon test lists the names and is updated.
- The mute lives in `params.mute = { kick, snare, hat }` (booleans, default false). A muted lane stays in the
  evolution (so it comes back evolved), it is only skipped when the drum is played. It is saved in scenes and module
  files as an optional field; absent means unmuted. `version` stays 1.
- The empty lane must be possible with a grid (today `parsePattern` forces step 1 on). Decision: an empty lane is
  allowed for the voices of the rhythmic module; `mutateRhythm` must handle a pattern without hits. The melodic rhythm
  keeps at least one hit (a melodic module with no rhythm is silent and gives the user no way to tell why).

### Melodic card

- Rhythm: one step grid, no selector.
- Keyboard: 7 white and 5 black keys in one octave C to B, white keys at least 44 px wide, black keys drawn on top
  and at least 32 px wide with the touch area extended (as on the NTS-1 mkii, where the keys are the control).
  A lit key means the pitch class is in the pool.
- Meaning: the keys select pitch classes. In `notes` mode the pool is the selected pitch classes over the `octaves`
  slider (1 to 4) from octave 3, the same layout the `scale` mode uses. Tapping a key in `scale` mode first switches to
  `notes` mode seeded with the classes of the current scale, then applies the toggle, so the keyboard always shows the
  truth and never feels dead. The last lit key cannot be turned off.
- Storage: `pitchConfig.notes` stays a string. New value `"C E G A"` (pitch classes). `buildPitchPool` accepts both forms,
  so `"C4 E4 G4 A4"` from old scenes still means exactly those pitches. A token with an octave is one pitch, a token
  without one is expanded over the octaves.
- The read-only `pitch` line (melody index per step) stays as it is.

### Layout

Controls order in the rhythmic card: bpm, swing, lane selector + mutes, grid, rhythm mod, evolution. Melodic: osc rows,
envelope, bpm, swing, pitch mode, root, scale, octaves, keyboard, rhythm grid, randomize, rhythm mod, evolution. Below
360 px the grid stays 4 columns and shrinks to 44 px squares with a 6 px gap (4 × 44 + 3 × 6 = 194 px).

## Constraints

- No dependencies, vanilla JS/CSS, tests with `node --test`, no DOM tests (pure helpers carry the logic).
- The text-button lint (`tests/no-text-buttons.test.js`) stays green: keys and steps have no text glyphs of the forbidden kind.
- The accent theme: only `var(--accent)`, `color-mix` and the other tokens, no new literal colours (`css-theme.test.js`).
- Service worker version bumped and `FILES` updated with the new files.

## Left to the builder

Exact pixel sizes within the minimums above, the CSS of the black keys, icon drawings for `mute` and `sound`, whether
the keyboard keeps a visible name for each key (small labels only on C), and the order of tests.

## Not verifiable here

Real touch behaviour on a phone and the Chrome extension may still refuse local pages. Browser checks will be done if the
extension connects, otherwise reported as not verified.
