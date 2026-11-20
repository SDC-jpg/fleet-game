// Ship damage marks, the rules side (docs/SHIP-DAMAGE.md): every hit that gets through a ship's
// shields is remembered on the ship, in its own pixels (x forward, y to its right, from its
// middle), with what kind of hit it was and how hard. render-side code (shipDamage.ts) turns them
// into marks on the hull. Nothing here changes how the game plays.

import { CONFIG } from './config';
import { worldToShipPoint } from './artLayout';
import type { Ship } from './world';
import type { LeviathanPiece } from './leviathan';

/** Gun shots tear plating; energy burns; missiles and other blasts burn and break; a Leviathan's wound (its blood bursting out) is a big glowing gash. */
export type HitKind = 'gun' | 'energy' | 'missile' | 'wound';

export interface DamageHit {
  /** Where, in the ship's own game pixels (x forward, y to its right, from its middle). */
  x: number;
  y: number;
  /** Which way it was going, in the ship's own frame (a unit vector), if known: it lands on the first hull pixel that way. */
  dx?: number;
  dy?: number;
  /** It went right through (the Laser skill): it burns a line across the hull. */
  through?: boolean;
  /** Where isn't known (an area blast, a skill without a hit point): a random spot on the hull. */
  random?: boolean;
  kind: HitKind;
  /** How hard: the damage ÷ the ship's max health. */
  strength: number;
}

/** Damage sources that burn (energy weapons and skills). */
const ENERGY = new Set(['gun-energy', 'laser', 'gatling', 'laserPods', 'plasmaLance', 'splitBeam', 'arcImpulse', 'ionCloud', 'crescent', 'tractorBeam', 'leviathan-beam']);
/** Damage sources that blow up (missiles, mines, blasts). */
const BLAST = new Set(['missiles', 'gun-explosive', 'mines', 'wrecksplosion', 'leviathan-blood']);

/** What kind of hit a damage source makes. */
export function hitKind(source: string, homing: boolean): HitKind {
  if (homing || BLAST.has(source)) return 'missile';
  if (ENERGY.has(source)) return 'energy';
  return 'gun';
}

/** Where a blow landed: a point, and (if it's moving: a shot, a beam) which way it went; `through` = it went right through. */
export interface HitPoint {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  homing?: number;
  through?: boolean;
}

/**
 * Remember a hit on a ship (damage that got through its shield, landing at `at` in the world).
 * Gun hits need a point; energy and blast damage without one lands on a random spot. Only the
 * latest few wait to be turned into marks (the drawing side takes them).
 */
export function recordHit(s: Ship, amount: number, source: string, at?: HitPoint) {
  if (!CONFIG.damage.enabled || amount <= 0 || s.leviathan || s.parasite) return;
  const kind = hitKind(source, (at?.homing ?? 0) > 0);
  if (!at && kind === 'gun') return;
  pushHit((s.hits ??= []), makeHit(kind, Math.min(1, amount / s.stats.maxHp), s.x, s.y, s.angle, at));
}

/** A hit in the frame of something at (x, y) turned to `angle` (its image's x axis). */
function makeHit(kind: HitKind, strength: number, x: number, y: number, angle: number, at?: HitPoint): DamageHit {
  const hit: DamageHit = { x: 0, y: 0, kind, strength, random: !at };
  if (at) {
    const p = worldToShipPoint(at.x, at.y, x, y, angle);
    hit.x = p.x;
    hit.y = p.y;
    const v = Math.hypot(at.vx ?? 0, at.vy ?? 0);
    if (v > 0) {
      const a = Math.atan2(at.vy!, at.vx!) - angle;
      hit.dx = Math.cos(a);
      hit.dy = Math.sin(a);
    }
    hit.through = at.through;
  }
  return hit;
}

function pushHit(hits: DamageHit[], hit: DamageHit) {
  hits.push(hit);
  if (hits.length > CONFIG.damage.pendingHits) hits.shift();
}

/**
 * The Leviathan: a hit on one of its pieces (not its head, whose pictures change and mirror),
 * remembered on that piece in its image's frame (its art faces up, so turned a quarter more).
 * Its health is shared by every piece, so a hit counts as if each piece had its share of it.
 * `kind` given = a wound (its blood bursting out there).
 */
export function recordPieceHit(s: Ship, piece: LeviathanPiece, index: number, amount: number, source: string, at?: HitPoint, kind?: HitKind) {
  const body = s.leviathan!;
  if (!CONFIG.damage.enabled || index === 0 || (amount <= 0 && !kind)) return;
  const k = kind ?? hitKind(source, (at?.homing ?? 0) > 0);
  if (!at && k === 'gun') return;
  const strength = kind === 'wound' ? CONFIG.leviathan.damage.woundStrength : Math.min(1, (amount * body.pieces.length) / s.stats.maxHp);
  pushHit((piece.hits ??= []), makeHit(k, strength, piece.x, piece.y, piece.angle + Math.PI / 2, at));
}
