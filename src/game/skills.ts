// Pilot skills: weapons (left click) and defences (right click), used from the
// ship you fly. Their damage and size grow with that ship's tier, and the
// fleet's damage bonus applies too. Elite enemies use the same skills, decided
// by simple rules (updateEliteSkills). Like world.ts, nothing is drawn here.

import { distSq, wrapAngle } from '../engine/math';
import { CONFIG, SKILLS, type SkillId, type SkillStat } from './config';
import {
  addEffect,
  addSound,
  controlledShip,
  damageShip,
  findNearestEnemy,
  type Controls,
  type GameState,
  type OwnedSkill,
  type Ship,
} from './world';

/** How long a laser beam stays on screen (it hits instantly). */
export const BEAM_SHOW_TIME = 0.3;

const COOLDOWNS: Record<SkillId, () => number> = {
  laser: () => CONFIG.laser.cooldown,
  missiles: () => CONFIG.missiles.cooldown,
  mines: () => CONFIG.mines.cooldown,
  shield: () => CONFIG.shield.cooldown,
  repulse: () => CONFIG.repulse.cooldown,
  freeze: () => CONFIG.freeze.cooldown,
};

/** Seconds between uses of a skill (shorter with "rate" upgrades and Capacitor equipment). */
export const cooldownOf = (state: GameState, sk: OwnedSkill) => COOLDOWNS[sk.id]() / (sk.mods.rate * state.bonus.skillRate);

export function updateSkills(state: GameState, c: Controls, dt: number) {
  // Shields fade; beams and mines age.
  for (const s of state.ships)
    if (s.shieldTime > 0) {
      s.shieldTime -= dt;
      if (s.shieldTime <= 0) s.shield = 0;
    }
  for (const b of state.beams) b.age += dt;
  state.beams = state.beams.filter((b) => b.age < BEAM_SHOW_TIME);
  updateMines(state, dt);

  for (const sk of state.skills) sk.timer = Math.max(0, sk.timer - dt);
  const ship = controlledShip(state);
  if (!ship || ship.merge) return;
  for (const sk of state.skills) {
    if (sk.timer > 0) continue;
    // Weapons fire while you hold left click; defences go off when you right-click.
    const weapon = SKILLS[sk.id].side === 'left';
    const wants = weapon ? c.fire : c.defend;
    // A frozen ship can't shoot, but defences still work.
    if (!wants || (weapon && ship.frozen > 0)) continue;
    sk.timer = cooldownOf(state, sk);
    USE[sk.id](state, ship, c, sk);
  }
}

/**
 * Skill damage: grows with the ship's tier. Yours gets the fleet's damage bonus;
 * an elite's is scaled by CONFIG.elite.skillDamage.
 */
const powerOf = (state: GameState, ship: Ship) =>
  CONFIG.tiers.powerPerTier ** (ship.tier - 1) * (ship.team === 'player' ? state.bonus.damage : CONFIG.elite.skillDamage);

type Use = (state: GameState, ship: Ship, c: Controls, sk: OwnedSkill) => void;

const USE: Record<SkillId, Use> = {
  laser: (state, ship, _c, sk) => fireLaser(state, ship, sk),
  missiles: (state, ship, c, sk) => launchMissiles(state, ship, c, sk),
  mines: (state, ship, _c, sk) => dropMine(state, ship, sk),
  shield: (state, ship, _c, sk) => raiseShield(state, ship, sk),
  repulse: (state, ship, _c, sk) => repulse(state, ship, sk),
  freeze: (state, ship, _c, sk) => freeze(state, ship, sk),
};

/** Laser: everything along the beam in front of you takes damage at once. */
function fireLaser(state: GameState, ship: Ship, sk: OwnedSkill) {
  const L = CONFIG.laser;
  const a = ship.angle;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const x0 = ship.x + dx * ship.stats.gunOffset;
  const y0 = ship.y + dy * ship.stats.gunOffset;
  const length = laserLength(ship, sk);
  const halfWidth = (L.width * ship.stats.size * sk.mods.size) / 2;
  const damage = L.damage * powerOf(state, ship) * sk.mods.power;
  for (const s of state.ships) {
    if (s.team === ship.team || s.dead || s.merge) continue;
    // How far along the beam the ship is, and how far to the side of it.
    const along = (s.x - x0) * dx + (s.y - y0) * dy;
    const side = Math.abs((s.x - x0) * dy - (s.y - y0) * dx);
    if (along < -s.stats.radius || along > length + s.stats.radius || side > s.stats.radius + halfWidth) continue;
    damageShip(state, s, damage);
    addEffect(state, 'vfx.hit', s.x, s.y, 0, ship.tier + 1);
  }
  state.beams.push({ team: ship.team, tier: ship.tier, x: x0, y: y0, angle: a, length, width: sk.mods.size, age: 0 });
  addSound(state, 'sfx.laser', ship, ship.tier);
}

/** How far a ship's laser reaches. */
export const laserLength = (ship: Ship, sk: OwnedSkill) => CONFIG.laser.length * CONFIG.tiers.rangePerTier ** (ship.tier - 1) * sk.mods.size;

/** Missiles: a fan of homing missiles, aimed at the enemy nearest your cursor. */
function launchMissiles(state: GameState, ship: Ship, c: Controls, sk: OwnedSkill) {
  const M = CONFIG.missiles;
  // "Size" upgrades add missiles.
  const count = Math.max(1, Math.round(M.count * sk.mods.size));
  const target = nearestEnemyTo(state, ship.team, c.aimX, c.aimY, 300) ?? nearestEnemyTo(state, ship.team, ship.x, ship.y, Infinity);
  const damage = M.damage * powerOf(state, ship) * sk.mods.power;
  for (let i = 0; i < count; i++) {
    // Fan out to the sides first, then curve in toward the target.
    const a = ship.angle + (count === 1 ? 0 : (i / (count - 1) - 0.5) * 2.2);
    state.bullets.push({
      team: ship.team,
      sprite: 'projectile.missile',
      tier: ship.tier,
      x: ship.x,
      y: ship.y,
      vx: Math.cos(a) * M.speed,
      vy: Math.sin(a) * M.speed,
      life: M.life,
      damage,
      radius: 2 * ship.stats.size,
      homing: M.turnRate,
      target,
    });
  }
  addSound(state, 'sfx.missile', ship, ship.tier);
}

function nearestEnemyTo(state: GameState, team: string, x: number, y: number, maxDist: number): Ship | null {
  let best: Ship | null = null;
  let bestD = maxDist * maxDist;
  for (const s of state.ships) {
    if (s.team === team || s.dead || s.merge) continue;
    const d = distSq(x, y, s.x, s.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Mines: one is left behind your ship. */
function dropMine(state: GameState, ship: Ship, sk: OwnedSkill) {
  const M = CONFIG.mines;
  const size = ship.stats.size * sk.mods.size;
  state.mines.push({
    team: ship.team,
    tier: ship.tier,
    x: ship.x - Math.cos(ship.angle) * ship.stats.radius,
    y: ship.y - Math.sin(ship.angle) * ship.stats.radius,
    age: 0,
    damage: M.damage * powerOf(state, ship) * sk.mods.power,
    triggerRadius: M.triggerRadius * size,
    blastRadius: M.blastRadius * size,
    scale: sk.mods.size,
  });
  addSound(state, 'sfx.mine', ship, ship.tier);
}

/** Mines go off when an enemy comes near (once armed), or fizzle out after a while. */
function updateMines(state: GameState, dt: number) {
  const M = CONFIG.mines;
  for (const m of state.mines) {
    m.age += dt;
    if (m.age < M.armTime) continue;
    const near = state.ships.some(
      (s) => s.team !== m.team && !s.dead && !s.merge && distSq(s.x, s.y, m.x, m.y) < (m.triggerRadius + s.stats.radius) ** 2,
    );
    if (!near) continue;
    for (const s of state.ships) {
      if (s.team === m.team || s.dead || s.merge) continue;
      if (distSq(s.x, s.y, m.x, m.y) < (m.blastRadius + s.stats.radius) ** 2) damageShip(state, s, m.damage);
    }
    addEffect(state, 'vfx.mine-blast', m.x, m.y, 0, m.tier, m.scale);
    addSound(state, 'sfx.mine-blast', m, m.tier);
    m.age = Infinity; // gone
  }
  state.mines = state.mines.filter((m) => m.age < M.life);
}

/** Shield: you and ships of your fleet near you get a bubble that soaks up damage. */
function raiseShield(state: GameState, ship: Ship, sk: OwnedSkill) {
  const S = CONFIG.shield;
  // Shields match the ship's health: yours get the player health bonus, an elite's its extra health.
  const hpMul = ship.team === 'player' ? CONFIG.playerHpMultiplier : ship.elite ? CONFIG.elite.healthMultiplier : 1;
  const amount = S.amount * powerOf(state, ship) * hpMul * sk.mods.power;
  const radius = S.radius * ship.stats.size * sk.mods.size;
  for (const s of ship.fleet.members) {
    if (s.dead || s.merge) continue;
    if (s !== ship && distSq(s.x, s.y, ship.x, ship.y) > radius * radius) continue;
    s.shield = Math.max(s.shield, amount);
    s.shieldTime = S.duration;
  }
  addSound(state, 'sfx.shield', ship, ship.tier);
}

/** Repulse: a shockwave that shoves enemies away, hurts them a little and wipes out their shots. */
function repulse(state: GameState, ship: Ship, sk: OwnedSkill) {
  const R = CONFIG.repulse;
  const radius = R.radius * ship.stats.size * sk.mods.size;
  const damage = R.damage * powerOf(state, ship) * sk.mods.power;
  for (const s of state.ships) {
    if (s.team === ship.team || s.dead || s.merge) continue;
    const d = Math.sqrt(distSq(s.x, s.y, ship.x, ship.y));
    if (d > radius + s.stats.radius) continue;
    const a = d > 0 ? Math.atan2(s.y - ship.y, s.x - ship.x) : wrapAngle(ship.angle);
    s.vx += Math.cos(a) * R.push * sk.mods.power;
    s.vy += Math.sin(a) * R.push * sk.mods.power;
    damageShip(state, s, damage);
  }
  state.bullets = state.bullets.filter((b) => b.team === ship.team || distSq(b.x, b.y, ship.x, ship.y) > radius * radius);
  addEffect(state, 'vfx.repulse', ship.x, ship.y, 0, ship.tier, sk.mods.size);
  addSound(state, 'sfx.repulse', ship, ship.tier);
}

/** Freeze: enemies in a cone in front of you stop moving, turning and shooting for a while. */
function freeze(state: GameState, ship: Ship, sk: OwnedSkill) {
  const F = CONFIG.freeze;
  const length = F.length * ship.stats.size * sk.mods.size;
  const half = ((F.angle * Math.PI) / 180) * Math.min(2, sk.mods.size);
  const duration = F.duration * sk.mods.power;
  for (const s of state.ships) {
    if (s.team === ship.team || s.dead || s.merge) continue;
    const d = Math.sqrt(distSq(s.x, s.y, ship.x, ship.y));
    if (d > length + s.stats.radius) continue;
    const off = Math.abs(wrapAngle(Math.atan2(s.y - ship.y, s.x - ship.x) - ship.angle));
    // Ships right next to you count even if their centre is just outside the cone.
    if (off > half + Math.atan2(s.stats.radius, Math.max(d, 1))) continue;
    s.frozen = Math.max(s.frozen, duration);
  }
  addEffect(state, 'vfx.freeze', ship.x, ship.y, ship.angle, ship.tier, sk.mods.size);
  addSound(state, 'sfx.freeze', ship, ship.tier);
}

// ---------- Elite enemies ----------

const STATS: SkillStat[] = ['power', 'rate', 'size'];

/**
 * Skills for the elite number `index` (0 = the first of the run): random and
 * all different, one more each elite up to the maximum, and from
 * CONFIG.elite.rankUpFrom on each elite's skills are a rank higher.
 */
export function makeEliteSkills(index: number): OwnedSkill[] {
  const E = CONFIG.elite;
  const ids = (Object.keys(SKILLS) as SkillId[]).sort(() => Math.random() - 0.5);
  const count = Math.min(E.maxSkills, E.firstSkills + index, ids.length);
  const rank = Math.min(CONFIG.cards.maxRank, 1 + Math.max(0, index + 2 - E.rankUpFrom));
  return ids.slice(0, count).map((id) => {
    const sk: OwnedSkill = { id, rank, timer: 0, mods: { power: 1, rate: 1, size: 1 } };
    for (let r = 1; r < rank; r++) sk.mods[STATS[Math.floor(Math.random() * STATS.length)]] += E.rankBonus;
    // Start part-way through a cooldown, so an elite doesn't use everything the moment it arrives.
    sk.timer = Math.random() * eliteCooldown(sk);
    return sk;
  });
}

const eliteCooldown = (sk: OwnedSkill) => (COOLDOWNS[sk.id]() / sk.mods.rate) * CONFIG.elite.cooldownMultiplier;

/** Elites use their skills when it makes sense: weapons when you're in front and in reach, defences when hurt or crowded. */
export function updateEliteSkills(state: GameState, dt: number) {
  for (const ship of state.ships) {
    const e = ship.elite;
    if (!e || ship.dead || ship.merge) continue;
    for (const sk of e.skills) sk.timer = Math.max(0, sk.timer - dt);
    // Frozen: can't shoot, and a laser that was charging fizzles.
    if (ship.frozen > 0) {
      e.laserCharge = 0;
      continue;
    }
    // The laser fires when its warning line runs out. Nothing else happens meanwhile.
    if (e.laserCharge > 0) {
      e.laserCharge -= dt;
      const laser = e.skills.find((sk) => sk.id === 'laser');
      if (e.laserCharge <= 0 && laser) fireLaser(state, ship, laser);
      continue;
    }
    const target = findNearestEnemy(state, ship, Infinity);
    if (!target) continue;
    for (const sk of e.skills) {
      if (sk.timer > 0 || !eliteWants(state, ship, sk, target)) continue;
      sk.timer = eliteCooldown(sk);
      if (sk.id === 'laser') {
        e.laserCharge = CONFIG.elite.laserWarning;
        break;
      }
      const aim: Controls = { moveX: 0, moveY: 0, aimX: target.x, aimY: target.y, fire: false, boost: false, dash: false, defend: false };
      USE[sk.id](state, ship, aim, sk);
    }
  }
}

/** Whether an elite should use this skill now, against its nearest target. */
function eliteWants(state: GameState, ship: Ship, sk: OwnedSkill, target: Ship) {
  const d = Math.sqrt(distSq(ship.x, ship.y, target.x, target.y));
  // How far the target is from where the elite faces (radians).
  const off = Math.abs(wrapAngle(Math.atan2(target.y - ship.y, target.x - ship.x) - ship.angle));
  switch (sk.id) {
    case 'laser':
      return off < 0.12 && d < laserLength(ship, sk);
    case 'missiles':
      return d < CONFIG.missiles.speed * CONFIG.missiles.life * 0.6;
    case 'mines':
      return d < 200 * ship.stats.size;
    case 'shield':
      return ship.shield <= 0 && ship.hp < ship.stats.maxHp * 0.9;
    case 'repulse': {
      const r = CONFIG.repulse.radius * ship.stats.size * sk.mods.size;
      const shots = state.bullets.filter((b) => b.team !== ship.team && distSq(b.x, b.y, ship.x, ship.y) < r * r).length;
      return d < r * 0.8 || shots >= 4;
    }
    case 'freeze': {
      const half = ((CONFIG.freeze.angle * Math.PI) / 180) * Math.min(2, sk.mods.size);
      return off < half && d < CONFIG.freeze.length * ship.stats.size * sk.mods.size;
    }
  }
}
