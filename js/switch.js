function el(tag, props = {}) {
  return Object.assign(document.createElement(tag), props);
}

/**
 * An on/off switch like the footswitch of a guitar pedal, drawn as a circle: filled when on, empty when off. It is a
 * `role="switch"` button. `onToggle()` is called on a press; the caller flips its state and shows it with `set(on)`.
 */
export function createSwitch({ label, on = false, large = false, onToggle }) {
  const node = el('button', { type: 'button', className: large ? 'switch switch-large' : 'switch' });
  node.setAttribute('role', 'switch');
  node.setAttribute('aria-label', label);
  const set = (value) => {
    const v = String(Boolean(value));
    if (node.getAttribute('aria-checked') !== v) node.setAttribute('aria-checked', v);
  };
  node.addEventListener('click', () => onToggle?.());
  set(on);
  return { node, set };
}
