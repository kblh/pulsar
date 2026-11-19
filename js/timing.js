export const STEPS_PER_BAR = 16;

export function stepDuration(bpm) {
  return 60 / bpm / 4;
}

export function swingDelay(stepIndex, swing, bpm) {
  return stepIndex % 2 === 1 ? (swing * stepDuration(bpm)) / 2 : 0;
}
