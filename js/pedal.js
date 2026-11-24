import { createKnob } from './knob.js';
import { FX_FIELDS, FX_PEDALS } from './fx-fields.js';
import { FX_DEFAULTS } from './fx.js';

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/**
 * An effect as a guitar pedal: an enclosure in the theme's colours, a knob for every parameter, the silkscreen name,
 * an LED and a footswitch that bypasses the effect. `onToggle()` is called when the footswitch is pressed; the caller
 * flips the effect and then shows the result with `setEnabled`. Knobs show the value the effect actually accepted.
 */
export function createPedal({ fx, setParam, onToggle }) {
  const look = FX_PEDALS[fx.type] ?? { title: fx.type.toUpperCase() };
  const knobs = FX_FIELDS[fx.type].map(({ key, min, max, step, scale, format }) => {
    const knob = createKnob({
      min, max, step, scale, format, label: key, ariaLabel: key, value: fx.params[key], defaultValue: FX_DEFAULTS[fx.type]?.[key],
      onInput: (v) => {
        setParam(key, v);
        knob.set(fx.params[key]);
      },
    });
    return knob;
  });
  const led = el('span', { className: 'pedal-led' });
  const foot = el('button', { type: 'button', className: 'footswitch' });
  foot.setAttribute('aria-label', 'effect on');
  foot.addEventListener('click', () => onToggle());
  const node = el('div', { className: `fx-controls pedal pedal-${fx.type}` },
    el('div', { className: 'pedal-knobs' }, ...knobs.map((k) => k.node)),
    el('div', { className: 'pedal-plate' }, el('span', { className: 'pedal-name', textContent: look.title })),
    el('div', { className: 'pedal-foot' }, led, foot));

  const setEnabled = (on) => {
    node.classList.toggle('bypassed', !on);
    foot.setAttribute('aria-pressed', String(on));
  };
  setEnabled(fx.enabled);
  return { node, setEnabled };
}
