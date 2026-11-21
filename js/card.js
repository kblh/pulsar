import { iconButton } from './icons.js';

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/**
 * One module or effect: a single node that is a small card until `detail.open(card)` makes it fill the screen.
 * The header is always visible; `lead` comes before the title, `quick` after it. The rename field, `actions`
 * and the close button show only in the detail, the `body` too.
 */
export function createCard({ kind, title, nameEditor, lead = [], quick = [], actions = [], body = [], detail }) {
  // A real button, so the keyboard can open the card; clicking elsewhere on the card works too.
  const name = el('button', { className: 'card-name', type: 'button', textContent: title });
  name.setAttribute('aria-expanded', 'false');
  const closeBtn = iconButton('close', { label: 'close', className: 'card-close' });
  const head = el('div', { className: 'card-head' },
    ...lead,
    el('span', { className: 'card-title' }, name, el('span', { className: 'card-name-edit' }, nameEditor)),
    ...quick,
    el('span', { className: 'card-actions' }, ...actions, closeBtn));
  const node = el('section', { className: `card ${kind}` }, head, el('div', { className: 'card-body' }, ...body));
  const card = {
    node,
    setTitle(text) {
      if (name.textContent !== text) name.textContent = text;
    },
    /** Called by the detail controller: keep ARIA right and move focus in and back out. */
    setOpen(open) {
      name.setAttribute('aria-expanded', String(open));
      if (open) {
        node.setAttribute('role', 'dialog');
        node.setAttribute('aria-modal', 'true');
        node.setAttribute('aria-label', name.textContent);
        closeBtn.focus();
      } else {
        node.removeAttribute('role');
        node.removeAttribute('aria-modal');
        node.removeAttribute('aria-label');
        const active = document.activeElement;
        // Give focus back unless the user has moved on to something outside this card.
        if (!active || active === document.body || node.contains(active)) name.focus();
      }
    },
  };
  name.addEventListener('click', () => detail.open(card));
  node.addEventListener('click', (e) => {
    if (node.classList.contains('open')) return;
    if (e.target.closest('button, input, select, label, a, [role=slider]')) return;
    detail.open(card);
  });
  closeBtn.addEventListener('click', () => detail.close());
  return card;
}
