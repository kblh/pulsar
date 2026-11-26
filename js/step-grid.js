const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/**
 * 16 pads (or up to `max`) in a grid of 4 columns (step 1 top left). A click calls `onToggle(i)`; a touch that turns into a scroll sends no click.
 * `set(pattern)` shows the steps and `setPlayhead(i)` marks the current one, neither calls `onToggle`.
 * Both only touch a pad whose state changed, so they are cheap to call every frame.
 */
export function createStepGrid({ ariaLabel, onToggle, max = 16 }) {
  const node = el('div', { className: 'pads' });
  node.setAttribute('role', 'group');
  if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
  const pads = Array.from({ length: max }, (_, i) => {
    const b = el('button', { type: 'button', className: 'pad' });
    b.setAttribute('aria-label', `step ${i + 1}`);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onToggle?.(i));
    return b;
  });
  node.append(...pads);
  const on = Array(max).fill(false);
  let shown = max;
  let now = -1;
  return {
    node,
    set(pattern) {
      const count = Math.min(max, pattern.length);
      if (count !== shown) {
        shown = count;
        pads.forEach((b, i) => { b.hidden = i >= count; });
      }
      pads.forEach((b, i) => {
        const v = Boolean(pattern[i]);
        if (v === on[i]) return;
        on[i] = v;
        b.setAttribute('aria-pressed', String(v));
      });
    },
    /** Writes a short text on each pad (a note name), '' for none; `levels[i]` (0, 1, 2: the octave) sets how strong the pad is lit. Only a pad that changed is touched. */
    setLabels(labels, levels = []) {
      pads.forEach((b, i) => {
        const t = labels[i] ?? '';
        if (b.textContent !== t) b.textContent = t;
        const l = String(levels[i] ?? 0);
        if (b.dataset.oct !== l) b.dataset.oct = l;
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
