// Small math helpers used everywhere.

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const randRange = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export function distSq(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Wraps an angle into the range -PI..PI. */
export function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Turns `current` toward `target` by at most `maxStep` radians. */
export function turnToward(current: number, target: number, maxStep: number) {
  const diff = wrapAngle(target - current);
  return current + clamp(diff, -maxStep, maxStep);
}

/** Moves a value toward a target by at most `maxStep`. */
export function approach(current: number, target: number, maxStep: number) {
  return current < target ? Math.min(current + maxStep, target) : Math.max(current - maxStep, target);
}
