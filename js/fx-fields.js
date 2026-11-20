// How each effect's parameters are shown: one slider per field. Pure data, no DOM.
const pct = (v) => `${Math.round(v * 100)}%`;

export const FX_FIELDS = {
  delay: [
    { key: 'time', min: 10, max: 2000, step: 10, scale: 'log', format: (v) => `${v} ms` },
    { key: 'feedback', min: 0, max: 0.9, step: 0.05, format: (v) => v.toFixed(2) },
    { key: 'tone', min: 200, max: 12000, step: 100, scale: 'log', format: (v) => `${v} Hz` },
    { key: 'return', min: 0, max: 1, step: 0.05, format: pct },
    { key: 'pingpong', min: 0, max: 1, step: 0.05, format: pct },
  ],
  reverb: [
    { key: 'decay', min: 0.3, max: 10, step: 0.1, scale: 'log', format: (v) => `${v.toFixed(1)} s` },
    { key: 'damping', min: 0, max: 1, step: 0.05, format: pct },
    { key: 'return', min: 0, max: 1, step: 0.05, format: pct },
    { key: 'width', min: 0, max: 1, step: 0.05, format: pct },
  ],
};

/** The text of the add-menu button. */
export const FX_LABELS = { delay: 'delay', reverb: 'reverb' };
