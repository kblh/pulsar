import { createEngine } from './engine.js';
import { mountUi } from './ui.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

mountUi({
  engine: createEngine(),
  modulesEl: document.getElementById('modules'),
  adderEl: document.getElementById('adder'),
  transportEl: document.getElementById('transport'),
});
