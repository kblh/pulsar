import { snap, toFraction, fromFraction, valueChars, fractionFromX, keyValue, createGesture } from './hud.js';

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/**
 * A HUD bar driven by Pointer Events: the mouse sets the value on press and follows the drag, a finger sets it on a tap
 * or once it drags sideways (a vertical swipe scrolls the page and changes nothing). The track is a `role="slider"` div,
 * so keys and screen readers work. `set` shows a value without calling `onInput`.
 * `nudge` is a step size for the − / + buttons, or false for none.
 */
export function createSlider({ min, max, step, value, scale = 'linear', format, onInput, ariaLabel, nudge = false }) {
  const opts = { min, max, step, scale };
  let cur = snap(value, opts);

  const fill = el('div', { className: 'hud-fill' });
  const bar = el('div', { className: 'hud-bar' }, fill);
  const track = el('div', { className: 'hud-track', tabIndex: 0 }, bar);
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-valuemin', String(min));
  track.setAttribute('aria-valuemax', String(max));
  if (ariaLabel) track.setAttribute('aria-label', ariaLabel);
  const valueEl = format ? el('span', { className: 'hud-value' }) : null;
  if (valueEl) valueEl.style.width = `${valueChars(format, opts)}ch`; // a fixed width: the bar must not move while dragging

  function render() {
    fill.style.setProperty('--p', String(toFraction(cur, opts) * 100));
    track.setAttribute('aria-valuenow', String(cur));
    track.setAttribute('aria-valuetext', format ? format(cur) : String(cur));
    if (format) valueEl.textContent = format(cur);
  }

  function change(next) {
    if (next === cur) return;
    cur = next;
    render();
    onInput?.(cur);
  }

  const apply = (x) => change(fromFraction(fractionFromX(x, track.getBoundingClientRect()), opts));

  let gesture = null;
  let pointerId = null;
  let startValue = cur; // what a touch drag returns to when the browser takes the gesture over for scrolling
  track.addEventListener('pointerdown', (e) => {
    if (gesture?.active) return; // a second finger while one is dragging
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerId = e.pointerId;
    startValue = cur;
    gesture = createGesture({ pointerType: e.pointerType });
    try { track.setPointerCapture(e.pointerId); } catch { /* not an active pointer (synthetic event) */ }
    if (e.pointerType !== 'touch') {
      e.preventDefault();
      track.focus();
    }
    if (gesture.down(e.clientX, e.clientY)) apply(e.clientX);
  });
  track.addEventListener('pointermove', (e) => {
    if (gesture && e.pointerId === pointerId && gesture.move(e.clientX, e.clientY)) apply(e.clientX);
  });
  track.addEventListener('pointerup', (e) => {
    if (gesture && e.pointerId === pointerId && gesture.up(e.clientX)) apply(e.clientX);
  });
  const cancel = (e) => {
    if (gesture && e.pointerId === pointerId) gesture.cancel();
  };
  track.addEventListener('pointercancel', (e) => {
    // a diagonal swipe may have moved the value before the browser decided it was a scroll: put it back
    if (gesture && e.pointerId === pointerId && gesture.cancel() && e.pointerType === 'touch') change(startValue);
  });
  track.addEventListener('lostpointercapture', cancel);

  track.addEventListener('keydown', (e) => {
    const v = keyValue(e.key, cur, opts);
    if (v === null) return;
    e.preventDefault();
    change(v);
  });

  const mkNudge = (dir) => {
    const b = el('button', { type: 'button', className: 'nudge', textContent: dir < 0 ? '−' : '+' });
    b.setAttribute('aria-label', `${ariaLabel ?? 'value'} ${dir < 0 ? 'down' : 'up'}`);
    b.addEventListener('click', () => change(snap(cur + dir * (typeof nudge === 'number' ? nudge : step), opts)));
    return b;
  };

  const node = el('div', { className: 'hud-slider' },
    ...(nudge ? [mkNudge(-1)] : []),
    track,
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
