// The "average player" bot: how it flies, shoots, defends and picks cards. Its habits are the
// numbers in PILOT below; the report shows them, so everyone can see what "average" means here.
// It plays the real game rules (src/game/world.ts) through the same controls a player has.

import { CONFIG, SKILLS, type SkillId } from '../../src/game/config';
import { controlledShip, tierValue, type Card, type Controls, type GameState, type Ship } from '../../src/game/world';
import { replacedBy } from '../../src/game/progress';

/** The average player's habits. */
export const PILOT = {
  /** Reaction time: it looks at the situation and changes its plan this often (seconds). */
  thinkEvery: 0.2,
  /** Aim wobble: each look, its aim is off by up to this many degrees (it doesn't lead moving targets either). */
  aimErrorDeg: 6,
  /** Auto-fire is always on (Q), as most players do. */
  autoFire: true,
  /** It likes to fight at about this distance from the nearest enemy, moving in or backing off around it. */
  fightDistance: 260,
  /** Wrecks and loot within this distance are worth going for (if it's not too dangerous there). */
  pickupRange: 900,
  /** It backs off (boosting) when the enemies near it are worth more than this × its own fleet. */
  fleeAtValue: 1.5,
  /** ...or when the ship it flies is below this share of its health. */
  fleeAtHealth: 0.35,
  /** It uses its defence when this many enemies are within 250 px, or this many enemy shots within 150 px, or its health is below 50%. */
  defendEnemies: 3,
  defendShots: 3,
  /** It dashes away when its health is below this share and enemies are close. */
  dashAtHealth: 0.3,
  /** Cards: chance it just picks one at random instead of by its preferences (not every choice is a good one). */
  randomCardChance: 0.25,
  /** Cards: it wants this many passives at most. */
  wantPassives: 2,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** A forced build: the run starts with this skill, and the bot never takes another skill of its side. */
export type Forced = SkillId | null;

export class Pilot {
  private thinkIn = 0;
  private plan: Controls = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: true, boost: false, dash: false, defend: false };
  private holdDefend = 0;
  private strafe = Math.random() < 0.5 ? 1 : -1;
  /** What it did, for the report (seconds spent in each mode). */
  modes: Record<string, number> = {};

  constructor(private forced: Forced) {}

  controls(state: GameState, dt: number): Controls {
    const me = controlledShip(state);
    if (!me) return { ...this.plan, fire: false, dash: false, defend: false };
    this.thinkIn -= dt;
    if (this.thinkIn <= 0) {
      this.thinkIn = PILOT.thinkEvery;
      this.think(state, me);
    }
    this.holdDefend -= dt;
    const out = { ...this.plan, defendHeld: this.holdDefend > 0 };
    // One-off presses only on the step it decided them.
    this.plan.dash = false;
    this.plan.defend = false;
    return out;
  }

  private think(state: GameState, me: Ship) {
    const enemies = state.ships.filter((s) => s.team === 'enemy' && !s.dead && !s.absorbed);
    let nearest: Ship | null = null;
    let nd = Infinity;
    for (const e of enemies) {
      const d = dist2(e, me);
      if (d < nd) {
        nd = d;
        nearest = e;
      }
    }
    const near = enemies.filter((e) => dist2(e, me) < 350 * 350);
    const close = enemies.filter((e) => dist2(e, me) < 250 * 250).length;
    const shots = state.bullets.filter((b) => b.team === 'enemy' && dist2(b, me) < 150 * 150).length;
    const myValue = state.playerFleet.members.reduce((v, s) => v + tierValue(s.tier), 0);
    const nearValue = near.reduce((v, e) => v + tierValue(e.tier), 0);
    const health = me.hp / me.stats.maxHp;

    // Aim: at the nearest enemy, a little off.
    const wobble = (rand(-1, 1) * PILOT.aimErrorDeg * Math.PI) / 180;
    if (nearest) {
      const a = Math.atan2(nearest.y - me.y, nearest.x - me.x) + wobble;
      const d = Math.sqrt(nd);
      this.plan.aimX = me.x + Math.cos(a) * d;
      this.plan.aimY = me.y + Math.sin(a) * d;
    } else {
      this.plan.aimX = me.x + Math.cos(me.angle) * 200;
      this.plan.aimY = me.y + Math.sin(me.angle) * 200;
    }
    this.plan.fire = PILOT.autoFire;

    // Defence.
    if (close >= PILOT.defendEnemies || shots >= PILOT.defendShots || health < 0.5) {
      this.plan.defend = true;
      this.holdDefend = 0.25; // Force Wall draws while held
    }

    // Where to go.
    const toward = (x: number, y: number, k = 1) => {
      const dx = x - me.x;
      const dy = y - me.y;
      const l = Math.hypot(dx, dy) || 1;
      this.plan.moveX = (dx / l) * k;
      this.plan.moveY = (dy / l) * k;
    };
    const centre = near.length
      ? { x: near.reduce((s, e) => s + e.x, 0) / near.length, y: near.reduce((s, e) => s + e.y, 0) / near.length }
      : null;
    // Is a spot safe enough to fly to? (no enemy bigger than its own fleet right next to it)
    const safe = (p: { x: number; y: number }) => !enemies.some((e) => dist2(e, p) < 180 * 180 && tierValue(e.tier) > myValue);
    let mode: string;
    if (centre && (health < PILOT.fleeAtHealth || nearValue > myValue * PILOT.fleeAtValue)) {
      mode = 'flee';
      toward(me.x - (centre.x - me.x), me.y - (centre.y - me.y));
      this.plan.boost = true;
      if (health < PILOT.dashAtHealth && close > 0) this.plan.dash = true;
    } else {
      this.plan.boost = false;
      const pick = (list: { x: number; y: number }[]) =>
        list.filter((p) => dist2(p, me) < PILOT.pickupRange ** 2 && safe(p)).sort((a, b) => dist2(a, me) - dist2(b, me))[0];
      const wreck = pick(state.wrecks);
      const loot = wreck ? undefined : pick(state.loot);
      const goal = wreck ?? loot;
      if (goal) {
        mode = wreck ? 'wreck' : 'loot';
        toward(goal.x, goal.y);
        this.plan.boost = dist2(goal, me) > 500 * 500 && !close;
      } else if (nearest) {
        mode = 'fight';
        const d = Math.sqrt(nd);
        const ax = (nearest.x - me.x) / d;
        const ay = (nearest.y - me.y) / d;
        // In and out around its favourite distance, circling the target.
        const radial = d > PILOT.fightDistance + 60 ? 1 : d < PILOT.fightDistance - 60 ? -1 : 0;
        if (Math.random() < 0.02) this.strafe = -this.strafe;
        this.plan.moveX = ax * radial - ay * this.strafe * 0.8;
        this.plan.moveY = ay * radial + ax * this.strafe * 0.8;
      } else {
        mode = 'cruise';
        const a = state.time * 0.2;
        this.plan.moveX = Math.cos(a) * 0.5;
        this.plan.moveY = Math.sin(a) * 0.5;
      }
    }
    this.modes[mode] = (this.modes[mode] ?? 0) + PILOT.thinkEvery;
  }

  /** Which offered card to take (index), the average player's way. */
  pickCard(state: GameState, cards: Card[]): number {
    const side = (id: SkillId) => SKILLS[id].side;
    const forcedSide = this.forced ? side(this.forced) : null;
    // Never a card that would replace one of its skills, nor another skill of the forced build's side.
    const allowed = cards.map((c) => !replacedBy(state, c) && !(c.kind === 'skill' && forcedSide && forcedSide !== 'passive' && side(c.skill) === forcedSide));
    const options = cards.map((_, i) => i).filter((i) => allowed[i]);
    if (!options.length) return 0;
    if (Math.random() < PILOT.randomCardChance) return options[Math.floor(Math.random() * options.length)];
    const owned = (s: 'left' | 'right' | 'passive') => state.skills.filter((k) => SKILLS[k.id].side === s).length;
    const me = controlledShip(state);
    const hurt = me ? me.hp / me.stats.maxHp < 0.5 : false;
    const score = (c: Card) => {
      if (c.kind === 'skill') {
        const s = side(c.skill);
        if (s === 'left') return owned('left') === 0 ? 100 : 5;
        if (s === 'right') return owned('right') === 0 ? 90 : 5;
        return owned('passive') < PILOT.wantPassives ? 60 : 10;
      }
      if (c.kind === 'rank') {
        const s = side(c.skill);
        return (s === 'left' ? 50 : s === 'right' ? 35 : 25) + 5 * ['common', 'uncommon', 'superior', 'rare', 'epic', 'legendary', 'mythic'].indexOf(c.rarity);
      }
      if (c.kind === 'repair') return hurt ? 70 : 5;
      return 30; // damage, fire rate
    };
    return options.sort((a, b) => score(cards[b]) - score(cards[a]))[0];
  }
}

/** Every skill switched on, by side (what the experiments compare). */
export function skillsBySide() {
  const out: Record<'left' | 'right' | 'passive', SkillId[]> = { left: [], right: [], passive: [] };
  for (const [id, sk] of Object.entries(SKILLS) as [SkillId, (typeof SKILLS)[SkillId]][]) if (sk.enabled) out[sk.side as 'left' | 'right' | 'passive'].push(id);
  return out;
}

export { CONFIG };
