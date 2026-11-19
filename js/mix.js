const RAMP = 0.02; // seconds; keeps slider moves free of zipper noise

export function clampVolume(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

export function clampPan(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(-1, n)) : 0;
}

/** Wires `out` -> volume -> pan -> `destination`; changes are ramped, never jumps. */
export function connectMix(ctx, out, destination) {
  const volume = ctx.createGain();
  const pan = ctx.createStereoPanner();
  volume.gain.value = 1;
  pan.pan.value = 0;
  out.connect(volume).connect(pan).connect(destination);
  return {
    setVolume: (v) => volume.gain.setTargetAtTime(clampVolume(v), ctx.currentTime, RAMP),
    setPan: (v) => pan.pan.setTargetAtTime(clampPan(v), ctx.currentTime, RAMP),
    disconnect() {
      volume.disconnect();
      pan.disconnect();
    },
  };
}
