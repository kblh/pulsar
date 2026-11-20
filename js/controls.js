import { snap, toFraction, fromFraction } from './hud.js';

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const LOG_POSITIONS = 200; // a log slider moves in this many equal steps, so one key press is one step on the bar

/**
 * A HUD bar with a transparent native range input on top: the browser handles dragging, keys and
 * accessibility, the drawn bar is only the look. `set` shows a value without calling `onInput`.
 * `nudge` is a step size for the − / + buttons, or false for none.
 */
export function createSlider({ min, max, step, value, scale = 'linear', format, onInput, ariaLabel, nudge = false }) {
  const opts = { min, max, step, scale };
  const log = scale === 'log';
  let cur = snap(value, opts);

  const fill = el('div', { className: 'hud-fill' });
  const bar = el('div', { className: 'hud-bar' }, fill);
  const input = el('input', { type: 'range', className: 'hud-input' });
  if (log) Object.assign(input, { min: 0, max: LOG_POSITIONS, step: 1 });
  else Object.assign(input, { min, max, step });
  if (ariaLabel) input.setAttribute('aria-label', ariaLabel);
  const valueEl = format ? el('span', { className: 'hud-value' }) : null;

  function render() {
    fill.style.setProperty('--p', String(toFraction(cur, opts) * 100));
    input.value = String(log ? Math.round(toFraction(cur, opts) * LOG_POSITIONS) : cur);
    if (format) {
      const text = format(cur);
      valueEl.textContent = text;
      input.setAttribute('aria-valuetext', text);
    }
  }

  function change(next) {
    if (next === cur) return;
    cur = next;
    render();
    onInput?.(cur);
  }

  input.addEventListener('input', () => {
    change(log ? fromFraction(Number(input.value) / LOG_POSITIONS, opts) : snap(input.value, opts));
  });

  if (log) {
    // The input moves in index space but values snap to `step`, so near the low end many indexes are the
    // same value and a key would look dead. Keys therefore move the value: 5 % of it, never less than `step`.
    const KEYS = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        change(e.key === 'Home' ? min : max);
      } else if (e.key in KEYS) {
        e.preventDefault();
        const dir = Math.sign(KEYS[e.key]);
        const size = Math.max(step, cur * 0.05) * Math.abs(KEYS[e.key]);
        change(snap(cur + dir * size, opts));
      }
    });
  }

  const mkNudge = (dir) => {
    const b = el('button', { type: 'button', className: 'nudge', textContent: dir < 0 ? '−' : '+' });
    b.setAttribute('aria-label', `${ariaLabel ?? 'value'} ${dir < 0 ? 'down' : 'up'}`);
    b.addEventListener('click', () => change(snap(cur + dir * (typeof nudge === 'number' ? nudge : step), opts)));
    return b;
  };

  const node = el('div', { className: 'hud-slider' },
    ...(nudge ? [mkNudge(-1)] : []),
    el('div', { className: 'hud-track' }, bar, input),
    ...(valueEl ? [valueEl] : []),
    ...(nudge ? [mkNudge(1)] : []));

  render();
  return {
    node,
    set(v) {
      cur = snap(v, opts);
      render();
    },
  };
}

/** A radio group of buttons. Options are strings or `{ value, label }`. `set` does not call `onChange`. */
export function createSegmented({ options, value, onChange, ariaLabel }) {
  const items = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const node = el('div', { className: 'hud-seg' });
  node.setAttribute('role', 'radiogroup');
  if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
  let cur = value;
  const buttons = items.map((it) => {
    const b = el('button', { type: 'button', textContent: it.label });
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => choose(it.value));
    return b;
  });
  node.append(...buttons);

  function show() {
    buttons.forEach((b, i) => {
      const on = items[i].value === cur;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on || !items.some((x) => x.value === cur) ? 0 : -1;
    });
  }
  function choose(v) {
    if (v === cur) return;
    cur = v;
    show();
    onChange?.(v);
  }
  node.addEventListener('keydown', (e) => {
    const i = items.findIndex((x) => x.value === cur);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = items[(i + d + items.length) % items.length];
    choose(next.value);
    buttons[items.indexOf(next)].focus();
  });

  show();
  return {
    node,
    set(v) {
      cur = v;
      show();
    },
  };
}
