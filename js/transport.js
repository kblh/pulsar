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
    stopAll() {
      for (const m of modules.values()) {
        if (m.running) {
          m.stop();
          stoppedByUs.add(m.id);
        }
      }
      stopped = true;
    },
    playAll() {
      for (const id of stoppedByUs) modules.get(id)?.start();
      stoppedByUs.clear();
      stopped = false;
    },
    isStopped: () => stopped,
  };
}
