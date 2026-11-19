// Ticks every 25 ms from a Worker so timing survives background-tab throttling.
let id = null;
self.onmessage = (e) => {
  if (e.data === 'start' && id === null) id = setInterval(() => self.postMessage('tick'), 25);
  else if (e.data === 'stop' && id !== null) {
    clearInterval(id);
    id = null;
  }
};
