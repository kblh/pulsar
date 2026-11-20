import { createCard } from './card.js';
import { createSlider } from './controls.js';
import { MAX_PARTS, MIN_DURATION, MAX_DURATION } from './sequence.js';

const PLAY = '▶︎'; // text presentation: phones would draw a colour emoji otherwise

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The sequence as a card at the bottom of the page: play/stop and "part N/M · m:ss" while collapsed, the parts editor in the detail.
 * `update()` runs every frame and only touches texts and classes; the editor is rebuilt only after a structural change
 * (a module added or removed), never while a text field is being typed in.
 */
export function mountSequenceCard({ engine, seq, detail, container, nameEditor, onRemove }) {
  const toggle = el('button', { className: 'play', type: 'button' });
  toggle.onclick = async () => {
    await engine.resume();
    const wasRunning = seq.running;
    engine.toggle(seq);
    if (wasRunning) seq.rewind(); // the stop button goes back to the start of the part; stop all only pauses
    else seq.apply(); // play brings the current part to life, also when it resumes mid-part after [stop all]
  };
  const status = el('span', { className: 'seq-status' });
  const bar = el('span', { className: 'seq-bar' });
  const quick = el('span', { className: 'seq-quick' }, status, el('span', { className: 'seq-progress' }, bar));
  const remove = el('button', { textContent: '[remove]', type: 'button' });
  remove.onclick = onRemove;
  const body = el('div', { className: 'seq-body' });
  const card = createCard({
    kind: 'sequence',
    title: seq.name,
    nameEditor: el('span', {}, nameEditor(seq)),
    lead: [toggle],
    quick: [quick],
    actions: [remove],
    body: [body],
    detail,
  });
  container.append(card.node);

  let sig = '';
  let partEls = []; // { node, chips: [button] } per part
  const moduleSig = () => engine.modules.map((m) => m.id).join();

  const btn = (text, label, onClick, extra = '') => {
    const b = el('button', { type: 'button', className: `seq-btn ${extra}`.trim(), textContent: text });
    b.setAttribute('aria-label', label);
    b.onclick = onClick;
    return b;
  };

  function syncChips(i) {
    const members = seq.parts[i]?.modules ?? [];
    for (const chip of partEls[i]?.chips ?? []) chip.setAttribute('aria-pressed', String(members.includes(Number(chip.dataset.id))));
  }

  function renderBody() {
    sig = moduleSig();
    partEls = [];
    const prev = btn('◀', 'previous part', () => seq.prev());
    const next = btn('▶', 'next part', () => seq.next());
    const loopBox = el('input', { type: 'checkbox', checked: seq.loop });
    loopBox.onchange = () => seq.setLoop(loopBox.checked);
    const loop = el('label', { className: 'check seq-loop' }, loopBox, el('span', { textContent: 'loop' }));
    const nav = el('div', { className: 'row' }, el('label', { textContent: 'skip' }), prev, next, loop);

    const parts = seq.parts.map((part, i) => {
      const nameProxy = {
        get name() { return seq.parts[i]?.name ?? ''; },
        set name(v) { seq.setPart(i, { name: v }); },
        type: `part ${i + 1}`,
      };
      const length = createSlider({
        min: MIN_DURATION, max: MAX_DURATION, step: 1, scale: 'log', format: clock, nudge: 1,
        ariaLabel: `part ${i + 1} length`, value: part.duration,
        onInput: (v) => {
          seq.setPart(i, { duration: v });
          length.set(seq.parts[i].duration);
        },
      });
      const chips = engine.modules.map((m) => {
        const chip = el('button', { type: 'button', className: 'chip', textContent: `#${m.id} ${m.name}` });
        chip.dataset.id = String(m.id);
        chip.setAttribute('aria-pressed', String(part.modules.includes(m.id)));
        chip.onclick = () => {
          seq.toggleMember(i, m.id);
          syncChips(i);
        };
        return chip;
      });
      const useRunning = btn('use running', `use the running modules in part ${i + 1}`, () => {
        seq.useRunning(i);
        syncChips(i);
      }, 'wide');
      const up = btn('↑', `move part ${i + 1} up`, () => { seq.movePart(i, -1); renderBody(); });
      const down = btn('↓', `move part ${i + 1} down`, () => { seq.movePart(i, 1); renderBody(); });
      const del = btn('×', `remove part ${i + 1}`, () => { seq.removePart(i); renderBody(); });
      up.disabled = i === 0;
      down.disabled = i === seq.parts.length - 1;
      const node = el('div', { className: 'seq-part' },
        el('div', { className: 'seq-part-head' }, el('span', { className: 'seq-num', textContent: `${i + 1}` }), el('span', {}, nameEditor(nameProxy)), up, down, del),
        el('div', { className: 'row' }, el('label', { textContent: 'length' }), length.node),
        el('div', { className: 'chips' }, ...(chips.length ? chips : [el('span', { className: 'muted', textContent: 'no modules yet' })])),
        el('div', { className: 'row' }, useRunning));
      partEls.push({ node, chips });
      return node;
    });

    const add = btn('+ part', 'add a part', () => {
      seq.addPart();
      renderBody();
    }, 'wide');
    add.disabled = seq.parts.length >= MAX_PARTS;
    body.replaceChildren(nav, ...parts, add);
  }
  renderBody();

  const typing = () => {
    const a = document.activeElement;
    return body.contains(a) && a.tagName === 'INPUT' && a.type === 'text';
  };

  return {
    card,
    refresh: renderBody,
    remove: () => card.node.remove(),
    update() {
      card.setTitle(seq.name);
      const state = seq.running ? 'running' : 'stopped';
      if (toggle.dataset.state !== state) {
        toggle.dataset.state = state;
        toggle.textContent = seq.running ? '■' : PLAY;
        toggle.title = seq.running ? 'stop' : 'play';
        toggle.setAttribute('aria-label', toggle.title);
      }
      const n = seq.parts.length;
      const part = seq.parts[seq.index];
      const text = n ? `part ${seq.index + 1}/${n} · ${clock(seq.running ? Math.ceil(seq.remaining()) : part.duration)}` : 'no parts';
      if (status.textContent !== text) status.textContent = text;
      bar.style.width = `${n && part ? Math.min(100, (seq.elapsed / part.duration) * 100) : 0}%`;
      if (moduleSig() !== sig && !typing()) renderBody();
      partEls.forEach((p, i) => p.node.classList.toggle('current', i === seq.index));
      for (const p of partEls) {
        for (const chip of p.chips) {
          const m = engine.modules.find((x) => x.id === Number(chip.dataset.id));
          const label = m ? `#${m.id} ${m.name}` : chip.textContent;
          if (chip.textContent !== label) chip.textContent = label;
        }
      }
    },
  };
}
