import { createCrusher } from './crush.js';
import { createSlide } from './slide.js';

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

/** The tremolo's and vibrato's peek: input in, one channel out holding the LFO frequency in Hz (it feeds the LFO's frequency). */
class PulsarSlide extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'speed', defaultValue: 4, minValue: 0.5, maxValue: 20, automationRate: 'k-rate' },
      { name: 'peek', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.slide = createSlide({ sampleRate });
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.alive = false;
    };
  }

  process(inputs, outputs, parameters) {
    const src = inputs[0][0];
    const dst = outputs[0][0];
    const speed = parameters.speed[0];
    const peek = parameters.peek[0];
    for (let i = 0; i < dst.length; i++) dst[i] = this.slide.process(src ? src[i] : 0, speed, peek);
    return this.alive;
  }
}

registerProcessor('pulsar-slide', PulsarSlide);
