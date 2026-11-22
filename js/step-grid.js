const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/**
 * 16 pads in a 4 x 4 grid (step 1 top left). A click calls `onToggle(i)`; a touch that turns into a scroll sends no click.
 * `set(pattern)` shows the steps and `setPlayhead(i)` marks the current one, neither calls `onToggle`.
 * Both only touch a pad whose state changed, so they are cheap to call every frame.
 */
export function createStepGrid({ ariaLabel, onToggle }) {
  const node = el('div', { className: 'pads' });
  node.setAttribute('role', 'group');
  if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
  const pads = Array.from({ length: 16 }, (_, i) => {
    const b = el('button', { type: 'button', className: 'pad' });
    b.setAttribute('aria-label', `step ${i + 1}`);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onToggle?.(i));
    return b;
  });
  node.append(...pads);
  const on = Array(16).fill(false);
  let now = -1;
  return {
    node,
    set(pattern) {
      pads.forEach((b, i) => {
        const v = Boolean(pattern[i]);
        if (v === on[i]) return;
        on[i] = v;
        b.setAttribute('aria-pressed', String(v));
      });
    },
    setPlayhead(i) {
      if (i === now) return;
      pads[now]?.classList.remove('now');
      now = i;
      pads[now]?.classList.add('now');
    },
  };
}
