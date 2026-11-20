// Pilot skills: weapons (left click) and defences (right click), used from the
// ship you fly. Their damage and size grow with that ship's tier, and the
// fleet's damage bonus applies too. Elite enemies use the same skills, decided
// by simple rules (updateEliteSkills). Like world.ts, nothing is drawn here.

import { rayHitsShip } from './hitShape';
import { distSq, randRange, wrapAngle } from '../engine/math';
import { CONFIG, SKILLS, enabledSkills, type SkillId, type SkillStat } from './config';
import { cannibalize, startTimeDilation, updateCrisisJump, updateForceDash, updatePdc } from './newSkills';
import {
  eliteWantsMore,
  fireArc,
  fireCrescent,
  fireGatling,
  fireIonCloud,
  firePlasmaLance,
  cloak,
  fireSplitBeam,
  forceWall,
  hijackPulse,
  launchPods,
  openGravityWell,
  sendScramble,
  tractorBeam,
  updateSkillObjects,
  wrecksplosion,
} from './moreSkills';
import { addMod, newMods, type SkillMods } from './upgrades';
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
  gatling: () => CONFIG.gatling.cooldown,
  crescent: () => CONFIG.crescent.cooldown,
  arcImpulse: () => CONFIG.arcImpulse.cooldown,
  ionCloud: () => CONFIG.ionCloud.cooldown,
  plasmaLance: () => CONFIG.plasmaLance.cooldown,
  splitBeam: () => CONFIG.splitBeam.cooldown,
  laserPods: () => CONFIG.laserPods.cooldown,
  gravityWell: () => CONFIG.gravityWell.cooldown,
  scramble: () => CONFIG.scramble.cooldown,
  wrecksplosion: () => CONFIG.wrecksplosion.cooldown,
  tractorBeam: () => CONFIG.tractorBeam.cooldown,
  forceWall: () => CONFIG.forceWall.cooldown,
  cloak: () => CONFIG.cloak.cooldown,
  hijack: () => CONFIG.hijack.cooldown,
  // Point Defense Cannons fire by themselves (their ammo is the meter); passives have no button.
  pdc: () => 0,
  cannibalize: () => CONFIG.cannibalize.cooldown,
  timeDilation: () => CONFIG.timeDilation.cooldown,
  forceDash: () => 0,
  crisisJump: () => CONFIG.crisisJump.cooldown,
  techScanner: () => 0,
  radar: () => 0,
};

/**
 * A skill's upgrades as used: its own (from rank-up cards), plus, for your
 * skills, those from Mythic equipment carrying a card bonus (state.skillBonus).
 */
export function modsOf(state: GameState, ship: Ship, sk: OwnedSkill): SkillMods {
  const extra = ship.team === 'player' ? state.skillBonus[sk.id] : undefined;
  if (!extra) return sk.mods;
  const m = { ...sk.mods };
  for (const [stat, amount] of Object.entries(extra) as [SkillStat, number][]) addMod(m, stat, amount);
  return m;
}

/** Seconds between uses of a skill (shorter with "rate" upgrades and Capacitor equipment). */
export const cooldownOf = (state: GameState, sk: OwnedSkill) => {
  const ship = controlledShip(state);
  const rate = ship ? modsOf(state, ship, sk).rate : sk.mods.rate;
  return COOLDOWNS[sk.id]() / (rate * state.bonus.skillRate);
};

/** Your weapon skills (left click), in the order you got them. */
export const weaponSkills = (state: GameState) => state.skills.filter((sk) => SKILLS[sk.id].side === 'left');

/** The weapon skill that's selected (the only one that fires), if you have any. */
export function activeWeaponSkill(state: GameState) {
  const list = weaponSkills(state);
  return list.length ? list[Math.min(state.activeWeapon, list.length - 1)] : undefined;
}

/** Select a weapon skill by its place (0 = first); `step` moves to the next/previous one, wrapping around. */
export function selectWeapon(state: GameState, index: number, step = false) {
  const n = weaponSkills(state).length;
  if (!n) return;
  if (step) state.activeWeapon = (((Math.min(state.activeWeapon, n - 1) + index) % n) + n) % n;
  else if (index >= 0 && index < n) state.activeWeapon = index;
}

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
  updateSkillObjects(state, dt, c);

  for (const sk of state.skills) sk.timer = Math.max(0, sk.timer - dt);
  const ship = controlledShip(state);
  if (!ship || ship.merge) return;
  const active = activeWeaponSkill(state);
  for (const sk of state.skills) {
    if (sk.timer > 0) continue;
    // The selected weapon fires while you hold left click; defences all go off when you right-click.
    const weapon = SKILLS[sk.id].side === 'left';
    if (weapon && sk !== active) continue;
    const wants = weapon ? c.fire : c.defend;
    // A frozen ship can't shoot, but defences still work.
    if (!wants || (weapon && ship.frozen > 0)) continue;
    if (!SKILLS[sk.id].enabled || SKILLS[sk.id].side === 'passive' || sk.id === 'pdc') continue;
    sk.timer = cooldownOf(state, sk);
    // A skill with nothing to work on (no target in range...) stays ready.
    if (USE[sk.id](state, ship, c, sk) === false) sk.timer = 0;
    else state.stats.skillUses[sk.id] = (state.stats.skillUses[sk.id] ?? 0) + 1;
  }
  // Skills that work by themselves: Point Defense Cannons, Force Dash, Crisis Jump.
  updatePdc(state, dt);
  updateForceDash(state);
  updateCrisisJump(state);
}

/**
 * Skill damage: grows with the ship's tier. Yours gets the fleet's damage bonus;
 * an elite's is scaled by CONFIG.elite.skillDamage.
 */
export const powerOf = (state: GameState, ship: Ship) =>
  CONFIG.tiers.powerPerTier ** (ship.tier - 1) * (ship.team === 'player' ? state.bonus.damage : CONFIG.elite.skillDamage);

/** Uses a skill. Returning false means it found nothing to do, so it stays ready. */
type Use = (state: GameState, ship: Ship, c: Controls, sk: OwnedSkill) => boolean | void;

const USE: Record<SkillId, Use> = {
  laser: (state, ship, _c, sk) => fireLaser(state, ship, sk),
  missiles: (state, ship, c, sk) => launchMissiles(state, ship, c, sk),
  mines: (state, ship, _c, sk) => dropMine(state, ship, sk),
  shield: (state, ship, _c, sk) => raiseShield(state, ship, sk),
  repulse: (state, ship, _c, sk) => repulse(state, ship, sk),
  freeze: (state, ship, _c, sk) => freeze(state, ship, sk),
  gatling: fireGatling,
  crescent: fireCrescent,
  arcImpulse: fireArc,
  ionCloud: fireIonCloud,
  plasmaLance: (state, ship, _c, sk) => firePlasmaLance(state, ship, sk),
  splitBeam: fireSplitBeam,
  laserPods: (state, ship, _c, sk) => launchPods(state, ship, sk),
  gravityWell: openGravityWell,
  scramble: (state, ship, _c, sk) => sendScramble(state, ship, sk),
  wrecksplosion,
  tractorBeam,
  forceWall,
  cloak: (state, ship, _c, sk) => cloak(state, ship, sk),
  hijack: (state, ship, _c, sk) => hijackPulse(state, ship, sk),
  // These work by themselves (newSkills.ts), never from a click.
  pdc: () => false,
  cannibalize: (state, ship, _c, sk) => cannibalize(state, ship, sk),
  timeDilation: (state, ship, _c, sk) => startTimeDilation(state, ship, sk),
  forceDash: () => false,
  crisisJump: () => false,
  techScanner: () => false,
  radar: () => false,
};

/** Laser: everything along the beam in front of you takes damage at once. */
function fireLaser(state: GameState, ship: Ship, sk: OwnedSkill) {
  const L = CONFIG.laser;
  const a = ship.angle;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const x0 = ship.x + dx * ship.stats.gunOffset;
  const y0 = ship.y + dy * ship.stats.gunOffset;
  const mods = modsOf(state, ship, sk);
  const length = laserLength(ship, sk, mods);
  const halfWidth = (L.width * ship.stats.size * mods.size) / 2;
  const damage = L.damage * powerOf(state, ship) * mods.power;
  for (const s of state.ships) {
    if (s.team === ship.team || s.dead || s.merge) continue;
    // The beam (as wide as it's drawn) against the ship's hit shape, within the beam's length.
    const t = rayHitsShip(s, x0, y0, dx, dy, halfWidth);
    if (t === null || t > length) continue;
    // It goes right through: a scorched line across the hull from where it went in (damage.ts).
    damageShip(state, s, damage, 'laser', { x: x0 + dx * t, y: y0 + dy * t, vx: dx, vy: dy, through: true });
    addEffect(state, 'vfx.hit', s.x, s.y, 0, ship.tier + 1);
  }
  state.beams.push({ team: ship.team, tier: ship.tier, x: x0, y: y0, angle: a, length, width: mods.size, age: 0 });
  addSound(state, 'sfx.laser', ship, ship.tier);
}

/** How far a ship's laser reaches. */
export const laserLength = (ship: Ship, sk: OwnedSkill, mods = sk.mods) => CONFIG.laser.length * CONFIG.tiers.rangePerTier ** (ship.tier - 1) * mods.size;

/**
 * Missiles: a volley pushed out of the ship in a fan, up to
 * CONFIG.missiles.launchSpread either side of where it points (as if from tubes
 * around the ship); each then turns toward its target and speeds off. They're shared out across every target in range (see missileTargets):
 * one target gets them all, two get half each, more get one each.
 */
function launchMissiles(state: GameState, ship: Ship, c: Controls, sk: OwnedSkill) {
  const M = CONFIG.missiles;
  const mods = modsOf(state, ship, sk);
  // Quantity upgrades add whole missiles.
  const count = Math.max(1, M.count + Math.round(mods.count));
  const targets = missileTargets(state, ship, c.aimX, c.aimY);
  const damage = M.damage * powerOf(state, ship) * mods.power;
  const spread = (M.launchSpread * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    // Spread evenly across the fan (with a little jitter), each leaving from the ship's edge on its side.
    const a = ship.angle + (count === 1 ? 0 : (i / (count - 1) - 0.5) * 2 * spread) + randRange(-0.08, 0.08);
    const edge = ship.stats.radius * 0.7;
    state.bullets.push({
      team: ship.team,
      sprite: 'projectile.missile',
      source: 'missiles',
      tier: ship.tier,
      x: ship.x + Math.cos(a) * edge,
      y: ship.y + Math.sin(a) * edge,
      vx: ship.vx + Math.cos(a) * M.ejectSpeed,
      vy: ship.vy + Math.sin(a) * M.ejectSpeed,
      life: M.life,
      damage,
      radius: 2 * ship.stats.size,
      homing: M.turnRate,
      target: targets.length ? targets[i % targets.length] : null,
      facing: a,
      launchAngle: ship.angle,
      igniteAt: randRange(M.igniteMin, M.igniteMax),
    });
  }
  addSound(state, 'sfx.missile', ship, ship.tier);
}

/**
 * Enemies a volley can lock onto: within lockRange, inside the lockArc in
 * front of the ship, those closest to where you aim first.
 */
function missileTargets(state: GameState, ship: Ship, aimX: number, aimY: number): Ship[] {
  const M = CONFIG.missiles;
  const half = (M.lockArc * Math.PI) / 360;
  return state.ships
    .filter(
      (s) =>
        s.team !== ship.team &&
        !s.dead &&
        !s.merge &&
        !s.ghost &&
        distSq(s.x, s.y, ship.x, ship.y) <= M.lockRange ** 2 &&
        Math.abs(wrapAngle(Math.atan2(s.y - ship.y, s.x - ship.x) - ship.angle)) <= half,
    )
    .sort((a, b) => distSq(a.x, a.y, aimX, aimY) - distSq(b.x, b.y, aimX, aimY));
}

/** Mines: left behind your ship (more than one side by side, with quantity upgrades). */
function dropMine(state: GameState, ship: Ship, sk: OwnedSkill) {
  const M = CONFIG.mines;
  const mods = modsOf(state, ship, sk);
  const size = ship.stats.size * mods.size;
  const count = Math.max(1, M.count + Math.round(mods.count));
  // Side by side behind the ship, a blast apart so they don't all go off together.
  const sideX = -Math.sin(ship.angle);
  const sideY = Math.cos(ship.angle);
  const gap = M.blastRadius * size;
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * gap;
    state.mines.push({
      team: ship.team,
      tier: ship.tier,
      x: ship.x - Math.cos(ship.angle) * ship.stats.radius + sideX * off,
      y: ship.y - Math.sin(ship.angle) * ship.stats.radius + sideY * off,
      age: 0,
      damage: M.damage * powerOf(state, ship) * mods.power,
      triggerRadius: M.triggerRadius * size,
      blastRadius: M.blastRadius * size,
      scale: mods.size,
    });
  }
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
      if (distSq(s.x, s.y, m.x, m.y) < (m.blastRadius + s.stats.radius) ** 2) damageShip(state, s, m.damage, 'mines');
    }
    // The blast appears at the mine's Blast point (placed in ShipArt).
    addEffect(state, 'vfx.mine-blast', m.x, m.y, 0, m.tier, m.scale).at = { sprite: 'projectile.mine', tier: m.tier, angle: 0, point: 'blast' };
    addSound(state, 'sfx.mine-blast', m, m.tier);
    m.age = Infinity; // gone
  }
  state.mines = state.mines.filter((m) => m.age < M.life);
}

/** Shield: you and ships of your fleet near you get a bubble that soaks up damage. */
function raiseShield(state: GameState, ship: Ship, sk: OwnedSkill) {
  const S = CONFIG.shield;
  // Shields match the ship's health: yours get the player health bonus, an elite's its extra health.
  const hpMul = ship.team === 'player' ? CONFIG.playerHpMultiplier : ship.elite ? ship.elite.healthScale : 1;
  const mods = modsOf(state, ship, sk);
  const amount = S.amount * powerOf(state, ship) * hpMul * mods.power;
  const radius = S.radius * ship.stats.size * mods.size;
  for (const s of ship.fleet.members) {
    if (s.dead || s.merge) continue;
    if (s !== ship && distSq(s.x, s.y, ship.x, ship.y) > radius * radius) continue;
    s.shield = Math.max(s.shield, amount);
    s.shieldTime = S.duration;
  }
  addSound(state, 'sfx.shield', ship, ship.tier);
}

/** Repulse: a shockwave that shoves enemies away and wipes out their shots. It does no damage. */
function repulse(state: GameState, ship: Ship, sk: OwnedSkill) {
  const R = CONFIG.repulse;
  const mods = modsOf(state, ship, sk);
  const radius = R.radius * ship.stats.size * mods.size;
  for (const s of state.ships) {
    // A Leviathan is never pushed (it always swims on).
    if (s.team === ship.team || s.dead || s.merge || s.leviathan) continue;
    const d = Math.sqrt(distSq(s.x, s.y, ship.x, ship.y));
    if (d > radius + s.stats.radius) continue;
    const a = d > 0 ? Math.atan2(s.y - ship.y, s.x - ship.x) : wrapAngle(ship.angle);
    s.vx += Math.cos(a) * R.push * mods.power;
    s.vy += Math.sin(a) * R.push * mods.power;
  }
  state.bullets = state.bullets.filter((b) => b.team === ship.team || distSq(b.x, b.y, ship.x, ship.y) > radius * radius);
  addEffect(state, 'vfx.repulse', ship.x, ship.y, 0, ship.tier, mods.size);
  addSound(state, 'sfx.repulse', ship, ship.tier);
}

/** Freeze: enemies in a cone in front of you stop moving, turning and shooting for a while. */
function freeze(state: GameState, ship: Ship, sk: OwnedSkill) {
  const F = CONFIG.freeze;
  const mods = modsOf(state, ship, sk);
  const length = freezeLength(ship, mods);
  const half = ((F.angle * Math.PI) / 180) * Math.min(2, mods.size);
  const duration = F.duration * mods.power;
  for (const s of state.ships) {
    if (s.team === ship.team || s.dead || s.merge) continue;
    const d = Math.sqrt(distSq(s.x, s.y, ship.x, ship.y));
    if (d > length + s.stats.radius) continue;
    const off = Math.abs(wrapAngle(Math.atan2(s.y - ship.y, s.x - ship.x) - ship.angle));
    // Ships right next to you count even if their centre is just outside the cone.
    if (off > half + Math.atan2(s.stats.radius, Math.max(d, 1))) continue;
    s.frozen = Math.max(s.frozen, duration);
  }
  // The cone art grows with size and range upgrades.
  addEffect(state, 'vfx.freeze', ship.x, ship.y, ship.angle, ship.tier, mods.size * mods.reach);
  addSound(state, 'sfx.freeze', ship, ship.tier);
}

/** How far Freeze reaches: grows with ship size, size upgrades, and range upgrades (×1.2 each). */
const freezeLength = (ship: Ship, mods: SkillMods) => CONFIG.freeze.length * ship.stats.size * mods.size * mods.reach;

// ---------- Elite enemies ----------


/**
 * Skills for the elite number `index` (0 = the first of the run): random and
 * all different, one more each elite up to the maximum, and from
 * CONFIG.elite.rankUpFrom on each elite's skills are a rank higher.
 */
export function makeEliteSkills(index: number): OwnedSkill[] {
  const E = CONFIG.elite;
  // Skills marked `elites: false` (and passives) are yours only.
  const ids = enabledSkills()
    .filter((id) => SKILLS[id].side !== 'passive' && !('elites' in SKILLS[id] && SKILLS[id].elites === false))
    .sort(() => Math.random() - 0.5);
  const count = Math.min(E.maxSkills, E.firstSkills + index, ids.length);
  const rank = Math.min(CONFIG.cards.maxRank, 1 + Math.max(0, index + 2 - E.rankUpFrom));
  return ids.slice(0, count).map((id) => {
    const sk: OwnedSkill = { id, rank, timer: 0, mods: newMods() };
    // Each rank improves one of the skill's own stats (quantity by one whole missile or mine).
    const stats = Object.keys(SKILLS[id].stats) as SkillStat[];
    for (let r = 1; r < rank; r++) {
      const stat = stats[Math.floor(Math.random() * stats.length)];
      addMod(sk.mods, stat, stat === 'count' ? 1 : E.rankBonus);
    }
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
    // Frozen or scrambled: can't use skills, and a laser that was charging fizzles.
    if (ship.frozen > 0 || ship.scrambled > 0) {
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
      if (!SKILLS[sk.id].enabled) continue;
      sk.timer = eliteCooldown(sk);
      if (sk.id === 'laser') {
        e.laserCharge = CONFIG.elite.laserWarning;
        break;
      }
      const aim: Controls = { moveX: 0, moveY: 0, aimX: target.x, aimY: target.y, fire: false, boost: false, dash: false, defend: false };
      if (USE[sk.id](state, ship, aim, sk) === false) sk.timer = 0;
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
      // Close enough to be on screen, so you see them coming.
      return d < 450;
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
      return off < half && d < freezeLength(ship, sk.mods);
    }
    default:
      return eliteWantsMore(ship, sk, d, off);
  }
}
