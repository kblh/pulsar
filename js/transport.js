/** Global play/stop over module objects ({id, running, start(), stop()}). */
export function createTransport() {
  const modules = new Map();
  const stoppedByUs = new Set();
  let stopped = false;

  return {
    register(m) {
      modules.set(m.id, m);
      if (stopped) {
        m.stop();
        stoppedByUs.add(m.id);
      }
    },
    unregister(id) {
      modules.delete(id);
      stoppedByUs.delete(id);
    },
    /** A hand-made start/stop: the module is no longer ours to restart. */
    manual(id) {
      stoppedByUs.delete(id);
    },
    stopAll() {
      for (const m of modules.values()) {
        if (m.running) {
          m.stop();
          stoppedByUs.add(m.id);
        }
      }
      stopped = stoppedByUs.size > 0;
    },
    playAll() {
      const anyRunning = [...modules.values()].some((m) => m.running);
      const ids = stoppedByUs.size ? [...stoppedByUs] : anyRunning ? [] : [...modules.keys()];
      for (const id of ids) modules.get(id)?.start();
      stoppedByUs.clear();
      stopped = false;
      // Items restart in registration order, so one that decides about other items (the sequence) must come last.
      for (const m of modules.values()) m.settle?.();
    },
    /** True when [stop all] (not the user) stopped this module and play-all would restart it. */
    stoppedByUs: (id) => stoppedByUs.has(id),
    anyRunning: () => [...modules.values()].some((m) => m.running),
    isStopped: () => stopped,
  };
}
