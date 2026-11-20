// Ship damage marks, the rules side (docs/SHIP-DAMAGE.md): every hit that gets through a ship's
// shields is remembered on the ship, in its own pixels (x forward, y to its right, from its
// middle), with what kind of hit it was and how hard. render-side code (shipDamage.ts) turns them
// into marks on the hull. Nothing here changes how the game plays.

import { CONFIG } from './config';
import { worldToShipPoint } from './artLayout';
import type { Ship } from './world';

/** Gun shots tear plating; energy burns; missiles and other blasts burn and break. */
export type HitKind = 'gun' | 'energy' | 'missile';

export interface DamageHit {
  /** Where, in the ship's own game pixels (x forward, y to its right, from its middle). */
  x: number;
  y: number;
  kind: HitKind;
  /** How hard: the damage ÷ the ship's max health. */
  strength: number;
}

/** Damage sources that burn (energy weapons and skills). */
const ENERGY = new Set(['gun-energy', 'laser', 'gatling', 'pods', 'plasma-lance', 'split-beam', 'arc', 'ion-cloud', 'crescent', 'leviathan-beam']);
/** Damage sources that blow up (missiles, mines, blasts). */
const BLAST = new Set(['missiles', 'gun-explosive', 'mines', 'wrecksplosion', 'leviathan-blood']);

/** What kind of hit a damage source makes. */
export function hitKind(source: string, homing: boolean): HitKind {
  if (homing || BLAST.has(source)) return 'missile';
  if (ENERGY.has(source)) return 'energy';
  return 'gun';
}

/**
 * Remember a hit on a ship (damage that got through its shield, landing at `at` in the world).
 * Only the latest few wait to be turned into marks (the drawing side takes them).
 */
export function recordHit(s: Ship, amount: number, source: string, at: { x: number; y: number; homing?: number }) {
  if (!CONFIG.damage.enabled || amount <= 0 || s.leviathan || s.parasite) return;
  const p = worldToShipPoint(at.x, at.y, s.x, s.y, s.angle);
  const hits = (s.hits ??= []);
  hits.push({ x: p.x, y: p.y, kind: hitKind(source, (at.homing ?? 0) > 0), strength: Math.min(1, amount / s.stats.maxHp) });
  if (hits.length > CONFIG.damage.pendingHits) hits.shift();
}
