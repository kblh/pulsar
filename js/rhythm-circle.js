import { STEPS_PER_BAR } from './timing.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SIZE = 500; // viewBox
const C = SIZE / 2;
const HEAD_OVER = 14; // the playhead reaches this far past the outer ring

/** The rings from the outside in, as in Buddy: hi-hat, snare, kick. `radius` is in viewBox units. */
export const RINGS = [
  { drum: 'hat', radius: 210 },
  { drum: 'snare', radius: 155 },
  { drum: 'kick', radius: 100 },
];

/** A point on a ring for a step: step 0 is at the top, the steps run clockwise. */
export function stepPoint(step, radius, steps = STEPS_PER_BAR) {
  const a = (step / steps) * 2 * Math.PI;
  return { x: Math.round((C + radius * Math.sin(a)) * 100) / 100, y: Math.round((C - radius * Math.cos(a)) * 100) / 100 };
}

function svg(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const nodeRadius = (radius, steps) => Math.round(Math.min(11, Math.max(5, 0.45 * ((2 * Math.PI * radius) / steps))) * 10) / 10;

/**
 * The three drum lanes as concentric rings, each with its own number of steps and rotation, and a playhead; a
 * counterpart of the step grid. A click on a step calls `onToggle(drum, step)` (the pattern's own step, whatever the
 * rotation). `set(voices, rotation)` shows the patterns (`{ kick: [bool, ...], ... }`) and the turn of each lane,
 * `setPlayhead(sixteenth, positions)` moves the hand (0..15 of the bar) and marks the position each lane has reached.
 * They only touch what changed, so they are cheap to call every frame.
 */
export function createRhythmCircle({ onToggle }) {
  const root = svg('svg', { class: 'rhythm-circle', viewBox: `0 0 ${SIZE} ${SIZE}`, role: 'group', 'aria-label': 'rhythm circle' });
  const lanes = {}; // drum -> { group, nodes, on, steps, rotation }
  for (const { drum, radius } of RINGS) {
    root.append(svg('circle', { class: 'ring-track', cx: C, cy: C, r: radius }));
  }
  const head = svg('line', { class: 'ring-head', x1: C, y1: C, x2: C, y2: C - RINGS[0].radius - HEAD_OVER });
  root.append(head);
  for (const { drum } of RINGS) {
    lanes[drum] = { group: svg('g'), nodes: [], on: [], steps: 0, rotation: 0, now: -1 };
    root.append(lanes[drum].group);
  }

  function build(drum, radius, steps, rotation) {
    const lane = lanes[drum];
    lane.group.replaceChildren();
    lane.nodes = [];
    lane.on = Array(steps).fill(false);
    lane.steps = steps;
    lane.rotation = rotation;
    lane.now = -1;
    const r = nodeRadius(radius, steps);
    for (let j = 0; j < steps; j++) {
      const { x, y } = stepPoint((j + rotation) % steps, radius, steps);
      const n = svg('circle', {
        class: `ring-step ring-${drum}`, cx: x, cy: y, r, tabindex: 0, role: 'button',
        'aria-label': `${drum} step ${j + 1}`, 'aria-pressed': 'false',
      });
      n.addEventListener('click', () => onToggle?.(drum, j));
      n.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onToggle?.(drum, j);
      });
      lane.nodes.push(n);
      lane.group.append(n);
    }
  }

  let sixteenth = -1;
  const moveHead = () => {
    const p = sixteenth < 0 ? { x: C, y: C - RINGS[0].radius - HEAD_OVER } : stepPoint(sixteenth, RINGS[0].radius + HEAD_OVER);
    head.setAttribute('x2', p.x);
    head.setAttribute('y2', p.y);
  };
  return {
    node: root,
    set(voices, rotation = {}) {
      for (const { drum, radius } of RINGS) {
        const pattern = voices[drum] ?? [];
        const turn = rotation[drum] ?? 0;
        const lane = lanes[drum];
        if (pattern.length !== lane.steps || turn !== lane.rotation) build(drum, radius, pattern.length, turn);
        lane.nodes.forEach((n, j) => {
          const v = Boolean(pattern[j]);
          if (v === lane.on[j]) return;
          lane.on[j] = v;
          n.setAttribute('aria-pressed', String(v));
        });
      }
    },
    setPlayhead(i, positions = {}) {
      for (const { drum } of RINGS) {
        const lane = lanes[drum];
        const pos = i < 0 || !lane.steps ? -1 : positions[drum] ?? -1;
        const j = pos < 0 ? -1 : (((pos - lane.rotation) % lane.steps) + lane.steps) % lane.steps;
        if (j === lane.now) continue;
        lane.nodes[lane.now]?.classList.remove('now');
        lane.nodes[j]?.classList.add('now');
        lane.now = j;
      }
      if (i === sixteenth) return;
      sixteenth = i;
      moveHead();
    },
  };
}
