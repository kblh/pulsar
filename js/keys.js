const OWN_KEYS = 'input, textarea, select, button, [role=slider], [contenteditable]';

/** Should a keydown act as the global play/stop shortcut? Only a bare Space, and never where Space already means something. */
export function shouldHandleSpace(e) {
  if (e.code !== 'Space' && e.key !== ' ') return false;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.target?.isContentEditable || e.target?.closest?.(OWN_KEYS)) return false;
  return true;
}
