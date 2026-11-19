export function createClock(onTick) {
  const worker = new Worker(new URL('./clock.worker.js', import.meta.url));
  worker.onmessage = () => onTick();
  return {
    start: () => worker.postMessage('start'),
    stop: () => worker.postMessage('stop'),
  };
}
