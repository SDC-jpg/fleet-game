// The game loop. Game logic runs at a fixed 60 steps per second, so it behaves
// the same on fast and slow computers. Drawing happens once per screen refresh.

export const STEP = 1 / 60;

export function startLoop(update: (dt: number) => void, render: (frameDt: number) => void): () => void {
  let last = performance.now();
  let pending = 0;
  let handle = 0;

  const tick = (now: number) => {
    // Cap the gap, e.g. after switching back from another browser tab.
    const frameDt = Math.min((now - last) / 1000, 0.1);
    last = now;
    pending += frameDt;
    while (pending >= STEP) {
      update(STEP);
      pending -= STEP;
    }
    render(frameDt);
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(handle);
}
