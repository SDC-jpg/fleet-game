// The game loop. Game logic runs at a fixed 60 steps per second, so it behaves
// the same on fast and slow computers. Drawing happens once per screen refresh
// (or less often, if minFrameTime asks for it). Screens faster than 60 Hz
// refresh between steps, so render gets `alpha`: how far it is (0–1) from the
// last step to the next, to draw moving things smoothly in between.

export const STEP = 1 / 60;

export function startLoop(
  update: (dt: number) => void,
  render: (frameDt: number, alpha: number) => void,
  /** Shortest time between frames in seconds (0 = every screen refresh). */
  minFrameTime: () => number = () => 0,
): () => void {
  let last = performance.now();
  let pending = 0;
  let handle = 0;

  const tick = (now: number) => {
    handle = requestAnimationFrame(tick);
    // Skip this refresh if it comes too soon (a small margin allows for timer jitter).
    if ((now - last) / 1000 < minFrameTime() - 0.002) return;
    // Cap the gap, e.g. after switching back from another browser tab.
    const frameDt = Math.min((now - last) / 1000, 0.1);
    last = now;
    pending += frameDt;
    while (pending >= STEP) {
      update(STEP);
      pending -= STEP;
    }
    render(frameDt, pending / STEP);
  };
  handle = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(handle);
}
