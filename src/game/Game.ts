// Connects everything: input -> game rules -> drawing, plus info for the on-screen HUD.

import { spriteDuration, type Assets } from '../engine/assets';
import { Input } from '../engine/input';
import { startLoop } from '../engine/loop';
import { PixelRenderer } from '../engine/renderer';
import type { Sounds } from '../engine/sound';
import { clamp } from '../engine/math';
import { renderGame, tierSprite } from './render';
import { CONFIG, ITEM_STATS, SKILLS, type ItemStat, type SkillId } from './config';
import { xpToNextLevel } from './curves';
import { describeCard, gainXp, pickCard, testGiveAllSkills, type CardInfo } from './progress';
import { describeItem, equip, rollItem, slotCount, unequip, type Item } from './equipment';
import { cooldownOf } from './skills';
import {
  controlledShip,
  createGame,
  fleetValue,
  testAddShips,
  testDestroyFleet,
  testKillEnemies,
  testRemoveShip,
  updateGame,
  type Controls,
  type GameState,
  type HistoryPoint,
  type RunStats,
  type SoundEvent,
} from './world';

/**
 * Test keys work on the dev server (`npm run dev`), and in a build made with
 * VITE_TEST_KEYS=true (the online GitHub Pages version sets this).
 */
export const TEST_KEYS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_TEST_KEYS === 'true';

/** Numbers shown on screen by React. */
export interface HudInfo {
  /** Fleet value: what all your ships are worth in tier-1 ships. */
  fleetSize: number;
  /** How many ships of each tier, biggest first, e.g. "1×T3 2×T2 12×T1". */
  fleetMix: string;
  maxFleetSize: number;
  wave: number;
  /** Seconds survived (stops at game over). */
  time: number;
  gameOver: boolean;
  paused: boolean;
  /** Seconds until the dash is ready (0 = ready). */
  dashCooldown: number;
  level: number;
  /** XP toward the next level, and how much it needs. */
  xp: number;
  xpNext: number;
  /** Your skills and seconds until each is ready. */
  skills: { id: SkillId; name: string; side: 'left' | 'right'; icon: string; rank: number; cooldown: number; total: number }[];
  /** Level-up cards on offer (the game is paused meanwhile), or null. */
  cards: CardInfo[] | null;
  /** Your equipment (only sent while paused, for the equipment screen). */
  equipment: EquipmentInfo | null;
  /** The item you just picked up (shown for a few seconds), or null. */
  found: ItemInfo | null;
  stats: RunStats;
  /** Fleet value at each wave start, for the end-of-run graph. */
  history: HistoryPoint[];
  invincible: boolean;
  soundOn: boolean;
  /** Frames drawn per second (averaged over half a second). */
  fps: number;
  assetProblems: string[];
}

/** One item, as shown on screen. */
export interface ItemInfo {
  id: number;
  name: string;
  bonus: string;
  icon: string;
  color: string;
  equipped: boolean;
}

/** What the equipment screen shows. */
export interface EquipmentInfo {
  slots: number;
  equipped: ItemInfo[];
  /** Items not equipped, best rarity first. */
  inventory: ItemInfo[];
  /** Your fleet's total bonuses from cards and equipment, e.g. "+12% damage". */
  totals: string[];
  /** Slots you get from your next tier, and which tier that is. */
  next: { tier: number; slots: number };
}

export class Game {
  private state: GameState;
  private renderer: PixelRenderer;
  private input: Input;
  private assets: Assets;
  private sounds: Sounds;
  private onHud: (hud: HudInfo) => void;
  private stopLoop: (() => void) | null = null;
  private hudTimer = 0;
  private fps = 0;
  private fpsFrames = 0;
  private fpsStart = performance.now();
  private paused = false;
  /** While paused the picture doesn't change, so it's only drawn again when needed. */
  private needsDraw = true;
  private onResize = () => {
    this.renderer.resize();
    this.needsDraw = true;
  };
  /** Pause by itself when you click another window or switch tabs. */
  private onBlur = () => this.setPaused(true);
  private onVisibility = () => {
    if (document.hidden) this.setPaused(true);
  };

  constructor(canvas: HTMLCanvasElement, assets: Assets, sounds: Sounds, onHud: (hud: HudInfo) => void) {
    this.assets = assets;
    this.sounds = sounds;
    this.onHud = onHud;
    this.renderer = new PixelRenderer(canvas);
    this.input = new Input(canvas);
    this.state = this.newState();
  }

  private newState() {
    const state = createGame((name, tier) => spriteDuration(this.assets.get(tierSprite(this.assets, name, tier))));
    this.renderer.setZoom(state.zoom, true);
    return state;
  }

  start() {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.stopLoop = startLoop(
      (dt) => this.update(dt),
      (frameDt) => this.render(frameDt),
    );
  }

  stop() {
    this.stopLoop?.();
    this.input.destroy();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  restart() {
    this.state = this.newState();
    this.paused = false;
  }

  /** Pause or resume (Esc, the Resume button, or automatically when the window loses focus). */
  setPaused(paused: boolean) {
    // Level-up cards already stop the game.
    if (this.state.gameOver || this.state.cards) paused = false;
    this.paused = paused;
    this.needsDraw = true;
  }

  /** Draw one sprite from the manifest (first frame) into a small HUD canvas, enlarged crisply. */
  drawIcon(canvas: HTMLCanvasElement, name: string) {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.assets.has(name)) return;
    const f = this.assets.get(name).frames[0];
    const scale = Math.max(1, Math.floor(Math.min(canvas.width / f.w, canvas.height / f.h)));
    const w = f.w * scale;
    const h = f.h * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }

  /** Equipment screen: put an inventory item into a free slot. */
  equipItem(id: number) {
    equip(this.state, id);
    this.sendHud();
  }

  /** Equipment screen: take an item out of its slot. */
  unequipItem(id: number) {
    unequip(this.state, id);
    this.sendHud();
  }

  /** Take level-up card number `index` (click, or keys 1–3). */
  pickCard(index: number) {
    pickCard(this.state, index);
    this.playQueuedSounds();
    this.needsDraw = true;
    this.sendHud();
  }

  /** Switch sound on/off (M key or the speaker button). */
  toggleSound() {
    this.sounds.toggle();
  }

  private readControls(): Controls {
    const i = this.input;
    const aim = this.renderer.screenToWorld(i.mouseX, i.mouseY);
    return {
      moveX: (i.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (i.isDown('KeyA', 'ArrowLeft') ? 1 : 0),
      moveY: (i.isDown('KeyS', 'ArrowDown') ? 1 : 0) - (i.isDown('KeyW', 'ArrowUp') ? 1 : 0),
      aimX: aim.x,
      aimY: aim.y,
      fire: i.mouseDown,
      boost: i.isDown('ShiftLeft', 'ShiftRight'),
      dash: i.wasPressed('Space'),
      defend: i.wasPressed('MouseRight'),
    };
  }

  private update(dt: number) {
    const i = this.input;
    if (this.state.gameOver && i.isDown('KeyR')) this.restart();
    if (i.wasPressed('KeyM')) this.toggleSound();
    if (i.wasPressed('Escape')) this.setPaused(!this.paused);
    // Level-up cards: pick with 1, 2 or 3 (or a click).
    const cards = this.state.cards;
    if (cards && !this.paused) {
      const n = cards.findIndex((_, k) => i.wasPressed(`Digit${k + 1}`));
      if (n >= 0) this.pickCard(n);
    }
    if (this.paused || this.state.cards) {
      // Ignore one-off presses made while the game is stopped.
      i.wasPressed('Space');
      i.wasPressed('MouseRight');
      return;
    }
    if (TEST_KEYS_ENABLED) this.handleTestKeys();
    // Spawn enemies a bit outside the visible area.
    const spawnDistance = Math.hypot(this.renderer.viewWidth, this.renderer.viewHeight) / 2 + CONFIG.spawnMargin;
    updateGame(this.state, this.readControls(), dt, spawnDistance);
    this.playQueuedSounds();
    // A level-up stops the game until a card is picked: send the cards to the screen now.
    if (this.state.cards) this.sendHud();
  }

  private playQueuedSounds() {
    for (const e of this.state.sounds) this.playSound(e);
    this.state.sounds.length = 0;
  }

  /**
   * Play a sound the rules announced. Sounds near the middle of the screen
   * are loudest; off-screen ones fade out, and they pan left/right.
   */
  private playSound(e: SoundEvent) {
    const a = CONFIG.audio;
    let volume = e.volume;
    let pan = 0;
    if (!e.global) {
      const r = this.renderer;
      const halfW = r.viewWidth / 2;
      const halfH = r.viewHeight / 2;
      const dx = (e.x - r.camX) / halfW;
      const dy = (e.y - r.camY) / halfH;
      const far = Math.max(Math.abs(dx), Math.abs(dy)); // 1 = screen edge
      if (far > 1) volume *= clamp(1 - (far - 1) / (a.silentAt - 1), 0, 1);
      pan = clamp(dx, -1, 1) * a.panAmount;
    }
    if (volume <= 0) return;
    // Use the tier's own sound if there is one. Otherwise a smaller tier's, played
    // lower (or higher, if the manifest gives that sound its own pitchPerTier).
    for (let t = e.tier; t >= 1; t--) {
      const name = t === 1 ? e.name : `${e.name}.t${t}`;
      if (t > 1 && !this.sounds.has(name)) continue;
      const perTier = this.sounds.pitchPerTier(name) ?? a.pitchPerTier;
      this.sounds.play(name, { volume, pan, pitch: perTier ** (e.tier - t) });
      return;
    }
  }

  private handleTestKeys() {
    const i = this.input;
    const s = this.state;
    if (s.gameOver) return;
    if (i.wasPressed('Equal', 'NumpadAdd')) testAddShips(s, 1);
    if (i.wasPressed('BracketRight')) testAddShips(s, 16);
    if (i.wasPressed('Minus', 'NumpadSubtract')) testRemoveShip(s);
    if (i.wasPressed('KeyG')) s.invincible = !s.invincible;
    if (i.wasPressed('KeyK')) testKillEnemies(s, this.renderer.view);
    if (i.wasPressed('KeyL')) gainXp(s, xpToNextLevel(s.level) - s.xp);
    if (i.wasPressed('KeyJ')) testGiveAllSkills(s);
    if (i.wasPressed('KeyI')) {
      // Drop 3 random items right next to you.
      const f = controlledShip(s);
      if (f) for (let n = 0; n < 3; n++) s.loot.push({ item: rollItem(s), x: f.x + 60 + n * 25, y: f.y - 40, vx: 0, vy: 0, life: 40 });
    }
    if (i.wasPressed('KeyX')) testDestroyFleet(s);
  }

  private render(frameDt: number) {
    const r = this.renderer;
    const ship = controlledShip(this.state);
    if (ship) {
      // Camera smoothly follows the ship you're flying.
      const k = Math.min(1, frameDt * 8);
      r.camX += (ship.x - r.camX) * k;
      r.camY += (ship.y - r.camY) * k;
    }
    r.setZoom(this.state.zoom);
    const frozen = this.paused || this.state.cards !== null;
    if (!frozen || this.needsDraw) {
      r.begin(frozen ? 0 : frameDt);
      renderGame(this.state, r, this.assets);
      r.end();
      this.needsDraw = false;
    }

    // Count frames drawn; work out frames per second every half second (real clock time).
    this.fpsFrames++;
    const now = performance.now();
    if (now - this.fpsStart >= 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsStart));
      this.fpsFrames = 0;
      this.fpsStart = now;
    }

    // Update the HUD about 10 times a second (React doesn't need every frame).
    this.hudTimer -= frameDt;
    if (this.hudTimer <= 0) this.sendHud();
  }

  private sendHud() {
    this.hudTimer = 0.1;
    const st = this.state;
    this.onHud({
      fleetSize: fleetValue(st.playerFleet),
      fleetMix: fleetMix(st),
      maxFleetSize: st.maxFleetSize,
      wave: st.wave,
      time: st.survived,
      gameOver: st.gameOver,
      paused: this.paused,
      dashCooldown: st.dashCooldown,
      level: st.level,
      xp: st.xp,
      xpNext: xpToNextLevel(st.level),
      skills: st.skills.map((sk) => ({
        id: sk.id,
        name: SKILLS[sk.id].name,
        side: SKILLS[sk.id].side,
        icon: SKILLS[sk.id].icon,
        rank: sk.rank,
        cooldown: sk.timer,
        total: cooldownOf(st, sk),
      })),
      cards: st.cards ? st.cards.map((c) => describeCard(c, st)) : null,
      equipment: this.paused ? equipmentInfo(st) : null,
      found: st.found && st.time - st.found.time < 3 ? itemInfo(st, st.found.item) : null,
      stats: { ...st.stats },
      history: st.history,
      invincible: st.invincible,
      soundOn: this.sounds.enabled,
      fps: this.fps,
      assetProblems: [...this.assets.problems, ...this.sounds.problems],
    });
  }
}

/** "1×T3 2×T2 12×T1": how many ships of each tier you have, biggest first. */
function fleetMix(state: GameState) {
  const counts = new Map<number, number>();
  for (const s of state.playerFleet.members) counts.set(s.tier, (counts.get(s.tier) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([tier, n]) => `${n}×T${tier}`)
    .join(' ');
}

const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3 };

function itemInfo(state: GameState, it: Item): ItemInfo {
  return { id: it.id, ...describeItem(it), equipped: state.equipped.includes(it.id) };
}

/** Everything the equipment screen needs. */
function equipmentInfo(state: GameState): EquipmentInfo {
  const equipped = state.equipped
    .map((id) => state.items.find((it) => it.id === id))
    .filter((it): it is Item => !!it)
    .map((it) => itemInfo(state, it));
  const inventory = state.items
    .filter((it) => !state.equipped.includes(it.id))
    .sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || b.amount - a.amount)
    .map((it) => itemInfo(state, it));
  const totals = (Object.keys(ITEM_STATS) as ItemStat[])
    .filter((k) => state.bonus[k] > 1.001)
    .map((k) => `+${Math.round((state.bonus[k] - 1) * 100)}% ${ITEM_STATS[k].bonus}`);
  return {
    slots: slotCount(state),
    equipped,
    inventory,
    totals,
    next: { tier: state.maxTier + 1, slots: CONFIG.items.slotsPerTier },
  };
}
