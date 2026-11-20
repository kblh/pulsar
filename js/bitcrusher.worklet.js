import { createCrusher } from './crush.js';

/** Runs on the audio thread: every channel gets its own crusher, so left and right stay apart. */
class PulsarBitcrusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'rate', defaultValue: 4, minValue: 1, maxValue: 32, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.crushers = [];
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.alive = false; // the effect was removed: let the processor end
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const bits = parameters.bits[0];
    const rate = parameters.rate[0];
    for (let ch = 0; ch < output.length; ch++) {
      const crusher = (this.crushers[ch] ??= createCrusher({ bits, rate, sampleRate }));
      crusher.set({ bits, rate });
      const src = input[ch] ?? input[0];
      const dst = output[ch];
      if (!src) {
        dst.fill(0);
        continue;
      }
      for (let i = 0; i < dst.length; i++) dst[i] = crusher.process(src[i]);
    }
    return this.alive;
  }
}

registerProcessor('pulsar-bitcrusher', PulsarBitcrusher);
