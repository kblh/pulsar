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
  const name = el('span', { className: 'card-name', textContent: title });
  const closeBtn = el('button', { className: 'card-close', type: 'button', textContent: '×', title: 'close' });
  closeBtn.setAttribute('aria-label', 'close');
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
  };
  node.addEventListener('click', (e) => {
    if (node.classList.contains('open')) return;
    if (e.target.closest('button, input, select, label, a')) return;
    detail.open(card);
  });
  closeBtn.addEventListener('click', () => detail.close());
  return card;
}
