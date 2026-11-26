import { SCALES, pitchClasses, toggleClass } from './scales.js';
import { flipStep, formatPattern, isOnlyHit } from './rhythm.js';
import { createStepGrid } from './step-grid.js';
import { createRhythmCircle } from './rhythm-circle.js';
import { BUILT_IN_RHYTHMS, createRhythmStore } from './rhythm-store.js';
import { DRUM_SOUNDS } from './synth.js';
import { createKeyboard } from './keyboard.js';
import { createCircle } from './circle.js';
import { WAVES, ROOTS } from './options.js';
import { cleanName, NAME_MAX, serializeModule, addModuleFromData, MAX_MODULES, MAX_EFFECTS } from './scene.js';
import { createSwitch } from './switch.js';
import { mountScenes, defaultDownload } from './scenes-ui.js';
import { addMenuItems, menuItem, createMenu, createStatus } from './menu.js';
import { shouldHandleSpace } from './keys.js';
import { ACCENTS, deriveTheme } from './theme.js';
import { DEFAULT_TEMPO, TEMPO_MIN, TEMPO_MAX } from './timing.js';
import { MAX_FILE_BYTES } from './scene-file.js';
import { moduleFilename, moduleToFile, parseModuleFile } from './module-file.js';
import { createCard } from './card.js';
import { iconButton, setIcon, icon } from './icons.js';
import { createSlider, createSegmented } from './controls.js';
import { createKnob } from './knob.js';
import { createEnvelopeEditor } from './envelope.js';
import { splitRoot, joinRoot, formatCents } from './hud.js';
import { createPedal } from './pedal.js';
import { SLOTS } from './sends.js';
import { FX_TYPES, FX_NEEDS_WORKLET } from './fx.js';
import { FX_LABELS } from './fx-fields.js';
import { mountSequenceCard } from './sequence-ui.js';
import { createDetail } from './detail.js';
import { createMelodicModule, createRhythmicModule, createDroneModule, createSynthModule } from './module.js';
import { createPlayPads } from './play-pads.js';


function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/** A control with its label above it. */
function field(label, ...controls) {
  return el('div', { className: 'field' }, el('span', { className: 'field-label', textContent: label }), ...controls);
}

/** A titled group of fields; on a wide screen the groups sit in columns. */
function group(title, ...children) {
  return el('div', { className: 'group' }, el('h3', { className: 'group-title', textContent: title }), ...children);
}

/** Knobs side by side; they wrap on a narrow screen. */
const knobs = (...nodes) => el('div', { className: 'knobs' }, ...nodes);

function select(options, value, onChange) {
  const s = el('select');
  for (const o of options) s.append(el('option', { value: o, textContent: o, selected: o === value }));
  s.onchange = () => onChange(s.value);
  return s;
}

function text(value, onChange) {
  const i = el('input', { type: 'text', value, spellcheck: false });
  i.onchange = () => onChange(i.value);
  return i;
}

const pct = (v) => `${Math.round(v * 100)}%`;
const waveOptions = WAVES.map((w) => ({ value: w, label: { sawtooth: 'saw', triangle: 'tri' }[w] ?? w }));

/** A segmented switch (the node only). */
const seg = (options, value, ariaLabel, onChange) => createSegmented({ options, value, ariaLabel, onChange }).node;

/** A knob for `m.params[key]`; it shows what the module accepted and never writes on first paint. */
function paramKnob(label, m, key, { min, max, step, format = String, defaultValue }) {
  const k = createKnob({
    min, max, step, format, label, ariaLabel: label, value: m.params[key], defaultValue,
    onInput: (v) => {
      m.setParam(key, v);
      k.set(m.params[key]);
    },
  });
  return k.node;
}

/** The tempo knob; it is dimmed while the global BPM is on. */
function bpmKnob(m) {
  const node = paramKnob('bpm', m, 'bpm', { min: 20, max: 300, step: 1, defaultValue: 120 });
  node.classList.add('bpm-row');
  return node;
}

/** A text grid row: one span per step; update() paints the pattern and playhead. */
function gridRow(name, getPattern, getPitches) {
  const spans = Array.from({ length: 16 }, () => el('span', { className: 'step' }));
  const line = el('div', { className: 'line' }, el('span', { className: 'name', textContent: name }), ...spans);
  return {
    node: line,
    update(playhead) {
      const p = getPattern();
      const pitches = getPitches?.();
      spans.forEach((s, i) => {
        s.textContent = p[i] ? (pitches ? pitches[i].toString(16) : 'x') : '.';
        s.className = `step ${p[i] ? 'on' : 'off'}${i === playhead ? ' now' : ''}`;
      });
    },
  };
}

function pitchRows(m, { withNotes, withOctaves = true }) {
  const cfg = () => ({ ...m.params.pitchConfig });
  const setCfg = (k) => (v) => m.setParam('pitchConfig', { ...cfg(), notes: cfg().notes ?? 'C4 E4 G4 A4', [k]: k === 'octaves' ? Number(v) : v });
  const c = m.params.pitchConfig;
  const octaves = createKnob({
    min: 1, max: 4, step: 1, format: String, label: 'octaves', ariaLabel: 'octaves', value: c.octaves ?? 2, defaultValue: 2,
    onInput: (v) => {
      setCfg('octaves')(v);
      octaves.set(m.params.pitchConfig.octaves ?? 2);
    },
  });
  const mode = createSegmented({ options: ['scale', 'notes'], value: c.mode, ariaLabel: 'pitch mode', onChange: setCfg('mode') });
  const rows = [
    field('pitch', mode.node),
    field('root and scale', el('div', { className: 'pair' },
      select(ROOTS, c.root ?? 'C', setCfg('root')), select(Object.keys(SCALES), c.scale ?? 'pentatonicMinor', setCfg('scale')))),
    ...(withOctaves ? [knobs(octaves.node)] : []),
    ...(withNotes ? [field('notes', text(c.notes ?? 'C4 E4 G4 A4', setCfg('notes')))] : []),
  ];
  let shown = c.mode;
  rows.syncMode = () => { // the keyboard can switch the mode
    const now = m.params.pitchConfig.mode;
    if (now !== shown) mode.set((shown = now));
  };
  return rows;
}

function oscGroup(m) {
  const set = (k) => (v) => m.setParam(k, v);
  return group('oscillators',
    field('osc', seg(waveOptions, m.params.wave, 'osc', set('wave'))),
    field('osc 2', seg(waveOptions, m.params.wave2, 'osc 2', set('wave2'))),
    knobs(
      paramKnob('mix', m, 'mix', { min: 0, max: 1, step: 0.05, format: pct, defaultValue: 0.5 }),
      paramKnob('detune', m, 'detune', { min: -50, max: 50, step: 1, format: formatCents, defaultValue: 0 }),
    ));
}

const NOTE_VIEW_KEY = 'pulsar.noteView';

/** The notes of a melody as a circle of fifths (the default) or a keyboard, with a switch; the choice is remembered. */
function notePicker({ keyboard, circle }) {
  let view = 'circle';
  try { if (localStorage.getItem(NOTE_VIEW_KEY) === 'keys') view = 'keys'; } catch { /* storage is blocked */ }
  const holder = el('div', { className: 'note-picker' });
  const show = (v) => holder.replaceChildren((v === 'keys' ? keyboard : circle).node);
  const mode = createSegmented({
    options: ['circle', 'keys'], value: view, ariaLabel: 'notes view',
    onChange: (v) => {
      show(v);
      try { localStorage.setItem(NOTE_VIEW_KEY, v); } catch { /* storage is blocked */ }
    },
  });
  show(view);
  return {
    node: el('div', { className: 'note-view' }, mode.node, holder),
    set(classes) {
      keyboard.set(classes);
      circle.set(classes);
    },
  };
}

function melodicControls(m, live) {
  const pitch = pitchRows(m, { withNotes: false });
  const set = (k) => (v) => m.setParam(k, v);
  const toggle = (pc) => {
    m.setParam('pitchConfig', toggleClass(m.params.pitchConfig, pc));
    paint();
  };
  const keyboard = notePicker({ keyboard: createKeyboard({ onToggle: toggle }), circle: createCircle({ onToggle: toggle }) });
  const rhythmGrid = createStepGrid({
    ariaLabel: 'rhythm steps',
    onToggle: (i) => {
      if (isOnlyHit(m.state.rhythm.current, i)) return; // a melody needs one hit
      m.setParam('rhythm', formatPattern(flipStep(m.state.rhythm.current, i)));
      paint();
    },
  });
  const paint = () => {
    pitch.syncMode();
    keyboard.set(pitchClasses(m.params.pitchConfig));
    rhythmGrid.set(m.state.rhythm.current);
  };
  paint();
  live.push({ update: (playhead) => { paint(); rhythmGrid.setPlayhead(playhead); } });
  const envelope = createEnvelopeEditor({
    env: m.params.env,
    onChange: (partial) => {
      m.setParam('env', partial);
      envelope.set(m.params.env); // the module's accepted values
    },
  });
  return [
    oscGroup(m),
    group('envelope', envelope.node),
    group('timing', knobs(
      bpmKnob(m),
      paramKnob('swing', m, 'swing', { min: 0, max: 1, step: 0.05, format: pct, defaultValue: 0 }),
    )),
    group('pitch', ...pitch, field('notes', keyboard.node)),
    group('rhythm',
      field('steps', rhythmGrid.node),
      knobs(
        paramKnob('randomize', m, 'randomize', { min: 1, max: 10, step: 1 }),
        paramKnob('rhythm mod', m, 'rhythmMod', { min: 1, max: 10, step: 1 }),
      ),
      field('evolution', seg(['drift', 'walk'], m.params.evolution, 'evolution', set('evolution')))),
  ];
}

/** The pan knob for the card header: small, no label (the aria label names it), double tap centres it. */
function panKnob(engine, m) {
  const pan = createKnob({
    min: -1, max: 1, step: 0.05, ariaLabel: 'pan', value: m.pan ?? 0, defaultValue: 0,
    onInput: (v) => {
      engine.setPan(m, v);
      pan.set(m.pan);
    },
  });
  pan.node.classList.add('knob-compact');
  pan.node.title = 'pan';
  return pan.node;
}

/** The panel title's name: click to edit, Enter or blur keeps it, Esc cancels, empty falls back to the type. */
function nameEditor(obj) {
  const node = el('span');
  const show = () => {
    const b = el('button', { textContent: obj.name, className: 'name-btn', title: 'click to rename' });
    b.onclick = edit;
    node.replaceChildren(b);
  };
  function edit() {
    const input = el('input', { type: 'text', value: obj.name, spellcheck: false, maxLength: NAME_MAX });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) obj.name = cleanName(input.value, obj.type);
      show();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') {
        e.preventDefault(); // cancels the rename only, the detail stays open
        finish(false);
      }
    };
    input.onblur = () => finish(true);
    node.replaceChildren(input);
    input.focus();
    input.select();
  }
  show();
  return node;
}

/** One send slot: a target select (rebuilt by fill() when effects come and go) and a level knob. */
function sendRow(engine, m, slot, newEffect) {
  const sel = el('select');
  const fill = () => {
    sel.replaceChildren(
      el('option', { value: '', textContent: '—' }),
      ...engine.effects.map((fx) => el('option', { value: fx.id, textContent: `${fx.id} ${fx.name}` })),
    );
    sel.value = m.sends[slot].fx ?? '';
  };
  sel.onchange = () => {
    engine.setSend(m, slot, { fx: sel.value || null });
    sel.value = m.sends[slot].fx ?? '';
  };
  fill();
  sel.setAttribute('aria-label', `send ${slot + 1} target`);
  const level = createKnob({
    min: 0, max: 1, step: 0.01, format: pct, ariaLabel: `send ${slot + 1} level`, value: m.sends[slot].level, defaultValue: 0,
    onInput: (v) => {
      engine.setSend(m, slot, { level: v });
      level.set(m.sends[slot].level);
    },
  });
  // A new effect of the chosen type, created and put into this slot in one go.
  const fresh = el('select', { className: 'send-new' });
  fresh.setAttribute('aria-label', `send ${slot + 1} new effect`);
  const types = FX_TYPES.filter((t) => !FX_NEEDS_WORKLET.includes(t) || engine.hasWorklet());
  fresh.append(el('option', { value: '', textContent: '+' }), ...types.map((t) => el('option', { value: t, textContent: FX_LABELS[t] ?? t })));
  fresh.onchange = async () => {
    const type = fresh.value;
    fresh.value = '';
    if (!type) return;
    const fx = await newEffect(type);
    if (!fx) return;
    engine.setSend(m, slot, { fx: fx.id });
    fill();
  };
  return { row: field(`send ${slot + 1}`, el('div', { className: 'send' }, sel, fresh, level.node)), fill };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const midiName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/** The drone's base tone: a tone select and an octave knob. Both show what the module accepted. */
function rootPicker(m) {
  const cur = () => splitRoot(m.params.rootNote) ?? { root: 'C', octave: 2 };
  const show = () => {
    const c = cur();
    tone.value = c.root;
    octave.set(c.octave);
  };
  const apply = (root, oct) => {
    m.setParam('rootNote', joinRoot(root, oct)); // the module refuses tones outside C0-C6
    show();
  };
  const tone = select(ROOTS, cur().root, (root) => apply(root, cur().octave));
  const octave = createKnob({
    min: 0, max: 6, step: 1, format: String, label: 'octave', ariaLabel: 'octave', value: cur().octave, defaultValue: 2,
    onInput: (o) => apply(tone.value, o),
  });
  return [field('base tone', tone), knobs(octave.node)];
}

/** The live synth: pads to play, three oscillators, an envelope and a scale. */
const PAD_LAYOUT_KEY = 'pulsar.padLayout';
const padLayoutOptions = [{ value: 'grid', label: 'grid' }, { value: 'keys', label: 'keys' }, { value: 'kalimba', label: 'kalimba' }];

function synthControls(m, live) {
  let padLayout = 'grid';
  try {
    const saved = window.localStorage.getItem(PAD_LAYOUT_KEY);
    if (saved === 'kalimba' || saved === 'keys') padLayout = saved;
  } catch { /* no storage */ }
  const pads = createPlayPads({
    label: (i) => midiName(m.padNote(i)),
    role: (i) => m.padRole(i),
    layout: padLayout,
    keysActive: () => m.running, // the active synth is played from the computer keyboard on the main page too
    onDown: (i) => m.noteOn(i),
    onUp: (i) => m.noteOff(i),
    onSlide: (from, to) => m.slide(from, to),
  });
  live.push({ update: () => { pads.setLabels(); if (!m.running) pads.releaseAll(); } });
  const oscRow = (i) => {
    const o = () => m.params.oscs[i];
    const set = (key) => (v) => m.setParam(`osc:${i}`, { [key]: v });
    const knob = (label, key, opts) => {
      const k = createKnob({
        ...opts, label, ariaLabel: `osc ${i + 1} ${label}`, value: o()[key],
        onInput: (v) => {
          set(key)(v);
          k.set(o()[key]);
        },
      });
      return k.node;
    };
    return field(`osc ${i + 1}`, el('div', { className: 'osc-row' },
      seg(waveOptions, o().wave, `osc ${i + 1} wave`, set('wave')),
      knobs(
        knob('level', 'level', { min: 0, max: 1, step: 0.05, format: pct, defaultValue: i === 0 ? 1 : 0 }),
        knob('octave', 'octave', { min: -2, max: 2, step: 1, format: (v) => (v > 0 ? `+${v}` : String(v)), defaultValue: 0 }),
        knob('detune', 'detune', { min: -50, max: 50, step: 1, format: formatCents, defaultValue: 0 }),
      )));
  };
  const envelope = createEnvelopeEditor({
    env: m.params.env,
    onChange: (partial) => {
      m.setParam('env', partial);
      envelope.set(m.params.env);
    },
  });
  const pitch = pitchRows(m, { withNotes: true, withOctaves: false });
  live.push({ update: () => pitch.syncMode() });
  return [
    group('play',
      el('div', { className: 'play-layout' }, seg(padLayoutOptions, padLayout, 'pad layout', (v) => {
        pads.setLayout(v);
        try { window.localStorage.setItem(PAD_LAYOUT_KEY, v); } catch { /* no storage */ }
      })),
      pads.node,
      Object.assign(knobs(
        paramKnob('octave', m, 'octave', { min: -2, max: 2, step: 1, format: (v) => (v > 0 ? `+${v}` : String(v)), defaultValue: 0 }),
        paramKnob('portamento', m, 'glide', { min: 0, max: 0.15, step: 0.005, format: (v) => (v === 0 ? 'off' : `${Math.round(v * 1000)} ms`), defaultValue: 0 }),
      ), { className: 'knobs play-octave' })),
    group('oscillators', ...[0, 1, 2].map(oscRow)),
    group('envelope', envelope.node),
    group('scale', ...pitch),
  ];
}

function droneControls(m) {
  return [
    oscGroup(m),
    group('pitch', ...rootPicker(m), ...pitchRows(m, { withNotes: true })),
    group('evolution', knobs(
      paramKnob('max extra', m, 'maxExtra', { min: 0, max: 6, step: 1 }),
      paramKnob('rate', m, 'rate', { min: 1, max: 10, step: 1 }),
      paramKnob('fade', m, 'fade', { min: 0.5, max: 30, step: 0.5, format: (v) => `${v} s` }),
    )),
  ];
}

/** A one-line status row for modules without a step grid. */
function statusRow(name, getText) {
  const value = el('span', { textContent: '' });
  const line = el('div', { className: 'line' }, el('span', { className: 'name', textContent: name }), value);
  return { node: line, update: () => { value.textContent = getText(); } };
}

const RHYTHM_VIEW_KEY = 'pulsar.rhythmView';
const storageOrNull = () => { try { return window.localStorage; } catch { return null; } };
const rhythmStore = createRhythmStore(storageOrNull() ?? { getItem: () => null, setItem: () => { throw new Error('no storage'); } });

/** Built-in grooves and the user's saved ones: pick to load, save the current one under a name, delete a saved one. */
function rhythmLibrary(m, repaint) {
  const msg = el('div', { className: 'muted rhythm-msg', role: 'status' });
  const picker = el('select');
  picker.setAttribute('aria-label', 'rhythm');
  const name = el('input', { type: 'text', placeholder: 'name', spellcheck: false, maxLength: 24 });
  name.setAttribute('aria-label', 'rhythm name');
  const remove = iconButton('trash', { label: 'delete saved rhythm' });
  const say = (t) => { msg.textContent = t; };
  const option = (r, saved) => el('option', { value: `${saved ? 's' : 'b'}:${r.id}`, textContent: r.name });
  const refill = (selected) => {
    const saved = rhythmStore.list();
    picker.replaceChildren(
      el('option', { value: '', textContent: 'choose a rhythm' }),
      el('optgroup', { label: 'built in' }, ...BUILT_IN_RHYTHMS.map((r) => option(r, false))),
      ...(saved.length ? [el('optgroup', { label: 'saved' }, ...saved.map((r) => option(r, true)))] : []));
    picker.value = selected ?? '';
    remove.disabled = !picker.value.startsWith('s:');
  };
  const find = (value) => (value.startsWith('s:') ? rhythmStore.get(value.slice(2)) : BUILT_IN_RHYTHMS.find((r) => r.id === value.slice(2)));
  picker.onchange = () => {
    const r = picker.value ? find(picker.value) : null;
    remove.disabled = !picker.value.startsWith('s:');
    if (!r) return;
    for (const [d, pattern] of Object.entries(r.voices)) m.setParam(`voice:${d}`, pattern);
    for (const d of ['kick', 'snare', 'hat']) m.setParam(`rotation:${d}`, r.rotation?.[d] ?? 0);
    for (const [d, n] of Object.entries(r.sounds ?? {})) m.setParam(`sound:${d}`, n);
    say('');
    repaint();
  };
  const save = iconButton('save', { label: 'save the rhythm' });
  save.onclick = () => {
    const r = rhythmStore.save(name.value, { voices: m.params.voices, rotation: m.params.rotation, sounds: m.params.sounds });
    if (!r.ok) return say(r.error);
    say(`saved "${name.value.trim()}"`);
    name.value = '';
    refill(`s:${r.id}`);
  };
  name.onkeydown = (e) => { if (e.key === 'Enter') save.onclick(); };
  remove.onclick = () => {
    const r = rhythmStore.remove(picker.value.slice(2));
    say(r.ok ? 'deleted' : r.error);
    refill();
  };
  refill();
  return field('rhythms', picker, el('div', { className: 'pair' }, name, save, remove), msg);
}

function rhythmicControls(m, live) {
  const set = (k) => (v) => m.setParam(k, v);
  const DRUMS = ['kick', 'snare', 'hat'];
  let lane = 'kick';
  const flip = (drum, i) => {
    m.setParam(`voice:${drum}`, formatPattern(flipStep(m.state.voices[drum].current, i)));
    paint();
  };
  const grid = createStepGrid({ ariaLabel: 'kick steps', onToggle: (i) => flip(lane, i), max: 32 });
  const circle = createRhythmCircle({ onToggle: flip });
  const paint = () => {
    grid.set(m.state.voices[lane].current);
    circle.set(Object.fromEntries(DRUMS.map((d) => [d, m.state.voices[d].current])), m.params.rotation);
  };
  const laneField = field('lane', seg(DRUMS, lane, 'lane', (v) => {
    lane = v;
    grid.node.setAttribute('aria-label', `${lane} steps`);
    paint();
  }));
  const gridField = field('steps', grid.node);
  let view = 'circle';
  try { if (localStorage.getItem(RHYTHM_VIEW_KEY) === 'grid') view = 'grid'; } catch { /* storage is blocked */ }
  const circleBox = el('div', { className: 'circle-box' }, circle.node);
  const showView = (v) => {
    view = v;
    circleBox.hidden = v !== 'circle';
    laneField.hidden = gridField.hidden = v !== 'grid';
  };
  const viewSeg = seg(['circle', 'grid'], view, 'rhythm view', (v) => {
    showView(v);
    try { localStorage.setItem(RHYTHM_VIEW_KEY, v); } catch { /* storage is blocked */ }
  });
  showView(view);
  const muteButtons = DRUMS.map((d) => {
    const b = el('button', { type: 'button', className: 'mute-btn' });
    const show = () => {
      const muted = m.params.mute[d];
      b.setAttribute('aria-pressed', String(muted));
      b.title = `${muted ? 'unmute' : 'mute'} ${d}`;
      b.setAttribute('aria-label', `mute ${d}`); // the state is aria-pressed
      b.replaceChildren(icon(muted ? 'mute' : 'sound'), el('span', { textContent: d }));
    };
    b.onclick = () => {
      m.setParam(`mute:${d}`, !m.params.mute[d]);
      show();
    };
    show();
    return b;
  });
  const soundSegs = DRUMS.map((d) => createSegmented({
    options: DRUM_SOUNDS[d], value: DRUM_SOUNDS[d][m.params.sounds[d]], ariaLabel: `${d} sound`,
    onChange: (v) => m.setParam(`sound:${d}`, DRUM_SOUNDS[d].indexOf(v)),
  }));
  // Steps and rotation of each lane: the rotation knob ends at the lane's last step, so it is built again when the lane changes length.
  const laneKnobs = DRUMS.map((d) => {
    const box = el('div', { className: 'knobs' });
    let rot = null;
    let subs = null;
    const build = () => {
      const n = m.state.voices[d].current.length;
      subs.set(n);
      rot = createKnob({
        min: 0, max: n - 1, step: 1, format: String, label: 'rotation', ariaLabel: `${d} rotation`, value: m.params.rotation[d], defaultValue: 0,
        onInput: (v) => {
          m.setParam(`rotation:${d}`, v);
          rot.set(m.params.rotation[d]);
          paint();
        },
      });
      box.replaceChildren(subs.node, rot.node);
    };
    subs = createKnob({
      min: 2, max: 32, step: 1, format: String, label: 'steps', ariaLabel: `${d} steps`, value: m.state.voices[d].current.length, defaultValue: 16,
      onInput: (v) => {
        m.setParam(`subs:${d}`, v);
        subs.set(m.state.voices[d].current.length);
        build();
        paint();
      },
    });
    build();
    return { node: field(d, box), build };
  });
  const library = rhythmLibrary(m, () => {
    laneKnobs.forEach((k) => k.build());
    paint();
    soundSegs.forEach((sg, k) => sg.set(DRUM_SOUNDS[DRUMS[k]][m.params.sounds[DRUMS[k]]]));
  });
  paint();
  live.push({
    update: (playhead) => {
      paint();
      const j = (stepsOf, pos) => (pos < 0 ? -1 : (((pos - m.params.rotation[lane]) % stepsOf) + stepsOf) % stepsOf);
      grid.setPlayhead(playhead < 0 ? -1 : j(m.state.voices[lane].current.length, m.state.positions[lane]));
      circle.setPlayhead(playhead, m.state.positions);
    },
  });
  return [
    group('timing', knobs(
      bpmKnob(m),
      paramKnob('swing', m, 'swing', { min: 0, max: 1, step: 0.05, format: pct, defaultValue: 0 }),
    )),
    group('pattern',
      field('view', viewSeg),
      circleBox,
      laneField,
      gridField,
      field('mute', el('div', { className: 'mute-row' }, ...muteButtons))),
    group('steps and rotation', ...laneKnobs.map((k) => k.node)),
    group('sounds', ...DRUMS.map((d, k) => field(d, soundSegs[k].node))),
    group('rhythms', library),
    group('evolution',
      knobs(paramKnob('rhythm mod', m, 'rhythmMod', { min: 1, max: 10, step: 1 })),
      field('evolution', seg(['drift', 'walk'], m.params.evolution, 'evolution', set('evolution')))),
  ];
}

export function mountUi({ engine, effectsEl, modulesEl, synthsEl, sequenceEl, addBtn, addMenuEl, menuBtn, mainMenuEl, statusEl, transportEl, scenePanelEl, store, accent }) {
  const panels = new Map(); // module id -> { card, rows, module, toggle }
  const fxCards = new Map(); // effect id -> { card, fx, bypass, pedal }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const detail = createDetail({
    win: window,
    doc: document,
    transition: (fn) => {
      if (!document.startViewTransition || reduced.matches) return void fn();
      const t = document.startViewTransition(fn);
      t.ready.catch(() => {}); // a newer transition skipping this one rejects `ready`; that is fine
      return t;
    },
  });
  const sendFills = new Map(); // module id -> fill functions of its send selects
  let effectsSig = '';

  function removeFxPanel(id) {
    engine.removeEffect(id);
    const entry = fxCards.get(id);
    if (entry && detail.current() === entry.card) detail.close();
    entry?.card.node.remove();
    fxCards.delete(id);
  }

  let sequenceUi = null; // the card of the one sequence, if there is one

  function addSequencePanel(seq) {
    sequenceUi = mountSequenceCard({ engine, seq, detail, container: sequenceEl, nameEditor, onRemove: removeSequencePanel });
  }

  function removeSequencePanel() {
    if (sequenceUi) {
      if (detail.current() === sequenceUi.card) detail.close();
      sequenceUi.remove();
      sequenceUi = null;
    }
    engine.removeSequence();
  }

  function removeModulePanel(id) {
    engine.removeModule(id);
    sendFills.delete(id);
    const entry = panels.get(id);
    if (entry && detail.current() === entry.card) detail.close();
    entry?.card.node.remove();
    panels.delete(id);
  }

  function addFxPanel(fx) {
    const bypass = createSwitch({ label: 'effect on', on: fx.enabled, onToggle: () => { engine.setFxEnabled(fx, !fx.enabled); bypass.set(fx.enabled); } });
    const remove = iconButton('trash', { label: 'remove effect', onClick: () => removeFxPanel(fx.id) });
    const cloneBtn = iconButton('clone', {
      label: 'clone effect',
      onClick: async () => {
        if (engine.effects.length >= MAX_EFFECTS) return say(`at most ${MAX_EFFECTS} effects`);
        let copy = null;
        try {
          copy = engine.addEffect(fx.type, JSON.parse(JSON.stringify(fx.params)));
          copy.name = cleanName(`${fx.name} copy`, fx.type);
          if (fx.enabled === false) engine.setFxEnabled(copy, false);
          addFxPanel(copy);
        } catch {
          if (copy) { try { engine.removeEffect(copy.id); } catch { /* already gone */ } }
          say('could not clone the effect');
        }
      },
    });
    const pedal = createPedal({
      fx,
      setParam: (key, v) => engine.setFxParam(fx, key, v),
      onToggle: () => {
        engine.setFxEnabled(fx, !fx.enabled);
        bypass.set(fx.enabled);
      },
    });
    const controls = pedal.node;
    const card = createCard({
      kind: 'effect',
      title: fx.name,
      iconName: 'fx',
      nameEditor: el('span', {}, `${fx.id} `, nameEditor(fx)),
      lead: [bypass.node],
      actions: [cloneBtn, remove],
      body: [controls],
      detail,
    });
    fxCards.set(fx.id, { card, fx, bypass, pedal });
    effectsEl.append(card.node);
  }

  function addPanel(m) {
    const isSynth = m.type === 'synth'; // played by hand: no start / stop
    // A synth is switched on or off like an effect (only one is on at a time); the other modules start and stop.
    const synthOn = isSynth ? createSwitch({ label: 'synth on', on: m.running, onToggle: () => { engine.setRunning(m, !m.running); synthOn.set(m.running); } }) : null;
    const toggle = isSynth ? null : iconButton('play', { label: 'start', className: 'play', onClick: () => engine.toggle(m) });
    const remove = iconButton('trash', { label: 'remove module', onClick: () => removeModulePanel(m.id) });
    const cloneBtn = iconButton('clone', {
      label: 'clone module',
      onClick: () => {
        if (engine.modules.length >= MAX_MODULES) return say(`at most ${MAX_MODULES} modules`);
        const index = new Map(engine.effects.map((fx, i) => [fx.id, i]));
        const data = {
          ...serializeModule(m, engine.stoppedByTransport),
          name: cleanName(`${m.name ?? m.type} copy`, m.type),
          sends: (m.sends ?? []).map((s) => ({ fx: index.has(s.fx) ? index.get(s.fx) : null, level: s.level })),
        };
        try {
          addPanel(addModuleFromData(engine, data, { fxs: engine.effects }));
        } catch {
          say('could not clone the module');
        }
      },
    });
    const exportBtn = iconButton('export', {
      label: 'export module',
      onClick: () => defaultDownload(moduleFilename(m.name), moduleToFile(serializeModule(m, engine.stoppedByTransport))),
    });
    const volume = createSlider({
      min: 0, max: 1, step: 0.01, ariaLabel: 'volume', value: m.volume ?? 1,
      onInput: (v) => {
        engine.setVolume(m, v);
        volume.set(m.volume);
      },
    });

    let rows;
    if (m.type === 'drone') {
      rows = [
        statusRow('now', () =>
          [...m.state.sounding().map(midiName), ...m.state.releasing().map((n) => `${midiName(n)}↓`)].join(' + '),
        ),
      ];
    } else if (m.type === 'melodic') {
      rows = [gridRow('pitch', () => m.state.rhythm.current, () => m.state.melody.current)];
    } else {
      rows = [];
    }
    const live = []; // updaters of the interactive controls (step grids, keyboard)
    const grid = el('div', { className: 'grid' }, ...rows.map((r) => r.node));
    const sends = Array.from({ length: SLOTS }, (_, slot) => sendRow(engine, m, slot, addEffect));
    sendFills.set(m.id, sends.map((x) => x.fill));
    const controls = [
      ...{ melodic: melodicControls, rhythmic: rhythmicControls, drone: droneControls, synth: synthControls }[m.type](m, live),
      group('sends', ...sends.map((x) => x.row)),
    ];
    const card = createCard({
      kind: isSynth ? 'module synth' : 'module',
      iconName: { melodic: 'note', rhythmic: 'drum', drone: 'wave', synth: 'pads' }[m.type],
      title: `${m.name}`,
      nameEditor: nameEditor(m),
      lead: toggle ? [toggle] : [],
      trail: synthOn ? [synthOn.node] : [],
      quick: [el('span', { className: 'card-volume' }, volume.node, panKnob(engine, m))],
      actions: [cloneBtn, exportBtn, remove],
      body: [el('div', { className: 'groups' }, ...controls, ...(rows.length ? [group('pattern view', grid)] : []))],
      detail,
    });
    (isSynth && synthsEl ? synthsEl : modulesEl).append(card.node);
    panels.set(m.id, { card, rows: [...rows, ...live], module: m, toggle, synthOn });
  }

  async function add(factory) {
    await engine.resume();
    const m = factory();
    engine.addModule(m);
    addPanel(m);
  }

  async function addEffect(type) {
    await engine.resume();
    await engine.ready; // the bitcrusher needs its worklet
    try {
      const fx = engine.addEffect(type);
      addFxPanel(fx);
      return fx;
    } catch {
      return null; // an effect this browser cannot build (the menu does not offer it)
    }
  }

  const say = createStatus(statusEl);
  let scenes = null; // the save/load panel, when there is a scene store

  const sceneUi = {
    clear() {
      detail.close();
      for (const m of [...engine.modules]) removeModulePanel(m.id);
      for (const fx of [...engine.effects]) removeFxPanel(fx.id);
      removeSequencePanel();
    },
    addFxPanel,
    addModulePanel: addPanel,
    addSequencePanel,
  };

  setIcon(addBtn, 'plus', 'add');
  setIcon(menuBtn, 'menu', 'menu');
  const addActions = {
    melodic: () => add(createMelodicModule),
    rhythmic: () => add(createRhythmicModule),
    drone: () => add(createDroneModule),
    synth: () => add(createSynthModule),
    sequence: () => {
      let seq;
      try {
        seq = engine.addSequence({});
      } catch {
        return; // there is one already
      }
      addSequencePanel(seq);
    },
    import: () => {
      engine.resume().catch(() => {}); // here is the user's gesture; after the file picker there may be none (iOS)
      moduleInput.click();
    },
  };
  createMenu({
    button: addBtn,
    panel: addMenuEl,
    render(panel) {
      panel.classList.add('menu-grid');
      let group = null;
      for (const item of addMenuItems({ hasWorklet: engine.hasWorklet(), hasSequence: !!engine.sequence })) {
        const run = item.id.startsWith('fx:') ? () => addEffect(item.id.slice(3)) : addActions[item.id];
        if (group !== null && item.group !== group) panel.append(el('div', { className: 'menu-sep', role: 'separator' }));
        group = item.group;
        panel.append(menuItem({ icon: item.icon, label: item.label, onSelect: run, tile: item.tile }));
      }
    },
  });

  let newTimer = null;
  createMenu({
    button: menuBtn,
    panel: mainMenuEl,
    render(panel, close) {
      clearTimeout(newTimer);
      let armed = false;
      const isEmpty = () => !engine.modules.length && !engine.effects.length && !engine.sequence;
      const newItem = menuItem({
        icon: 'new',
        label: 'new scene',
        keepOpen: true,
        onSelect() {
          if (isEmpty()) return close();
          if (!armed) { // a second tap confirms: this empties the whole scene
            armed = true;
            setIcon(newItem, 'check');
            newItem.querySelector('span').textContent = 'sure? tap again';
            newTimer = setTimeout(() => {
              armed = false;
              setIcon(newItem, 'new');
              newItem.querySelector('span').textContent = 'new scene';
            }, 5000);
            return undefined;
          }
          clearTimeout(newTimer);
          sceneUi.clear();
          engine.setTempo(DEFAULT_TEMPO);
          return close();
        },
      });
      panel.append(newItem);
      if (scenes) {
        panel.append(menuItem({ icon: 'load', label: 'load', onSelect: () => scenes.openLoad() }));
        panel.append(menuItem({ icon: 'save', label: 'save', onSelect: () => scenes.openSave() }));
      }
      if (accent) {
        const swatches = el('div', { className: 'swatches' });
        const paint = () => swatches.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === accent.get())));
        for (const a of ACCENTS) {
          const b = el('button', { type: 'button', className: 'swatch', title: a.name });
          b.dataset.id = a.id;
          b.setAttribute('aria-label', a.name);
          b.style.background = deriveTheme(a.hue, a.mono)['--accent'];
          b.onclick = () => {
            accent.set(a.id);
            paint();
          };
          swatches.append(b);
        }
        paint();
        const themeItem = menuItem({
          icon: 'theme',
          label: 'theme',
          keepOpen: true,
          onSelect: () => (swatches.isConnected ? swatches.remove() : themeItem.after(swatches)), // stays open, so colours can be tried
        });
        panel.append(themeItem);
      }
    },
  });

  // Importing module files: each file becomes a new module (its sends stay empty, effects are not part of a module file).
  const moduleInput = el('input', { type: 'file', accept: '.json,application/json', multiple: true, hidden: true });
  async function importModules(files) {
    let added = 0;
    let skipped = 0;
    const reasons = [];
    const skip = (file, why) => {
      skipped++;
      reasons.push(`${file.name}: ${why}`);
    };
    for (const file of files) {
      if (engine.modules.length >= MAX_MODULES) { skip(file, `there are already ${MAX_MODULES} modules`); continue; }
      if (file.size > MAX_FILE_BYTES) { skip(file, 'file is larger than 1 MB'); continue; } // before reading it
      let text;
      try {
        text = await file.text();
      } catch {
        skip(file, 'could not be read');
        continue;
      }
      const { entries, problems } = parseModuleFile(text);
      if (!entries.length) { skip(file, problems[0] ?? 'nothing usable'); continue; }
      try {
        addPanel(addModuleFromData(engine, entries[0]));
        added++;
      } catch {
        skip(file, 'could not be added');
      }
    }
    say(`imported ${added}${skipped ? `, skipped ${skipped}: ${reasons.slice(0, 3).join('; ')}` : ''}`);
  }
  moduleInput.onchange = () => {
    const files = [...moduleInput.files];
    moduleInput.value = ''; // the same file can be picked again
    if (files.length) importModules(files);
  };
  document.body.append(moduleInput);

  // Offer [play all] whenever nothing is actually running (or the transport was stopped).
  const showsPlay = () => engine.isStopped() || (engine.hasModules() && !engine.anyRunning());
  const global = iconButton('play', { label: 'play all', className: 'play' });
  const togglePlay = async () => {
    await engine.resume();
    if (showsPlay()) engine.playAll(); else engine.stopAll();
  };
  global.onclick = togglePlay;
  const tempoToggle = iconButton('metronome', { label: 'global bpm' });
  tempoToggle.onclick = () => engine.setTempo({ on: !engine.tempo.on });
  const tempoSlider = createSlider({
    min: TEMPO_MIN, max: TEMPO_MAX, step: 1, nudge: 1, format: String, ariaLabel: 'global bpm', value: engine.tempo.bpm,
    onInput: (v) => {
      engine.setTempo({ bpm: v });
      tempoSlider.set(engine.tempo.bpm);
    },
  });
  transportEl.append(global, tempoToggle, tempoSlider.node);
  let tempoSig = '';
  document.addEventListener('keydown', (e) => {
    if (!shouldHandleSpace(e)) return;
    e.preventDefault(); // the page must not scroll
    togglePlay();
  });

  function frame() {
    const play = showsPlay();
    if (global.dataset.state !== String(play)) {
      global.dataset.state = String(play);
      setIcon(global, play ? 'play' : 'stop', play ? 'play all' : 'stop all');
    }
    const t = engine.tempo;
    const tSig = `${t.on}:${t.bpm}:${panels.size}`;
    if (tSig !== tempoSig) { // a scene load or a new module can change what the tempo controls show
      tempoSig = tSig;
      tempoToggle.setAttribute('aria-pressed', String(t.on));
      tempoSlider.set(t.bpm);
      transportEl.classList.toggle('tempo-on', t.on);
      document.body.classList.toggle('tempo-on', t.on);
      for (const r of document.querySelectorAll('.bpm-row')) {
        if (t.on) r.title = 'global BPM is on'; else r.removeAttribute('title');
      }
    }
    const sig = engine.effects.map((fx) => `${fx.id}:${fx.name}`).join();
    if (sig !== effectsSig) {
      effectsSig = sig;
      for (const fills of sendFills.values()) fills.forEach((f) => f());
    }
    for (const { card, fx, bypass, pedal } of fxCards.values()) {
      card.setTitle(fx.name);
      bypass.set(fx.enabled);
      card.node.classList.toggle('stopped', !fx.enabled);
      pedal.setEnabled(fx.enabled);
    }
    for (const { card, rows, module, toggle, synthOn } of panels.values()) {
      card.setTitle(`${module.name}`);
      const state = module.running ? 'running' : 'stopped';
      if (toggle || synthOn) card.node.classList.toggle('stopped', !module.running);
      if (synthOn) synthOn.set(module.running);
      if (toggle && toggle.dataset.state !== state) {
        toggle.dataset.state = state;
        setIcon(toggle, module.running ? 'stop' : 'play', module.running ? 'stop' : 'start');
      }
      if (card.node.classList.contains('open')) rows.forEach((r) => r.update(module.playhead));
    }
    sequenceUi?.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (scenePanelEl && store) scenes = mountScenes({ engine, store, sceneUi, panelEl: scenePanelEl, say, titleEl: document.getElementById('scene-title') });
}
