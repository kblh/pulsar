import { SCALES } from './scales.js';
import { WAVES, ROOTS } from './options.js';
import { cleanName, NAME_MAX, serializeModule, addModuleFromData, MAX_MODULES } from './scene.js';
import { mountScenes, defaultDownload } from './scenes-ui.js';
import { addMenuItems, menuItem, createMenu, createStatus } from './menu.js';
import { shouldHandleSpace } from './keys.js';
import { MAX_FILE_BYTES } from './scene-file.js';
import { moduleFilename, moduleToFile, parseModuleFile } from './module-file.js';
import { createCard } from './card.js';
import { iconButton, setIcon } from './icons.js';
import { createSlider, createSegmented } from './controls.js';
import { createEnvelopeEditor } from './envelope.js';
import { splitRoot, joinRoot, formatCents } from './hud.js';
import { FX_FIELDS } from './fx-fields.js';
import { mountSequenceCard } from './sequence-ui.js';
import { createDetail } from './detail.js';
import { createMelodicModule, createRhythmicModule, createDroneModule } from './module.js';


function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function row(label, ...controls) {
  return el('div', { className: 'row' }, el('label', { textContent: label }), ...controls);
}

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

/** A slider row for `m.params[key]`; it shows what the module accepted and never writes on first paint. */
function paramSlider(label, m, key, { min, max, step, format = String, nudge = step, scale }) {
  const s = createSlider({
    min, max, step, scale, format, nudge, ariaLabel: label, value: m.params[key],
    onInput: (v) => {
      m.setParam(key, v);
      s.set(m.params[key]);
    },
  });
  return row(label, s.node);
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

function pitchRows(m) {
  const cfg = () => ({ ...m.params.pitchConfig });
  const setCfg = (k) => (v) => m.setParam('pitchConfig', { ...cfg(), notes: cfg().notes ?? 'C4 E4 G4 A4', [k]: k === 'octaves' ? Number(v) : v });
  const c = m.params.pitchConfig;
  const octaves = createSlider({
    min: 1, max: 4, step: 1, format: String, nudge: 1, ariaLabel: 'octaves', value: c.octaves ?? 2,
    onInput: (v) => {
      setCfg('octaves')(v);
      octaves.set(m.params.pitchConfig.octaves ?? 2);
    },
  });
  return [
    row('pitch', seg(['scale', 'notes'], c.mode, 'pitch mode', setCfg('mode'))),
    row('root', select(ROOTS, c.root ?? 'C', setCfg('root')), select(Object.keys(SCALES), c.scale ?? 'pentatonicMinor', setCfg('scale'))),
    row('octaves', octaves.node),
    row('notes', text(c.notes ?? 'C4 E4 G4 A4', setCfg('notes'))),
  ];
}

function melodicControls(m) {
  const set = (k) => (v) => m.setParam(k, v);
  const envelope = createEnvelopeEditor({
    env: m.params.env,
    onChange: (partial) => {
      m.setParam('env', partial);
      envelope.set(m.params.env); // the module's accepted values
    },
  });
  return [
    row('osc', seg(waveOptions, m.params.wave, 'osc', set('wave'))),
    row('osc 2', seg(waveOptions, m.params.wave2, 'osc 2', set('wave2'))),
    paramSlider('mix', m, 'mix', { min: 0, max: 1, step: 0.05, format: pct }),
    paramSlider('detune', m, 'detune', { min: -50, max: 50, step: 1, format: formatCents }),
    row('envelope', envelope.node),
    paramSlider('bpm', m, 'bpm', { min: 20, max: 300, step: 1 }),
    paramSlider('swing', m, 'swing', { min: 0, max: 1, step: 0.05, format: pct }),
    ...pitchRows(m),
    row('rhythm', text(m.params.rhythm, set('rhythm'))),
    paramSlider('randomize', m, 'randomize', { min: 1, max: 10, step: 1 }),
    paramSlider('rhythm mod', m, 'rhythmMod', { min: 1, max: 10, step: 1 }),
    row('evolution', seg(['drift', 'walk'], m.params.evolution, 'evolution', set('evolution'))),
  ];
}

function mixRows(engine, m) {
  const panText = (v) => (Math.abs(v) < 0.05 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`);
  const pan = createSlider({
    min: -1, max: 1, step: 0.05, format: panText, nudge: 0.05, ariaLabel: 'pan', value: m.pan ?? 0,
    onInput: (v) => {
      engine.setPan(m, v);
      pan.set(m.pan);
    },
  });
  return [row('pan', pan.node)];
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

/** One send slot: a target select (rebuilt by fill() when effects come and go) and a level slider. */
function sendRow(engine, m, slot) {
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
  const level = createSlider({
    min: 0, max: 1, step: 0.01, format: pct, nudge: 0.05, ariaLabel: `send ${slot + 1} level`, value: m.sends[slot].level,
    onInput: (v) => {
      engine.setSend(m, slot, { level: v });
      level.set(m.sends[slot].level);
    },
  });
  return { row: row(`send ${slot + 1}`, sel, level.node), fill };
}

function fxControls(engine, fx) {
  return FX_FIELDS[fx.type].map(({ key, min, max, step, scale, format }) => {
    // The slider shows the value the effect actually accepted.
    const s = createSlider({
      min, max, step, scale, format, nudge: step, ariaLabel: key, value: fx.params[key],
      onInput: (v) => {
        engine.setFxParam(fx, key, v);
        s.set(fx.params[key]);
      },
    });
    return row(key, s.node);
  });
}

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const midiName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/** The drone's base tone: a tone select and an octave slider. Both show what the module accepted. */
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
  const octave = createSlider({
    min: 0, max: 6, step: 1, format: String, nudge: 1, ariaLabel: 'octave', value: cur().octave,
    onInput: (o) => apply(tone.value, o),
  });
  return row('base', tone, octave.node);
}

function droneControls(m) {
  const set = (k) => (v) => m.setParam(k, v);
  return [
    row('osc', seg(waveOptions, m.params.wave, 'osc', set('wave'))),
    row('osc 2', seg(waveOptions, m.params.wave2, 'osc 2', set('wave2'))),
    paramSlider('mix', m, 'mix', { min: 0, max: 1, step: 0.05, format: pct }),
    paramSlider('detune', m, 'detune', { min: -50, max: 50, step: 1, format: formatCents }),
    rootPicker(m),
    ...pitchRows(m),
    paramSlider('max extra', m, 'maxExtra', { min: 0, max: 6, step: 1 }),
    paramSlider('rate', m, 'rate', { min: 1, max: 10, step: 1 }),
    paramSlider('fade s', m, 'fade', { min: 0.5, max: 30, step: 0.5, format: (v) => `${v} s` }),
  ];
}

/** A one-line status row for modules without a step grid. */
function statusRow(name, getText) {
  const value = el('span', { textContent: '' });
  const line = el('div', { className: 'line' }, el('span', { className: 'name', textContent: name }), value);
  return { node: line, update: () => { value.textContent = getText(); } };
}

function rhythmicControls(m) {
  const set = (k) => (v) => m.setParam(k, v);
  return [
    paramSlider('bpm', m, 'bpm', { min: 20, max: 300, step: 1 }),
    paramSlider('swing', m, 'swing', { min: 0, max: 1, step: 0.05, format: pct }),
    row('kick', text(m.params.voices.kick, set('voice:kick'))),
    row('snare', text(m.params.voices.snare, set('voice:snare'))),
    row('hat', text(m.params.voices.hat, set('voice:hat'))),
    paramSlider('rhythm mod', m, 'rhythmMod', { min: 1, max: 10, step: 1 }),
    row('evolution', seg(['drift', 'walk'], m.params.evolution, 'evolution', set('evolution'))),
  ];
}

export function mountUi({ engine, effectsEl, modulesEl, sequenceEl, addBtn, addMenuEl, menuBtn, mainMenuEl, statusEl, transportEl, scenePanelEl, store }) {
  const panels = new Map(); // module id -> { card, rows, module, toggle }
  const fxCards = new Map(); // effect id -> { card, fx, bypass, controls }
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
    const bypass = el('input', { type: 'checkbox', checked: fx.enabled, title: 'on / bypass' });
    bypass.setAttribute('aria-label', 'effect on');
    bypass.onchange = () => engine.setFxEnabled(fx, bypass.checked);
    const remove = iconButton('trash', { label: 'remove effect', onClick: () => removeFxPanel(fx.id) });
    const controls = el('div', { className: 'fx-controls' }, ...fxControls(engine, fx));
    const card = createCard({
      kind: 'effect',
      title: `${fx.id} ${fx.name}`,
      nameEditor: el('span', {}, `${fx.id} `, nameEditor(fx)),
      lead: [el('label', { className: 'check' }, bypass)],
      actions: [remove],
      body: [controls],
      detail,
    });
    fxCards.set(fx.id, { card, fx, bypass, controls });
    effectsEl.append(card.node);
  }

  function addPanel(m) {
    const toggle = iconButton('play', { label: 'start', className: 'play', onClick: () => engine.toggle(m) });
    const remove = iconButton('trash', { label: 'remove module', onClick: () => removeModulePanel(m.id) });
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
    volume.node.classList.add('card-volume');

    let rows;
    if (m.type === 'drone') {
      rows = [
        statusRow('now', () =>
          [...m.state.sounding().map(midiName), ...m.state.releasing().map((n) => `${midiName(n)}↓`)].join(' + '),
        ),
      ];
    } else if (m.type === 'melodic') {
      rows = [
        gridRow('rhythm', () => m.state.rhythm.current),
        gridRow('pitch', () => m.state.rhythm.current, () => m.state.melody.current),
      ];
    } else {
      rows = ['kick', 'snare', 'hat'].map((d) => gridRow(d, () => m.state.voices[d].current));
    }
    const grid = el('div', { className: 'grid' }, ...rows.map((r) => r.node));
    const sends = [0, 1, 2].map((slot) => sendRow(engine, m, slot));
    sendFills.set(m.id, sends.map((x) => x.fill));
    const controls = [
      ...{ melodic: melodicControls, rhythmic: rhythmicControls, drone: droneControls }[m.type](m),
      ...mixRows(engine, m),
      ...sends.map((x) => x.row),
    ];
    const card = createCard({
      kind: 'module',
      title: `#${m.id} ${m.name}`,
      nameEditor: el('span', {}, `#${m.id} `, nameEditor(m)),
      lead: [toggle],
      quick: [volume.node],
      actions: [exportBtn, remove],
      body: [...controls, grid],
      detail,
    });
    modulesEl.append(card.node);
    panels.set(m.id, { card, rows, module: m, toggle });
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
      addFxPanel(engine.addEffect(type));
    } catch {
      /* an effect this browser cannot build (the menu does not offer it) */
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
      for (const item of addMenuItems({ hasWorklet: engine.hasWorklet(), hasSequence: !!engine.sequence })) {
        const run = item.id.startsWith('fx:') ? () => addEffect(item.id.slice(3)) : addActions[item.id];
        panel.append(menuItem({ icon: item.icon, label: item.label, onSelect: run }));
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
          return close();
        },
      });
      panel.append(newItem);
      if (scenes) {
        panel.append(menuItem({ icon: 'load', label: 'load', onSelect: () => scenes.openLoad() }));
        panel.append(menuItem({ icon: 'save', label: 'save', onSelect: () => scenes.openSave() }));
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
  transportEl.append(global);
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
    const sig = engine.effects.map((fx) => `${fx.id}:${fx.name}`).join();
    if (sig !== effectsSig) {
      effectsSig = sig;
      for (const fills of sendFills.values()) fills.forEach((f) => f());
    }
    for (const { card, fx, bypass, controls } of fxCards.values()) {
      card.setTitle(`${fx.id} ${fx.name}`);
      bypass.checked = fx.enabled;
      controls.classList.toggle('bypassed', !fx.enabled);
    }
    for (const { card, rows, module, toggle } of panels.values()) {
      card.setTitle(`#${module.id} ${module.name}`);
      const state = module.running ? 'running' : 'stopped';
      if (toggle.dataset.state !== state) {
        toggle.dataset.state = state;
        setIcon(toggle, module.running ? 'stop' : 'play', module.running ? 'stop' : 'start');
      }
      if (card.node.classList.contains('open')) rows.forEach((r) => r.update(module.playhead));
    }
    sequenceUi?.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (scenePanelEl && store) scenes = mountScenes({ engine, store, sceneUi, panelEl: scenePanelEl, say });
}
