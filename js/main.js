import { createEngine } from './engine.js';
import { mountUi } from './ui.js';
import { createSceneStore } from './scene-store.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

let storage = null;
try {
  storage = window.localStorage; // reading it can throw when site data is blocked
} catch { /* the store then reports 'storage unavailable' */ }

mountUi({
  store: createSceneStore(storage),
  scenePanelEl: document.getElementById('scene-panel'),
  engine: createEngine(),
  effectsEl: document.getElementById('effects'),
  modulesEl: document.getElementById('modules'),
  sequenceEl: document.getElementById('sequence'),
  addBtn: document.getElementById('add-btn'),
  addMenuEl: document.getElementById('add-menu'),
  menuBtn: document.getElementById('menu-btn'),
  mainMenuEl: document.getElementById('main-menu'),
  statusEl: document.getElementById('status'),
  transportEl: document.getElementById('transport'),
});
