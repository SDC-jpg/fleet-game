// Ship classes, modules, abilities and combos.
//
// Every tier-1 ship is one class (Lancer, Knight, Ballista) and carries one
// module of it. A merged ship carries all the modules of the ships that went
// into it. Its "build" (worked out by computeBuild) says which abilities those
// modules give and how strong they are. Like world.ts, nothing is drawn here.

import { clamp, distSq, randRange, wrapAngle } from '../engine/math';
import { CLASS_IDS, CLASSES, COMBOS, CONFIG, type ClassId, type ComboId } from './config';
import {
  addEffect,
  addSound,
  controlledShip,
  findNearestEnemy,
  spawnBullet,
  type Bullet,
  type FireArc,
  type GameState,
  type Ship,
  type Team,
} from './world';

export type Modules = Record<ClassId, number>;

/** What a ship's modules add up to. */
export interface Build {
  /** The class with the most modules (ties picked at random). Picks a tier-1 ship's art. */
  main: ClassId;
  /** Classes with a big enough share for their ability, biggest first. The first is the flagship's right-click ability. */
  abilities: ClassId[];
  /** Each class's share of the modules, 0–1. */
  share: Modules;
  /** Ability strength per class (0 = no ability). Strength 1 = one tier-1 ship's ability. */
  strength: Modules;
  /** Basic gun damage multiplier, from classes too small for an ability. */
  gunBonus: number;
  combo: ComboId | null;
}

export const noModules = (): Modules => ({ lancer: 0, knight: 0, ballista: 0 });
export const oneModule = (c: ClassId): Modules => ({ ...noModules(), [c]: 1 });
export const randomClass = (): ClassId => CLASS_IDS[Math.floor(Math.random() * CLASS_IDS.length)];

/** A copy of `list` in random order (used to break ties at random). */
function shuffled<T>(list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function addModules(a: Modules, b: Modules): Modules {
  const out = noModules();
  for (const c of CLASS_IDS) out[c] = a[c] + b[c];
  return out;
}

/** Work out a ship's abilities, their strength and its combo from its modules. */
export function computeBuild(modules: Modules, tier: number): Build {
  const M = CONFIG.modules;
  const total = CLASS_IDS.reduce((sum, c) => sum + modules[c], 0) || 1;
  // Biggest class first; equal ones in random order (sort keeps the shuffled order for ties).
  const order = shuffled(CLASS_IDS).sort((a, b) => modules[b] - modules[a]);
  const share = noModules();
  for (const c of CLASS_IDS) share[c] = modules[c] / total;
  const abilities = order.filter((c) => modules[c] > 0 && share[c] >= M.minShare - 1e-9);
  const power = CONFIG.tiers.powerPerTier ** (tier - 1);
  const strength = noModules();
  let smallShare = 0;
  for (const c of CLASS_IDS) {
    if (abilities.includes(c)) strength[c] = power * share[c] ** M.purityBonus;
    else smallShare += share[c];
  }
  // A combo needs both of its classes to have an ability. The pair with the most modules wins.
  let combo: ComboId | null = null;
  let best = 0;
  for (const id of shuffled(Object.keys(COMBOS) as ComboId[])) {
    const [a, b] = COMBOS[id].classes;
    if (!abilities.includes(a) || !abilities.includes(b)) continue;
    if (modules[a] + modules[b] > best) {
      best = modules[a] + modules[b];
      combo = id;
    }
  }
  return { main: order[0], abilities, share, strength, gunBonus: 1 + M.smallShareGunBonus * smallShare, combo };
}

/**
 * Modules for an enemy ship of a bigger tier: mostly one random class, with the
 * rest split between the other two, like a fleet that merged mostly alike.
 */
export function randomEnemyModules(tier: number): Modules {
  const total = CONFIG.tiers.shipsPerMerge ** (tier - 1);
  const [main, second, third] = shuffled(CLASS_IDS);
  const m = noModules();
  m[main] = Math.round(total * randRange(0.5, 1));
  const rest = total - m[main];
  m[second] = Math.round(rest * randRange(0.5, 1));
  m[third] = rest - m[second];
  return m;
}

/** "Lancer 5 · Ballista 3 · Splinter Volley": a ship's modules and combo, for the HUD. */
export function describeBuild(modules: Modules, build: Build) {
  const parts = CLASS_IDS.filter((c) => modules[c] > 0)
    .sort((a, b) => modules[b] - modules[a])
    .map((c) => `${CLASSES[c].name} ${modules[c]}`);
  if (build.combo) parts.push(COMBOS[build.combo].name);
  return parts.join(' · ');
}

// ---------- Using abilities ----------

/** Seconds between uses of an ability for this ship (wingmen and enemies are slower). */
function cooldownOf(state: GameState, ship: Ship, c: ClassId) {
  const base = c === 'lancer' ? CONFIG.lance.cooldown : c === 'knight' ? CONFIG.shield.cooldown : CONFIG.missiles.cooldown;
  if (ship === controlledShip(state)) return base;
  return base * (ship.team === 'enemy' ? CONFIG.modules.enemyCooldownMultiplier : CONFIG.modules.allyCooldownMultiplier);
}

/** A new ship's abilities start partly charged, so a fresh formation doesn't fire them all at once. */
export function startingTimers(): Modules {
  const t = noModules();
  for (const c of CLASS_IDS) t[c] = Math.random() * 2;
  return t;
}

/** Where a ship may aim: around its fleet leader's facing (or its own, if it leads). */
function arcOf(ship: Ship): FireArc {
  const leader = ship.fleet.leader ?? ship;
  const deg = ship.team === 'enemy' ? CONFIG.enemyFireArc : CONFIG.allyFireArc;
  return { center: leader.angle, half: (deg * Math.PI) / 180 };
}

/**
 * Every ship uses its abilities by itself when there's something to use them on,
 * except the ship you fly: its first (strongest) ability waits for a right-click.
 */
export function updateAbilities(state: GameState, abilityPressed: boolean, dt: number) {
  const flagship = controlledShip(state);
  for (const s of state.ships) {
    if (s.shieldTime > 0) {
      s.shieldTime -= dt;
      if (s.shieldTime <= 0) s.shield = 0;
    }
    s.retaliationTimer -= dt;
    for (const c of s.build.abilities) s.abilityTimers[c] = Math.max(0, s.abilityTimers[c] - dt);
    if (s.merge || s.dead) continue;
    s.build.abilities.forEach((c, i) => {
      if (s.abilityTimers[c] > 0) return;
      if (s === flagship && i === 0) {
        if (abilityPressed) useAbility(state, s, c, null);
        return;
      }
      const target = autoTarget(state, s, c);
      if (target) useAbility(state, s, c, target);
    });
  }
}

/** The enemy an AI-used ability would go after, or null if it's not worth using now. */
function autoTarget(state: GameState, s: Ship, c: ClassId): Ship | null {
  if (c === 'lancer') return findNearestEnemy(state, s, s.stats.range * 1.5, arcOf(s));
  if (c === 'knight') return findNearestEnemy(state, s, s.stats.range * 1.3);
  return findNearestEnemy(state, s, s.stats.range * 2);
}

/** Use an ability. `target` is null when the player triggered it (it then goes where you aim). */
function useAbility(state: GameState, s: Ship, c: ClassId, target: Ship | null) {
  s.abilityTimers[c] = cooldownOf(state, s, c);
  if (c === 'lancer') {
    let angle = s.angle;
    if (target) {
      const arc = arcOf(s);
      const want = Math.atan2(target.y - s.y, target.x - s.x);
      angle = arc.center + clamp(wrapAngle(want - arc.center), -arc.half, arc.half);
    }
    fireLance(state, s, angle);
  } else if (c === 'knight') {
    castShield(state, s);
  } else {
    // Player-launched missiles go for the enemy nearest the ship you fly.
    launchMissiles(state, s, target ?? findNearestEnemy(state, s, Infinity));
  }
}

function fireLance(state: GameState, s: Ship, angle: number) {
  const L = CONFIG.lance;
  const T = CONFIG.tiers;
  const k = s.tier - 1;
  const speed = L.speed * T.shotSpeedPerTier ** k;
  const reach = L.speed * L.life * T.rangePerTier ** k;
  const off = s.stats.gunOffset;
  spawnBullet(state, {
    team: s.team,
    kind: 'lance',
    sprite: 'projectile.lance',
    tier: s.tier,
    x: s.x + Math.cos(angle) * off,
    y: s.y + Math.sin(angle) * off,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: reach / speed,
    damage: L.damage * s.build.strength.lancer,
    radius: L.radius * s.stats.size,
    pierce: [],
  });
  addSound(state, 'sfx.lance', s, s.tier);
}

function castShield(state: GameState, s: Ship) {
  const S = CONFIG.shield;
  const amount = S.amount * s.build.strength.knight;
  // A bigger Knight share reaches further.
  const radius = S.radius * s.stats.size * (0.5 + 0.5 * s.build.share.knight) + s.stats.radius;
  const combo = s.build.combo === 'mirror' || s.build.combo === 'retaliation' ? s.build.combo : null;
  for (const a of state.ships) {
    if (a.team !== s.team || a.dead || (a.merge && a !== s)) continue;
    if (distSq(a.x, a.y, s.x, s.y) > radius * radius) continue;
    // Shields don't stack: the stronger one stays.
    if (amount >= a.shield) {
      a.shield = amount;
      a.shieldCombo = combo;
    }
    a.shieldTime = S.duration;
  }
  addSound(state, 'sfx.shield', s, s.tier);
}

function launchMissiles(state: GameState, s: Ship, target: Ship | null) {
  const Mi = CONFIG.missiles;
  const strength = s.build.strength.ballista;
  const count = clamp(Math.round(Mi.count * strength ** (1 / 3)), 1, Mi.maxCount);
  const damage = (Mi.damage * strength) / count;
  for (let i = 0; i < count; i++) {
    // Fan out to the sides first, then curve in toward the target.
    const spread = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2.2;
    const a = s.angle + spread;
    spawnMissile(state, s.team, s.tier, s.x, s.y, a, damage, target, s.build.combo === 'splinter');
  }
  addSound(state, 'sfx.missile', s, s.tier);
}

function spawnMissile(
  state: GameState,
  team: Team,
  tier: number,
  x: number,
  y: number,
  angle: number,
  damage: number,
  target: Ship | null,
  splinter: boolean,
) {
  const Mi = CONFIG.missiles;
  spawnBullet(state, {
    team,
    kind: 'missile',
    sprite: 'projectile.missile',
    tier,
    x,
    y,
    vx: Math.cos(angle) * Mi.speed,
    vy: Math.sin(angle) * Mi.speed,
    life: Mi.life,
    damage,
    radius: 2 + tier,
    homing: Mi.turnRate,
    target,
    splinter,
  });
}

/** Missiles turn toward their target (or a new one, if theirs is gone). */
export function steerMissile(state: GameState, b: Bullet, dt: number) {
  if (!b.target || b.target.dead || b.target.merge) {
    let best: Ship | null = null;
    let bestD = 500 * 500;
    for (const s of state.ships) {
      if (s.team === b.team || s.dead || s.merge) continue;
      const d = distSq(b.x, b.y, s.x, s.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    b.target = best;
  }
  if (!b.target) return;
  const speed = Math.hypot(b.vx, b.vy);
  const now = Math.atan2(b.vy, b.vx);
  const want = Math.atan2(b.target.y - b.y, b.target.x - b.x);
  const turn = clamp(wrapAngle(want - now), -b.homing * dt, b.homing * dt);
  b.vx = Math.cos(now + turn) * speed;
  b.vy = Math.sin(now + turn) * speed;
}

/**
 * A shot hits a ship. A shield soaks up damage first; the rest comes off its
 * health. Shield combos fire back here, and Splinter missiles burst.
 */
export function hitShip(state: GameState, s: Ship, b: Bullet) {
  let damage = b.damage;
  if (s.shield > 0) {
    const absorbed = Math.min(s.shield, damage);
    s.shield -= absorbed;
    damage -= absorbed;
    const back = Math.atan2(-b.vy, -b.vx);
    if (s.shieldCombo === 'mirror' && !b.pierce) {
      // Mirror Guard: the blocked part of the shot bounces back.
      spawnBullet(state, { ...b, team: s.team, vx: -b.vx, vy: -b.vy, damage: absorbed, life: Math.max(b.life, 0.6), target: null });
    } else if (s.shieldCombo === 'retaliation' && s.retaliationTimer <= 0) {
      // Retaliation: a missile flies back, as strong as the blocked damage.
      s.retaliationTimer = CONFIG.combos.retaliationGap;
      spawnMissile(state, s.team, s.tier, s.x, s.y, back, absorbed, null, false);
    }
  }
  if (!(s.team === 'player' && state.invincible)) s.hp -= damage;
  if (s.hp <= 0) s.dead = true;
  if (b.splinter) {
    // Splinter Volley: small lances burst forward out of the missile.
    const C = CONFIG.combos;
    const dir = Math.atan2(b.vy, b.vx);
    for (let i = 0; i < C.splinterCount; i++) {
      const a = dir + (C.splinterCount === 1 ? 0 : (i / (C.splinterCount - 1) - 0.5) * 0.8);
      spawnBullet(state, {
        team: b.team,
        kind: 'lance',
        sprite: 'projectile.lance',
        tier: Math.max(1, b.tier - 1),
        x: b.x,
        y: b.y,
        vx: Math.cos(a) * 600,
        vy: Math.sin(a) * 600,
        life: 0.25,
        damage: b.damage * C.splinterDamage,
        radius: 2,
        pierce: [s.id],
      });
    }
    addEffect(state, 'vfx.hit', b.x, b.y, 0, b.tier);
  }
}
