import { icon } from './icons.js';
import { FX_TYPES, FX_NEEDS_WORKLET } from './fx.js';
import { FX_LABELS } from './fx-fields.js';

/**
 * What the `+` menu offers right now. Pure: the caller decides what each id does. `tile` items are shown three to a row,
 * icon above the label; the rest take a whole row. `group` tells where a divider goes.
 */
export function addMenuItems({ hasWorklet, hasSequence }) {
  const items = [
    { id: 'melodic', icon: 'note', label: 'melodic', group: 'modules', tile: true },
    { id: 'rhythmic', icon: 'drum', label: 'rhythmic', group: 'modules', tile: true },
    { id: 'drone', icon: 'wave', label: 'drone', group: 'modules', tile: true },
    { id: 'synth', icon: 'pads', label: 'synth', group: 'synth' },
  ];
  for (const type of FX_TYPES) {
    if (FX_NEEDS_WORKLET.includes(type) && !hasWorklet) continue;
    items.push({ id: `fx:${type}`, icon: 'fx', label: FX_LABELS[type] ?? type, group: 'fx', tile: true });
  }
  if (!hasSequence) items.push({ id: 'sequence', icon: 'list', label: 'sequence', group: 'sequence' });
  items.push({ id: 'import', icon: 'import', label: 'import module', group: 'import' });
  return items;
}

/** A menu row: icon and visible label. Selecting it closes the menu unless `keepOpen`. */
export function menuItem({ icon: iconName, label, onSelect, disabled = false, keepOpen = false, tile = false }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = tile ? 'menu-item menu-tile' : 'menu-item';
  b.setAttribute('role', 'menuitem');
  const text = document.createElement('span');
  text.textContent = label;
  b.append(icon(iconName), text);
  b.disabled = disabled;
  if (keepOpen) b.dataset.keepOpen = '1';
  b.onclick = () => onSelect?.();
  return b;
}

let openMenu = null; // one menu at a time

/**
 * A popover opened by `button`. `render(panel, close)` fills the panel each time it opens, so the items are always current.
 * Closes on a press outside, on Escape (which then does nothing else) and after choosing an item.
 */
export function createMenu({ button, panel, render }) {
  let isOpen = false;
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  panel.hidden = true;

  const onPointerDown = (e) => {
    if (!panel.contains(e.target) && !button.contains(e.target)) api.close({ refocus: false });
  };
  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); // a detail or a field underneath must not also react to this Escape
    api.close();
  };

  const api = {
    isOpen: () => isOpen,
    open() {
      if (isOpen) return;
      if (openMenu && openMenu !== api) openMenu.close({ refocus: false });
      panel.replaceChildren();
      render(panel, () => api.close());
      panel.hidden = false;
      isOpen = true;
      openMenu = api;
      button.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('keydown', onKeyDown, true);
    },
    close({ refocus = true } = {}) {
      if (!isOpen) return;
      isOpen = false;
      if (openMenu === api) openMenu = null;
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      if (refocus) button.focus();
    },
  };

  button.addEventListener('click', () => (isOpen ? api.close() : api.open()));
  panel.addEventListener('click', (e) => {
    const item = e.target.closest('[role=menuitem]');
    if (!item || item.disabled || item.dataset.keepOpen) return;
    const a = document.activeElement;
    api.close({ refocus: !a || a === document.body || panel.contains(a) }); // an item may have moved focus on purpose
  });
  return api;
}

/** A status line: `say(text)` shows a message for 5 seconds. */
export function createStatus(node) {
  let timer = null;
  node.setAttribute('aria-live', 'polite');
  return (text) => {
    node.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => { node.textContent = ''; }, 5000);
  };
}
