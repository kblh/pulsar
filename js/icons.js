/** Line icons on a 24 x 24 grid. Stroke only, drawn in `currentColor`, so CSS colours them. */
export const ICON_PATHS = {
  check: 'M5 12l5 5L20 7',
  clone: 'M9 9h11v11H9zM5 15V4h11',
  close: 'M6 6l12 12M18 6L6 18',
  down: 'M12 5v14M6 13l6 6 6-6',
  drum: 'M4 10v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M4 10c0 1.7 3.6 3 8 3s8-1.3 8-3-3.6-3-8-3-8 1.3-8 3zM8 3l3 4M16 3l-3 4',
  export: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  fx: 'M5 4v16M12 4v16M19 4v16M3 9h4M10 15h4M17 8h4',
  import: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  load: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3zM3 10h18l-2 8a2 2 0 0 1-2 1.5H5a2 2 0 0 1-2-2z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  metronome: 'M9 3h6l4 18H5zM12 17L16 8M10 14h4',
  mute: 'M11 5L6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6',
  new: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 12v6M9 15h6',
  next: 'M6 5l9 7-9 7zM18 5v14',
  note: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  pads: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  play: 'M7 4l13 8-13 8z',
  plus: 'M12 5v14M5 12h14',
  prev: 'M18 5l-9 7 9 7zM6 5v14',
  rename: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  save: 'M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v6h8V3M8 21v-7h8v7',
  sound: 'M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  stop: 'M6 6h12v12H6z',
  theme: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.6-2-.5-1.2.2-2.5 1.6-2.5H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3zM8 11h.01M12 8h.01M16 11h.01',
  trash: 'M4 7h16M10 3h4M6 7l1 13h10l1-13M10 11v6M14 11v6',
  up: 'M12 19V5M6 11l6-6 6 6',
  use: 'M4 12h12M11 6l6 6-6 6M20 4v16',
  wave: 'M2 12c2-7 4-7 6 0s4 7 6 0 4-7 6 0',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One icon as an `<svg>`. An unknown name throws (a blank button would hide the mistake). */
export function icon(name) {
  if (!Object.hasOwn(ICON_PATHS, name)) throw new Error(`unknown icon: ${name}`);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.append(path);
  return svg;
}

/** Swaps the icon of a button made by `iconButton` and updates its title and aria-label. */
export function setIcon(button, name, label) {
  const next = icon(name);
  const old = button.querySelector('svg.icon');
  if (old) old.replaceWith(next);
  else button.prepend(next);
  if (label !== undefined) {
    button.title = label;
    button.setAttribute('aria-label', label);
  }
}

/** A button that shows only an icon; `label` becomes its title and accessible name. */
export function iconButton(name, { label, className = '', onClick } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `icon-btn ${className}`.trim();
  b.append(icon(name));
  b.title = label;
  b.setAttribute('aria-label', label);
  if (onClick) b.onclick = onClick;
  return b;
}
