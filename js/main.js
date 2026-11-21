import { createEngine } from './engine.js';
import { mountUi } from './ui.js';
import { createSceneStore } from './scene-store.js';
import { loadAccent, saveAccent, applyTheme } from './theme.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

let storage = null;
try {
  storage = window.localStorage; // reading it can throw when site data is blocked
} catch { /* the store then reports 'storage unavailable' */ }

const themeMeta = document.querySelector('meta[name=theme-color]');
let accent = loadAccent(storage);
applyTheme(document.documentElement, themeMeta, accent);

mountUi({
  accent: {
    get: () => accent,
    set(id) {
      accent = id;
      applyTheme(document.documentElement, themeMeta, id);
      saveAccent(storage, id);
    },
  },
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
