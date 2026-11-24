// How each effect's parameters are shown: one slider per field. Pure data, no DOM.
const pct = (v) => `${Math.round(v * 100)}%`;
const db = (v) => (v === 0 ? '0 dB' : `${v > 0 ? '+' : '\u2212'}${Math.abs(v)} dB`);

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
  eq: [
    { key: 'low', min: -12, max: 12, step: 0.5, format: db },
    { key: 'mid', min: -12, max: 12, step: 0.5, format: db },
    { key: 'high', min: -12, max: 12, step: 0.5, format: db },
    { key: 'midFreq', min: 200, max: 5000, step: 10, scale: 'log', format: (v) => `${v} Hz` },
    { key: 'return', min: 0, max: 1, step: 0.05, format: pct },
  ],
  distortion: [
    { key: 'drive', min: 0, max: 1, step: 0.05, format: pct },
    { key: 'shape', min: 0, max: 1, step: 0.05, format: pct },
    { key: 'tone', min: 500, max: 12000, step: 100, scale: 'log', format: (v) => `${v} Hz` },
    { key: 'return', min: 0, max: 1, step: 0.05, format: pct },
  ],
  bitcrusher: [
    { key: 'bits', min: 1, max: 16, step: 1, format: (v) => `${v} bit` },
    { key: 'rate', min: 1, max: 32, step: 1, format: (v) => `\u00f7${v}` },
    { key: 'return', min: 0, max: 1, step: 0.05, format: pct },
  ],
};

/** The text of the add-menu button. */
export const FX_LABELS = { delay: 'delay', reverb: 'reverb', eq: 'eq', distortion: 'drive', bitcrusher: 'crusher' };
