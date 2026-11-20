const MARK = { pulsarDetail: true };

/**
 * Which card is open as a full-screen detail. One at a time; Esc, the Back button and close() all end it.
 * State changes at once, the visible change runs through `transition` (a View Transition in the app).
 * `win` gives history + popstate, `doc` gives body + keydown.
 */
export function createDetail({ win, doc, transition = (fn) => { fn(); } }) {
  let cur = null;
  let ownBacks = 0; // history.back() calls of ours whose popstate has not arrived yet

  function run(card, change) {
    card.node.style.viewTransitionName = 'card';
    const clear = () => { card.node.style.viewTransitionName = ''; };
    const t = transition(change);
    if (t?.finished?.then) t.finished.then(clear, clear);
    else clear();
  }

  const hide = (card) => run(card, () => {
    card.node.classList.remove('open');
    doc.body.classList.remove('detail-open');
  });

  win.addEventListener('popstate', () => {
    if (ownBacks > 0) {
      ownBacks--;
      return;
    }
    if (!cur) return;
    const card = cur;
    cur = null;
    hide(card);
  });
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.close();
  });

  const api = {
    current: () => cur,
    open(card) {
      if (cur === card) return;
      const prev = cur;
      cur = card;
      if (prev) win.history.replaceState(MARK, '');
      else win.history.pushState(MARK, '');
      run(card, () => {
        prev?.node.classList.remove('open');
        card.node.classList.add('open');
        doc.body.classList.add('detail-open');
      });
    },
    close() {
      if (!cur) return;
      const card = cur;
      cur = null;
      hide(card);
      if (win.history.state?.pulsarDetail) {
        ownBacks++;
        win.history.back();
      }
    },
  };
  return api;
}
