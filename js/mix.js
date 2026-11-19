const RAMP = 0.02; // seconds; keeps slider moves free of zipper noise

export function clampVolume(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

export function clampPan(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(-1, n)) : 0;
}

/** Send levels: unusable input means silence (unlike volume, which defaults to full). */
export function clampLevel(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Wires `out` -> volume -> pan -> `destination`; changes are ramped, never jumps. */
export function connectMix(ctx, out, destination) {
  const volume = ctx.createGain();
  const pan = ctx.createStereoPanner();
  volume.gain.value = 1;
  pan.pan.value = 0;
  out.connect(volume).connect(pan).connect(destination);
  const sends = new Set();
  return {
    setVolume: (v) => volume.gain.setTargetAtTime(clampVolume(v), ctx.currentTime, RAMP),
    setPan: (v) => pan.pan.setTargetAtTime(clampPan(v), ctx.currentTime, RAMP),
    /** Taps the signal after pan into `dest`; starts silent. */
    send(dest) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      pan.connect(gain);
      gain.connect(dest);
      const s = {
        setLevel: (v) => gain.gain.setTargetAtTime(clampLevel(v), ctx.currentTime, RAMP),
        disconnect() {
          sends.delete(s);
          pan.disconnect(gain);
          gain.disconnect();
        },
      };
      sends.add(s);
      return s;
    },
    disconnect() {
      for (const s of [...sends]) s.disconnect();
      volume.disconnect();
      pan.disconnect();
    },
  };
}
