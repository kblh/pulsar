const CACHE = 'pulsar-v19';
const FILES = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
  'js/main.js', 'js/ui.js', 'js/engine.js', 'js/clock.js', 'js/clock.worker.js',
  'js/module.js', 'js/synth.js', 'js/track.js', 'js/timing.js', 'js/evolution.js',
  'js/melody.js', 'js/rhythm.js', 'js/scales.js', 'js/rng.js', 'js/drone.js', 'js/transport.js', 'js/mix.js', 'js/fx.js', 'js/sends.js',
  'js/options.js', 'js/scene.js', 'js/scene-store.js', 'js/scenes-ui.js', 'js/scene-file.js', 'js/card.js', 'js/detail.js', 'js/hud.js', 'js/controls.js', 'js/envelope.js',
  'js/fx-fields.js', 'js/crush.js', 'js/worklet.js', 'js/bitcrusher.worklet.js',
  'js/sequence.js', 'js/sequence-ui.js', 'js/module-file.js',
  'js/icons.js', 'js/menu.js', 'js/keys.js', 'js/theme.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
