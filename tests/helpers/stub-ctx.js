/** A recording AudioContext stand-in: every node and every parameter call is kept for assertions. */
export function stubCtx() {
  const nodes = [];
  const buffers = [];
  const time = { t: 1 };
  const param = () => {
    const calls = [];
    return { calls, setTargetAtTime: (...a) => calls.push(['target', ...a]), set value(v) { calls.push(['value', v]); } };
  };
  const mk = (kind, extra = {}) => {
    const node = { kind, connections: [], disconnected: 0, ...extra,
      connect(x) { node.connections.push(x); return x; }, disconnect() { node.disconnected++; } };
    nodes.push(node);
    return node;
  };
  return {
    nodes, buffers, sampleRate: 8000,
    get currentTime() { return time.t; },
    createGain: () => mk('gain', { gain: param() }),
    createStereoPanner: () => mk('pan', { pan: param() }),
    createDelay: (max) => mk('delay', { maxDelayTime: max, delayTime: param() }),
    createBiquadFilter: () => mk('biquad', { frequency: param() }),
    createConvolver: () => mk('convolver'),
    createBuffer: (ch, len, sr) => {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      const b = { length: len, sampleRate: sr, getChannelData: (i) => data[i] };
      buffers.push(b);
      return b;
    },
  };
}
