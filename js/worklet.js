const loaded = new WeakSet(); // contexts whose bitcrusher worklet is ready

export function markWorkletLoaded(ctx) {
  loaded.add(ctx);
}

export const hasWorklet = (ctx) => loaded.has(ctx);

/** Loads the bitcrusher's AudioWorklet module. Never throws and never rejects: the answer is true or false. */
export async function loadWorklet(ctx, url = 'js/bitcrusher.worklet.js') {
  try {
    if (!ctx?.audioWorklet?.addModule || typeof AudioWorkletNode === 'undefined') return false;
    await ctx.audioWorklet.addModule(url);
    markWorkletLoaded(ctx);
    return true;
  } catch {
    return false;
  }
}
