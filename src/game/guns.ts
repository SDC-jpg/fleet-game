// Ship guns: where they are (from the ship's layout in art.json, made in ShipArt),
// and how hard and how often each one fires (worked out here, so every ship of a
// tier deals about the same damage per second whatever its guns; see CONFIG.guns).
// Firing itself is in world.ts (fireGuns).

import { CONFIG, SHIP_TYPES, type ShipTypeId } from './config';
import type { ArtLayoutsFile, Gun, WeaponType } from './artLayout';
import type { Ship } from './world';

/** A gun ready to use: its layout plus the numbers worked out for it. */
export interface GunSpec {
  /** Where its shots start, from the ship's centre (game pixels; +x forward, +y down). */
  x: number;
  y: number;
  /** Where it points when not turning (radians, from the ship's facing). */
  angle: number;
  size: number;
  type: WeaponType;
  turret: boolean;
  image?: string;
  /** Turrets: how far they turn either side of `angle`, and how fast (radians, per second). */
  arc: number;
  turnRate: number;
  /** Seconds between shots (before fire-rate bonuses and AI slowdowns). */
  interval: number;
  /** Damage per shot (before damage bonuses). */
  damage: number;
}

/**
 * A ship's art name before its tier: enemy ships have their own art. A hijacked
 * ship keeps the art (and guns) of the side it came from.
 */
export function shipArtBase(s: Pick<Ship, 'type' | 'team' | 'hijackedFrom'>) {
  const sprites = SHIP_TYPES[s.type].sprites;
  return (s.hijackedFrom ?? s.team) === 'enemy' ? sprites.enemyShip : sprites.ship;
}

/** "ship.fighter" at tier 3 → "ship.fighter.t3" (tier 1 has no suffix). */
export const tierName = (base: string, tier: number) => (tier === 1 ? base : `${base}.t${tier}`);

/** The standard guns for a tier (used when a ship has no guns placed): 1 at tier 1, 2 side by side above. */
export function defaultGuns(type: ShipTypeId, tier: number): Gun[] {
  const t = SHIP_TYPES[type];
  const size = CONFIG.tiers.sizePerTier ** (tier - 1);
  const x = Math.round(t.gunOffset * size);
  if (tier === 1) return [{ x, y: 0, angle: 0, size: 1, type: 'ballistic', turret: false }];
  // Spread across 80% of the ship's width, like the guns before they could be placed.
  const side = Math.round(t.radius * size * 0.4);
  return [-side, side].map((y) => ({ x, y, angle: 0, size: tier, type: 'ballistic', turret: false }));
}

/** A tier's damage per second (before bonuses): a tier-1 ship's, × powerPerTier per tier. */
export function tierDps(type: ShipTypeId, tier: number) {
  const t = SHIP_TYPES[type];
  return (t.bulletDamage / t.fireCooldown) * CONFIG.tiers.powerPerTier ** (tier - 1);
}

/**
 * Work out each gun's shot interval and damage: the tier's damage per second is
 * shared between the guns by size (a gun's weight is powerPerTier^(size − 1)),
 * a bigger gun fires slower with harder shots, and the weapon type changes both.
 */
export function balanceGuns(type: ShipTypeId, tier: number, guns: Gun[]): GunSpec[] {
  const G = CONFIG.guns;
  const T = CONFIG.tiers;
  const t = SHIP_TYPES[type];
  const budget = tierDps(type, tier);
  const weight = (g: Gun) => T.powerPerTier ** (Math.max(1, g.size) - 1);
  const total = guns.reduce((sum, g) => sum + weight(g), 0);
  return guns.map((g) => {
    const size = Math.max(1, Math.round(g.size));
    const kind = G.types[g.type] ?? G.types.ballistic;
    const interval = t.fireCooldown * T.fireIntervalPerTier ** (size - 1) * kind.rate;
    return {
      x: g.x,
      y: g.y,
      angle: (g.angle * Math.PI) / 180,
      size,
      type: g.type,
      turret: g.turret,
      image: g.image,
      arc: (G.turretArc * Math.PI) / 180,
      turnRate: G.turretTurnRate * G.turretTurnRatePerSize ** (size - 1),
      interval,
      damage: ((budget * weight(g)) / total) * interval * kind.efficiency,
    };
  });
}

let layouts: ArtLayoutsFile | null = null;
const cache = new Map<string, GunSpec[]>();

/** Give the gun rules the art layouts (Game.ts does this once art.json is loaded). */
export function setGunLayouts(data: ArtLayoutsFile | null) {
  layouts = data;
  cache.clear();
}

/** The guns placed on a ship design in ShipArt, or the standard ones. */
export function gunLayout(type: ShipTypeId, artBase: string, tier: number): Gun[] {
  const placed = layouts?.ships[tierName(artBase, tier)]?.guns;
  return placed && placed.length ? placed : defaultGuns(type, tier);
}

/** A ship's guns (worked out once per design and tier). */
export function gunsOf(s: Pick<Ship, 'type' | 'team' | 'hijackedFrom' | 'tier'>): GunSpec[] {
  const base = shipArtBase(s);
  const key = `${s.type}|${base}|${s.tier}`;
  let specs = cache.get(key);
  if (!specs) {
    specs = balanceGuns(s.type, s.tier, gunLayout(s.type, base, s.tier));
    cache.set(key, specs);
  }
  return specs;
}

/** The guns a layout has (copied), or the standard ones for its tier if none are placed. For ShipArt. */
export function layoutGunsOrDefault(layout: { guns?: Gun[] } | undefined, tier: number, type: ShipTypeId = 'fighter'): Gun[] {
  return layout?.guns?.length ? layout.guns : defaultGuns(type, tier);
}
