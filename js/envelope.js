import { envLayout, nodePositions, envFromDrag } from './hud.js';

const W = 320;
const H = 120;
const PAD = 16;
const HIT_R = 26; // viewBox units; about 44 px on a 320 px screen
const SVG_NS = 'http://www.w3.org/2000/svg';
const round2 = (v) => Math.round(v * 100) / 100;

function svg(tag, attrs = {}, ...children) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...children);
  return e;
}

const NODES = [
  { id: 'attack', label: 'attack time' },
  { id: 'decay', label: 'decay time and sustain level' },
  { id: 'release', label: 'release time' },
];

/**
 * An ADSR graph: drag the three nodes (or use the arrow keys on a focused node).
 * `onChange(partial)` gets the keys a node controls ({ a } | { d, s } | { r }); `set(env)` redraws without calling it.
 */
export function createEnvelopeEditor({ env, onChange }) {
  const L = envLayout({ w: W, h: H, pad: PAD });
  let cur = { ...env };

  const grid = svg('g', { class: 'env-grid' });
  for (let i = 0; i <= 4; i++) grid.append(svg('line', { x1: PAD + i * L.seg, y1: PAD, x2: PAD + i * L.seg, y2: H - PAD }));
  for (const f of [0, 0.5, 1]) grid.append(svg('line', { x1: PAD, y1: PAD + f * (H - 2 * PAD), x2: W - PAD, y2: PAD + f * (H - 2 * PAD) }));
  const area = svg('polygon', { class: 'env-area' });
  const line = svg('polyline', { class: 'env-line' });
  const dots = {};
  const nodeEls = NODES.map(({ id, label }) => {
    const dot = svg('circle', { class: 'env-dot', r: 6 });
    dots[id] = dot;
    const g = svg('g', { class: 'env-node', tabindex: 0, role: 'slider', 'aria-label': label, 'data-node': id },
      svg('circle', { class: 'env-hit', r: HIT_R }), dot);
    return g;
  });
  const root = svg('svg', { class: 'env-svg', viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'envelope' }, grid, area, line, ...nodeEls);

  const readout = document.createElement('div');
  readout.className = 'env-readout';
  const spans = ['a', 'd', 's', 'r'].map(() => readout.appendChild(document.createElement('span')));
  const node = document.createElement('div');
  node.className = 'env';
  node.append(root, readout);

  function render() {
    const p = nodePositions(cur, L);
    const pts = [p.start, p.attack, p.decay, p.sustainEnd, p.release];
    line.setAttribute('points', pts.map((q) => `${q.x},${q.y}`).join(' '));
    area.setAttribute('points', [...pts, { x: p.release.x, y: H - PAD }, { x: p.start.x, y: H - PAD }].map((q) => `${q.x},${q.y}`).join(' '));
    for (const { id } of NODES) {
      const q = p[id];
      const g = dots[id].parentNode;
      g.setAttribute('transform', `translate(${q.x} ${q.y})`);
    }
    const pctS = `${Math.round(cur.s * 100)}%`;
    spans[0].textContent = `a ${cur.a.toFixed(2)} s`;
    spans[1].textContent = `d ${cur.d.toFixed(2)} s`;
    spans[2].textContent = `s ${pctS}`;
    spans[3].textContent = `r ${cur.r.toFixed(2)} s`;
    const set = (id, now, text) => {
      const g = dots[id].parentNode;
      g.setAttribute('aria-valuemin', '0');
      g.setAttribute('aria-valuemax', '5');
      g.setAttribute('aria-valuenow', String(now));
      g.setAttribute('aria-valuetext', text);
    };
    set('attack', cur.a, `${cur.a.toFixed(2)} s`);
    set('decay', cur.d, `decay ${cur.d.toFixed(2)} s, sustain ${pctS}`);
    set('release', cur.r, `${cur.r.toFixed(2)} s`);
  }

  // pointer: capture on the node so the drag keeps working outside the graph
  const toGraph = (e) => {
    const r = root.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  };
  for (const g of nodeEls) {
    const id = g.dataset.node;
    let dragging = false;
    g.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { g.setPointerCapture(e.pointerId); } catch { /* not an active pointer (synthetic event) */ }
      e.preventDefault();
      g.focus();
    });
    g.addEventListener('pointermove', (e) => {
      if (dragging) onChange?.(envFromDrag(id, toGraph(e), cur, L));
    });
    const stop = () => { dragging = false; };
    g.addEventListener('pointerup', stop);
    g.addEventListener('pointercancel', stop);
    g.addEventListener('lostpointercapture', stop);

    g.addEventListener('keydown', (e) => {
      const big = e.shiftKey ? 0.1 : 0.01;
      const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      const dy = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
      if (!dx && !dy) return;
      if (id === 'decay') {
        e.preventDefault();
        onChange?.(dx ? { d: round2(cur.d + dx * big) } : { s: round2(cur.s + dy * big) });
      } else if (dx) {
        e.preventDefault();
        const key = id === 'attack' ? 'a' : 'r';
        onChange?.({ [key]: round2(cur[key] + dx * big) });
      }
    });
  }

  render();
  return {
    node,
    set(next) {
      cur = { ...next };
      render();
    },
  };
}
