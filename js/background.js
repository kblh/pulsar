/**
 * Keeps the sound going when the screen turns off or the app goes to the background (iOS in particular).
 * Web Audio alone is suspended by iOS then; a page that plays real media is not. So while anything is running a silent
 * <audio> loop plays next to the AudioContext, the audio session is declared 'playback' and the lock screen gets
 * play/pause through the Media Session API. Each piece is optional: a browser without it simply skips it.
 */

/** A WAV file of silence (8-bit mono PCM), as bytes. */
export function silentWav(seconds = 1, rate = 8000) {
  const n = Math.max(1, Math.round(seconds * rate));
  const bytes = new Uint8Array(44 + n);
  const view = new DataView(bytes.buffer);
  const tag = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, 36 + n, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); // bytes per second
  view.setUint16(32, 1, true); // bytes per frame
  view.setUint16(34, 8, true); // bits
  tag(36, 'data');
  view.setUint32(40, n, true);
  bytes.fill(128, 44); // 8-bit PCM is unsigned: 128 is silence
  return bytes;
}

/** True while the app should hold the audio session: something runs and the context is not shut down for good. */
export const holdsSession = ({ running, state }) => running && state !== 'closed';

export function setupBackgroundAudio(engine, { doc = document, nav = navigator, win = window, interval = 1000 } = {}) {
  const ctx = engine.ctx;
  try {
    if (nav.audioSession) nav.audioSession.type = 'playback'; // iOS: keep playing with the screen off and the silent switch on
  } catch { /* not supported */ }

  const audio = doc.createElement('audio');
  audio.loop = true;
  audio.setAttribute('playsinline', '');
  audio.setAttribute('aria-hidden', 'true');
  audio.src = URL.createObjectURL(new Blob([silentWav()], { type: 'audio/wav' }));
  audio.style.display = 'none';
  doc.body.append(audio);

  const session = nav.mediaSession;
  const wanted = () => holdsSession({ running: engine.anyRunning(), state: ctx.state });
  const sync = () => {
    const on = wanted();
    if (on && audio.paused) audio.play().catch(() => {}); // refused until the first gesture: unlock() tries again
    else if (!on && !audio.paused) audio.pause();
    if (session) session.playbackState = on ? 'playing' : engine.hasModules() ? 'paused' : 'none';
  };
  const wake = () => {
    if (doc.visibilityState === 'hidden' || !engine.anyRunning()) return;
    if (ctx.state !== 'running') engine.resume().catch(() => {}); // iOS leaves the context 'interrupted' after a call or a lock
    sync();
  };

  if (session) {
    try {
      session.metadata = new win.MediaMetadata({ title: 'Pulsar', artist: 'generative sequencer' });
      session.setActionHandler('play', async () => {
        await engine.resume();
        engine.playAll();
        sync();
      });
      session.setActionHandler('pause', () => {
        engine.stopAll();
        sync();
      });
    } catch { /* an action this browser does not know */ }
  }

  // The first play() has to come from a gesture; later ones from the timer are then allowed.
  const unlock = () => {
    for (const type of ['pointerdown', 'keydown']) doc.removeEventListener(type, unlock, true);
    audio.play().then(() => { if (!wanted()) audio.pause(); }).catch(() => {});
  };
  for (const type of ['pointerdown', 'keydown']) doc.addEventListener(type, unlock, true);

  doc.addEventListener('visibilitychange', wake);
  win.addEventListener('pageshow', wake);
  win.addEventListener('focus', wake);
  ctx.addEventListener?.('statechange', sync);
  const timer = setInterval(sync, interval);
  return {
    audio,
    sync,
    dispose() {
      clearInterval(timer);
      audio.pause();
      audio.remove();
    },
  };
}
