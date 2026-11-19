import { stepDuration, swingDelay, STEPS_PER_BAR } from './timing.js';

export const LOOKAHEAD = 0.12;
export const MAX_LAG = 0.5;
export const RESYNC_OFFSET = 0.05;

export function createTrack(now) {
  return { nextTime: now + RESYNC_OFFSET, stepIndex: 0 };
}

/** Collects the steps due within the lookahead window; mutates `track`. */
export function advance(track, now, bpm, swing) {
  if (track.nextTime < now - MAX_LAG) track.nextTime = now + RESYNC_OFFSET;
  const events = [];
  while (track.nextTime <= now + LOOKAHEAD) {
    const time = track.nextTime + swingDelay(track.stepIndex, swing, bpm);
    // Steps that already slipped into the past (a short stall) are skipped, not played stacked.
    if (time >= now) events.push({ time, stepIndex: track.stepIndex });
    track.nextTime += stepDuration(bpm);
    track.stepIndex = (track.stepIndex + 1) % STEPS_PER_BAR;
  }
  return events;
}
