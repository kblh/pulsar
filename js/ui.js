import { SCALES } from './scales.js';
import { createMelodicModule, createRhythmicModule, createDroneModule } from './module.js';

const WAVES = ['sine', 'square', 'sawtooth', 'triangle'];
const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

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

function number(value, min, max, onChange, step = 1) {
  const i = el('input', { type: 'number', value, min, max, step });
  i.onchange = () => onChange(i.value);
  return i;
}

function range(value, min, max, step, show, onChange) {
  const val = el('span', { className: 'val', textContent: show(value) });
  const i = el('input', { type: 'range', value, min, max, step });
  i.oninput = () => {
    val.textContent = show(i.value);
    onChange(i.value);
  };
  return [i, val];
}

function text(value, onChange) {
  const i = el('input', { type: 'text', value, spellcheck: false });
  i.onchange = () => onChange(i.value);
  return i;
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
  return [
    row('pitch', select(['scale', 'notes'], c.mode, setCfg('mode'))),
    row('root', select(ROOTS, c.root ?? 'C', setCfg('root')), select(Object.keys(SCALES), c.scale ?? 'pentatonicMinor', setCfg('scale'))),
    row('octaves', number(c.octaves ?? 2, 1, 4, setCfg('octaves'))),
    row('notes', text(c.notes ?? 'C4 E4 G4 A4', setCfg('notes'))),
  ];
}

function melodicControls(m) {
  const set = (k) => (v) => m.setParam(k, v);
  const env = (k) => number(m.params.env[k], 0, k === 's' ? 1 : 5, (v) => {
    const n = Number(v);
    if (Number.isFinite(n)) m.params.env = { ...m.params.env, [k]: Math.max(0, n) };
  }, k === 's' ? 0.05 : 0.01);
  return [
    row('osc', select(WAVES, m.params.wave, set('wave'))),
    row('adsr', env('a'), env('d'), env('s'), env('r')),
    row('bpm', number(m.params.bpm, 20, 300, set('bpm'))),
    row('swing', ...range(m.params.swing, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, set('swing'))),
    ...pitchRows(m),
    row('rhythm', text(m.params.rhythm, set('rhythm'))),
    row('randomize', ...range(m.params.randomize, 1, 10, 1, String, set('randomize'))),
    row('rhythm mod', ...range(m.params.rhythmMod, 1, 10, 1, String, set('rhythmMod'))),
    row('evolution', select(['drift', 'walk'], m.params.evolution, set('evolution'))),
  ];
}

function mixRows(engine, m) {
  const panText = (v) => (Math.abs(v) < 0.05 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`);
  return [
    row('volume', ...range(m.volume ?? 1, 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => engine.setVolume(m, v))),
    row('pan', ...range(m.pan ?? 0, -1, 1, 0.05, panText, (v) => engine.setPan(m, v))),
  ];
}

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const midiName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

function droneControls(m) {
  const set = (k) => (v) => m.setParam(k, v);
  return [
    row('osc', select(WAVES, m.params.wave, set('wave'))),
    row('base', text(m.params.rootNote, set('rootNote'))),
    ...pitchRows(m),
    row('max extra', number(m.params.maxExtra, 0, 6, set('maxExtra'))),
    row('rate', ...range(m.params.rate, 1, 10, 1, String, set('rate'))),
    row('fade s', number(m.params.fade, 0.5, 30, set('fade'), 0.5)),
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
    row('bpm', number(m.params.bpm, 20, 300, set('bpm'))),
    row('swing', ...range(m.params.swing, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, set('swing'))),
    row('kick', text(m.params.voices.kick, set('voice:kick'))),
    row('snare', text(m.params.voices.snare, set('voice:snare'))),
    row('hat', text(m.params.voices.hat, set('voice:hat'))),
    row('rhythm mod', ...range(m.params.rhythmMod, 1, 10, 1, String, set('rhythmMod'))),
    row('evolution', select(['drift', 'walk'], m.params.evolution, set('evolution'))),
  ];
}

export function mountUi({ engine, modulesEl, adderEl, transportEl }) {
  const panels = new Map();

  function addPanel(m) {
    const toggle = el('button', { textContent: '[stop]' });
    toggle.onclick = () => engine.toggle(m);
    const remove = el('button', { textContent: '[x]' });
    remove.onclick = () => {
      engine.removeModule(m.id);
      panels.get(m.id).node.remove();
      panels.delete(m.id);
    };

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
    const controls = [
      ...{ melodic: melodicControls, rhythmic: rhythmicControls, drone: droneControls }[m.type](m),
      ...mixRows(engine, m),
    ];
    const node = el(
      'section',
      { className: 'panel' },
      el('h2', {}, `#${m.id} ${m.type}`, el('span', { className: 'spacer' }), toggle, remove),
      ...controls,
      grid,
    );
    modulesEl.append(node);
    panels.set(m.id, { node, rows, module: m, toggle });
  }

  async function add(factory) {
    await engine.resume();
    const m = factory();
    engine.addModule(m);
    addPanel(m);
  }

  const menu = el('span', { className: 'muted' });
  const plus = el('button', { textContent: '[+]' });
  const showMenu = (open) => {
    menu.replaceChildren();
    if (!open) return;
    const choose = (factory) => () => {
      showMenu(false);
      add(factory);
    };
    const b1 = el('button', { textContent: '[melodic]' });
    const b2 = el('button', { textContent: '[rhythmic]' });
    const b3 = el('button', { textContent: '[drone]' });
    b1.onclick = choose(createMelodicModule);
    b2.onclick = choose(createRhythmicModule);
    b3.onclick = choose(createDroneModule);
    menu.append(' ', b1, ' ', b2, ' ', b3);
  };
  plus.onclick = () => showMenu(menu.childElementCount === 0);
  adderEl.append(plus, menu);

  // Offer [play all] whenever nothing is actually running (or the transport was stopped).
  const showsPlay = () => engine.isStopped() || (engine.hasModules() && !engine.anyRunning());
  const global = el('button', { textContent: '[stop all]' });
  global.onclick = async () => {
    await engine.resume();
    if (showsPlay()) engine.playAll(); else engine.stopAll();
  };
  transportEl.append(global);

  function frame() {
    global.textContent = showsPlay() ? '[play all]' : '[stop all]';
    for (const { rows, module, toggle } of panels.values()) {
      toggle.textContent = module.running ? '[stop]' : '[start]';
      rows.forEach((r) => r.update(module.playhead));
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
