// Connects everything: input -> game rules -> drawing, plus info for the on-screen HUD.

import { spriteDuration, type Assets } from '../engine/assets';
import { Input } from '../engine/input';
import { IS_TOUCH_DEVICE, newTouchState } from '../engine/touch';
import { startLoop } from '../engine/loop';
import { PixelRenderer, ROTATION_MODES, type RotationMode } from '../engine/renderer';
import { ROTATION_SETTING, loadSetting, saveSetting } from '../engine/settings';
import type { Sounds } from '../engine/sound';
import { clamp, wrapAngle } from '../engine/math';
import { renderGame, tierSprite } from './render';
import { CONFIG, ITEM_STATS, RARITIES, SHIP_TYPES, SKILLS, type ItemStat, type Rarity, type SkillId } from './config';
import { xpToNextLevel } from './curves';
import { applyCard, describeCard, gainXp, pickCard, testGiveAllSkills, type CardInfo } from './progress';
import { clearEquipment, loadEquipment, saveEquipment } from './save';
import { recordRun, type RunRecord } from './runLog';
import { addRunToLifetime, clearLifetime } from './lifetime';
import { clearRun, loadRun, restoreRun, saveRun, type RunSnapshot } from './runSave';
import { MAX_MERGE_LEVEL, MERGE_LEVELS, autoMerge, describeItem, equip, gearscore, mergeItems, rollItem, slotOf, slotTier, slotUnlocked, unequip, updateBonuses, type Item, type MergeOrder } from './equipment';
import { rarityTier, rollRarity } from './rarity';
import { activeWeaponSkill, cooldownOf, selectWeapon } from './skills';
import { ownedSkill, radarRange } from './newSkills';
import { Particles } from './particles';
import type { ArtLayoutsFile } from './artLayout';
import {
  controlledShip,
  eliteAlertTime,
  createGame,
  fleetValue,
  testAddNextTier,
  testAddShips,
  testDestroyFleet,
  testKillEnemies,
  testSpawnElite,
  testSpawnSwarm,
  typeOf,
  testRemoveShip,
  updateGame,
  type Card,
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

/** Browser storage key for the elite test switch. */
const ELITES_SETTING = 'fleet-game.elites';
/** Cursor lock (Settings): keep the mouse inside the game, for several monitors. Remembered in this browser. */
const CURSOR_LOCK_SETTING = 'fleet-game.cursor-lock';

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
  skills: {
    id: SkillId;
    name: string;
    side: 'left' | 'right' | 'passive';
    icon: string;
    rank: number;
    cooldown: number;
    total: number;
    /** Weapons: the selected one (the only one that fires). */
    active: boolean;
    /** Weapons: their place (0 = first), for keys 1, 2, 3... */
    slot: number;
  }[];
  /** Level-up cards on offer (the game is paused meanwhile), or null. */
  cards: CardInfo[] | null;
  /** Your equipment (only sent while paused, for the equipment screen). */
  equipment: EquipmentInfo | null;
  /** The item you just picked up (shown for a few seconds), or null. */
  found: ItemInfo | null;
  /** True for a few seconds after an elite arrives. */
  eliteAlert: boolean;
  /** Tech Scanner: the skill names of each elite in the current warning (empty without the scanner). */
  eliteSkills: string[][];
  /** Time Dilation is running (everything but your fleet is slow). */
  timeDilation: boolean;
  /** Long-Range Radar: you have it (the bottom HUD shows its minimap canvas). */
  radar: boolean;
  /** A swarm wave just arrived (shows "Swarm incoming"). */
  swarmAlert: boolean;
  stats: RunStats;
  /** Fleet value at each wave start, for the end-of-run graph. */
  history: HistoryPoint[];
  invincible: boolean;
  /** Whether elites come this run (test key O). */
  elitesEnabled: boolean;
  /** How rotated ships are drawn (test key U). */
  rotation: RotationMode;
  /** Monitor size, display scaling and pixel zoom, for checking the zoom (test bar). */
  display: string;
  /** Every logged run (shown on the game-over screen), oldest first, or null during a run. */
  runs: RunRecord[] | null;
  soundOn: boolean;
  /** Auto-fire (Q) is on. */
  autoFire: boolean;
  /** Settings: the mouse is kept inside the game. */
  cursorLock: boolean;
  /** Frames drawn per second (averaged over half a second). */
  fps: number;
  /** An interrupted run that can be resumed (asked when the game opens), or null. */
  resumeOffer: { wave: number; fleetValue: number; level: number; savedAt: number } | null;
  assetProblems: string[];
}

/** One item, as shown on screen. */
export interface ItemInfo {
  id: number;
  name: string;
  bonus: string;
  /** Substats and card bonus, one line each. */
  extra: string[];
  icon: string;
  color: string;
  /** Mythic: its colour cycles (holographic). */
  holo: boolean;
  equipped: boolean;
  rarity: Rarity;
  /** 1 = Common ... 7 = Mythic, for sorting. */
  rarityRank: number;
  /** Merge rank ("+N"), 0 for none. */
  plus: number;
  stat: ItemStat;
  /** Its bonus (0.08 = +8%), for sorting. */
  amount: number;
}

/** One equipment slot, as shown on screen. */
export interface SlotInfo {
  item: ItemInfo | null;
  /** The tier that unlocks it. */
  tier: number;
  locked: boolean;
}

/** What the equipment screen shows. */
export interface EquipmentInfo {
  /** Every slot, 3 per tier from tier 1 up. */
  slots: SlotInfo[];
  /** Items not equipped (the screen sorts and filters them). */
  inventory: ItemInfo[];
  /** Your fleet's total bonuses from cards and equipment, e.g. "+12% damage". */
  totals: string[];
  /** Rarity tiers of all equipped items added up (Common 1 … Mythic 7). */
  gearscore: number;
  /** You have the Merge Module (its button and drawer show). */
  mergeModule: boolean;
  /** Its level: 1 = Merge Module, 2 = Mk. II (Load), 3 = Mk. III (QuickMerge), 4 = Mk. IV (AutoMerge). */
  mergeLevel: number;
  /** What it's called ("Merge Mk. II"). */
  mergeName: string;
  /** Rarities QuickMerge and AutoMerge may use. */
  mergeAllow: Rarity[];
  /** Least rare first ('low') or rarest first ('high'). */
  mergeOrder: MergeOrder;
  /** AutoMerge is on, and how far along the next one is (0–1). */
  autoMerge: boolean;
  autoProgress: number;
  /** The item the last AutoMerge made, if any. */
  autoMade: ItemInfo | null;
  /** Goes up when the merge drawer should open by itself (just after picking up the Merge Module). */
  openMerge: number;
  /** Goes up when the Run log tab should open (Tab key). */
  openLog: number;
}

/** "Monitor 1920×1080 · scaling 125% · 3 px per art pixel". */
function displayText(d: { monitor: string; scaling: number; pixelsPerArtPixel: number }) {
  return `Monitor ${d.monitor} · scaling ${d.scaling}% · ${d.pixelsPerArtPixel} px per art pixel`;
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
  /** AutoMerge: seconds into the current countdown, and the item the last one made. */
  private autoMergeState: { time: number; made: Item | null } = { time: 0, made: null };
  private fps = 0;
  private fpsFrames = 0;
  private fpsStart = performance.now();
  private paused = false;
  /** Bumped to make the equipment screen open its merge drawer (after picking up the Merge Module). */
  private openMerge = 0;
  /** Counts Tab presses that open the run log (the pause screen switches to its tab). */
  private openLog = 0;
  /** Auto-fire (Q): fires as if left click were held. */
  private autoFire = false;
  /** On-screen controls (touch screens; see TouchControls.tsx), and the direction the ship last aimed with the stick. */
  readonly touch = newTouchState();
  private touchAim = -Math.PI / 2;
  /** Real seconds left of the slow-motion moment when your last ship is hit (CONFIG.death), or 0. */
  private slowmo = 0;
  /** The run log, filled in when a run ends (null until then). */
  private runs: RunRecord[] | null = null;
  /** An interrupted run found when the game opened: the game waits until you resume it or start anew. */
  private resumeOffer: RunSnapshot | null = null;
  /** Seconds until the run's progress is saved again (runSave.ts), and the wave it was last saved in. */
  private runSaveTimer = 0;
  private runSavedWave = 0;
  /** Art layouts from art.json (thrusters, flames, emitters, points; made with the ShipArt tool). */
  private layouts: ArtLayoutsFile;
  /** Thruster particles (visual only). */
  private particles = new Particles();
  /** Where each ship and shot was one step ago, for drawing them smoothly between steps. */
  private previous = new Map<object, { x: number; y: number; angle: number }>();
  /** While paused the picture doesn't change, so it's only drawn again when needed. */
  private needsDraw = true;
  /** Long-Range Radar's minimap canvas (in the bottom HUD), drawn every frame. */
  private radarCanvas: HTMLCanvasElement | null = null;

  /** The bottom HUD hands over (or takes back) the radar's canvas. */
  setRadarCanvas(canvas: HTMLCanvasElement | null) {
    this.radarCanvas = canvas;
  }

  /**
   * Long-Range Radar: a minimap centred on your flagship, a 1 px frame over a
   * see-through background, with dots: wrecks, loot (rarity colour), enemies,
   * elites (bigger), your fleet and your flagship (CONFIG.radar). A faint box
   * shows what's on screen now.
   */
  private drawRadar() {
    const c = this.radarCanvas;
    if (!c) return;
    const R = CONFIG.radar;
    const st = this.state;
    const dpr = window.devicePixelRatio || 1;
    const w = R.width;
    const h = R.height;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(159, 211, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    const r = this.renderer;
    const range = radarRange(st, r.viewWidth);
    if (!range) return;
    const cx = r.camX;
    const cy = r.camY;
    const k = (w / 2 - 2) / range;
    const dot = (x: number, y: number, color: string, size: number) => {
      const px = w / 2 + (x - cx) * k;
      const py = h / 2 + (y - cy) * k;
      if (px < 1 || py < 1 || px > w - 1 || py > h - 1) return;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(px - size / 2), Math.round(py - size / 2), size, size);
    };
    // What's on screen right now.
    ctx.strokeStyle = 'rgba(159, 211, 255, 0.2)';
    ctx.strokeRect(Math.round(w / 2 - (r.viewWidth / 2) * k) + 0.5, Math.round(h / 2 - (r.viewHeight / 2) * k) + 0.5, Math.round(r.viewWidth * k), Math.round(r.viewHeight * k));
    const col = R.colors;
    for (const wr of st.wrecks) dot(wr.x, wr.y, col.wreck, 2);
    for (const l of st.loot) dot(l.x, l.y, l.item ? RARITIES[l.item.rarity].color : col.mergeModule, 2);
    for (const s of st.ships) if (s.team === 'enemy' && !s.elite) dot(s.x, s.y, col.enemy, 2);
    for (const s of st.ships) if (s.team === 'enemy' && s.elite) dot(s.x, s.y, col.elite, 4);
    const flagship = controlledShip(st);
    for (const s of st.ships) if (s.team === 'player' && s !== flagship) dot(s.x, s.y, col.fleet, 2);
    if (flagship) dot(flagship.x, flagship.y, col.flagship, 3);
  }
  private onResize = () => {
    this.renderer.resize();
    this.needsDraw = true;
  };
  /** Pause by itself when you click another window or switch tabs. */
  private onBlur = () => this.setPaused(true);
  private onVisibility = () => {
    if (!document.hidden) return;
    this.setPaused(true);
    this.onPageHide();
  };

  constructor(canvas: HTMLCanvasElement, assets: Assets, sounds: Sounds, layouts: ArtLayoutsFile, onHud: (hud: HudInfo) => void) {
    this.assets = assets;
    this.layouts = layouts;
    this.sounds = sounds;
    this.onHud = onHud;
    this.renderer = new PixelRenderer(canvas);
    // How rotated ships are drawn (test key U, or ShipArt's Rotation buttons), remembered in this browser.
    const rotation = loadSetting(ROTATION_SETTING) as RotationMode | null;
    if (rotation && ROTATION_MODES.includes(rotation)) this.renderer.rotation = rotation;
    this.input = new Input(canvas);
    this.input.cursorLock = loadSetting(CURSOR_LOCK_SETTING) === 'on';
    // The mouse is only kept in the game while you're playing: not on menus, cards or the end-of-run screen.
    this.input.canLock = () => !this.isFrozen() && !this.state.gameOver;
    // Esc (or switching windows) ended the cursor lock: pause, like Esc normally does.
    // But not just after resuming: that's the browser dropping a lock it had only just given back.
    this.input.onLockLost = () => {
      if (performance.now() - this.resumedAt > 500) this.setPaused(true);
    };
    this.state = this.newState();
    this.resumeOffer = loadRun();
  }

  /** Resume the interrupted run: the field is cleared and its saved wave starts again. */
  resumeRun() {
    if (!this.resumeOffer) return;
    restoreRun(this.state, this.resumeOffer);
    this.renderer.setZoom(this.state.zoom, true);
    this.resumeOffer = null;
    this.runSavedWave = this.state.wave;
    this.needsDraw = true;
    this.sendHud();
  }

  /** Don't resume: forget the interrupted run and play a new one. */
  discardRun() {
    clearRun();
    this.resumeOffer = null;
    this.needsDraw = true;
    this.sendHud();
  }

  /** Keep the run's progress saved (every few seconds and at each new wave) so it can be resumed. */
  private tickRunSave(dt: number) {
    this.runSaveTimer -= dt;
    if (this.runSaveTimer > 0 && this.state.wave === this.runSavedWave) return;
    this.runSaveTimer = CONFIG.runSave.every;
    this.runSavedWave = this.state.wave;
    saveRun(this.state);
  }

  /** The page is being hidden or closed: save the run's progress now. */
  private onPageHide = () => {
    if (!this.resumeOffer) saveRun(this.state);
  };

  private newState() {
    const state = createGame((name, tier) => spriteDuration(this.assets.get(tierSprite(this.assets, name, tier))));
    // The elite test switch (key O) is remembered in this browser between runs and visits.
    const stored = TEST_KEYS_ENABLED ? loadSetting(ELITES_SETTING) : null;
    if (stored !== null) state.elitesEnabled = stored === 'on';
    loadEquipment(state);
    this.renderer.setZoom(state.zoom, true);
    return state;
  }

  start() {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    this.stopLoop = startLoop(
      (dt) => this.update(dt),
      (frameDt, alpha) => this.render(frameDt, alpha),
      // While the game is stopped (pause, equipment or level-up screen), 30 frames per second is plenty.
      () => (this.isFrozen() ? 1 / 30 : 0),
    );
  }

  stop() {
    this.stopLoop?.();
    this.input.destroy();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
  }

  restart() {
    this.particles.clear();
    this.slowmo = 0;
    this.runs = null;
    this.state = this.newState();
    this.paused = false;
  }

  /** When the game was last resumed (performance.now()). */
  private resumedAt = -Infinity;

  /**
   * Pause or resume (Esc, the Resume button, or automatically when the window
   * loses focus). `byClick`: resumed with a click (the Resume button), which
   * may lock the cursor straight away. Resuming with Esc doesn't: the browser
   * would take that same Esc as "release the mouse" and the game would pause
   * again. The next click on the game locks it then.
   */
  setPaused(paused: boolean, byClick = false) {
    // Level-up cards already stop the game.
    if (this.state.gameOver || this.state.cards) paused = false;
    if (this.paused && !paused) this.resumedAt = performance.now();
    this.paused = paused;
    this.needsDraw = true;
    if (!paused && byClick) this.input.lock();
  }

  /** Settings: keep the mouse inside the game window (remembered in this browser). */
  setCursorLock(on: boolean) {
    this.input.cursorLock = on;
    saveSetting(CURSOR_LOCK_SETTING, on ? 'on' : 'off');
    if (!on) this.input.unlock();
    this.sendHud();
  }

  /** Settings → General: wipe saved equipment (items, slots, loot count, Merge Module). */
  clearProgress() {
    clearEquipment(this.state);
    clearLifetime();
    this.saveIfChanged();
    this.sendHud();
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

  /** Save equipment if it changed (items found, moved, or slots unlocked). */
  private saveIfChanged() {
    if (!this.state.equipmentChanged) return;
    this.state.equipmentChanged = false;
    saveEquipment(this.state);
  }

  /** Equipment screen: put an item into a slot (moving or swapping), or the first free slot if none is given. */
  equipItem(id: number, slot?: number) {
    equip(this.state, id, slot);
    this.saveIfChanged();
    this.sendHud();
  }

  /** Merge drawer: merge three items into one. Returns the new item, or null if the merge wasn't allowed. */
  mergeItems(ids: number[]): ItemInfo | null {
    const item = mergeItems(this.state, ids);
    if (item) updateBonuses(this.state);
    this.playQueuedSounds();
    this.saveIfChanged();
    this.sendHud();
    return item ? itemInfo(this.state, item) : null;
  }

  /** Merge Mk. III settings: which rarities QuickMerge and AutoMerge may use, and in which order. */
  setMergeAllow(rarities: Rarity[], order: MergeOrder) {
    this.state.mergeAllow = rarities;
    this.state.mergeOrder = order;
    this.state.equipmentChanged = true;
    this.saveIfChanged();
    this.sendHud();
  }

  /** Merge Mk. IV: switch AutoMerge on or off (it starts a fresh countdown). */
  setAutoMerge(on: boolean) {
    this.state.autoMerge = on;
    this.autoMergeState.time = 0;
    this.state.equipmentChanged = true;
    this.saveIfChanged();
    this.sendHud();
  }

  /**
   * AutoMerge (Mk. IV): while on, a countdown runs (in real time, also while
   * paused); each time it fills up, the lowest-rarity allowed set is merged.
   */
  private tickAutoMerge(dt: number) {
    const s = this.state;
    const a = this.autoMergeState;
    if (!s.autoMerge || s.mergeLevel < MAX_MERGE_LEVEL) {
      a.time = 0;
      return;
    }
    a.time += dt;
    if (a.time < CONFIG.items.autoMergeEvery) return;
    a.time = 0;
    const made = autoMerge(s);
    if (!made) return;
    a.made = made;
    updateBonuses(s);
    this.playQueuedSounds();
    this.saveIfChanged();
    this.sendHud();
  }

  /** Equipment screen: take an item out of its slot. */
  unequipItem(id: number) {
    unequip(this.state, id);
    this.saveIfChanged();
    this.sendHud();
  }

  /** Take level-up card number `index` (click, or keys 1–3). */
  /** Skill bar: select a weapon skill by its place (clicked or tapped). */
  selectWeapon(slot: number) {
    selectWeapon(this.state, slot);
    this.sendHud();
  }

  /** Card index, dev only: get this card's effect now (a skill, an upgrade, a fleet bonus). */
  debugGiveCard(card: Card) {
    if (!TEST_KEYS_ENABLED) return;
    applyCard(this.state, card, true);
    this.playQueuedSounds();
    this.sendHud();
  }

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
    if (IS_TOUCH_DEVICE) return this.readTouchControls();
    const i = this.input;
    const aim = this.renderer.screenToWorld(i.mouseX, i.mouseY);
    return {
      moveX: (i.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (i.isDown('KeyA', 'ArrowLeft') ? 1 : 0),
      moveY: (i.isDown('KeyS', 'ArrowDown') ? 1 : 0) - (i.isDown('KeyW', 'ArrowUp') ? 1 : 0),
      aimX: aim.x,
      aimY: aim.y,
      fire: i.mouseDown || this.autoFire,
      boost: i.isDown('ShiftLeft', 'ShiftRight'),
      dash: i.wasPressed('Space'),
      defend: i.wasPressed('MouseRight'),
      defendHeld: i.rightDown,
    };
  }

  /**
   * Touch screens: the stick moves the ship, and it faces where you push (there's
   * no mouse to aim with; it keeps its last direction when you let go). Attack
   * acts like holding left click, Defend like right click.
   */
  private readTouchControls(): Controls {
    const t = this.touch;
    const ship = controlledShip(this.state);
    if (Math.hypot(t.stickX, t.stickY) > 0.25) this.touchAim = Math.atan2(t.stickY, t.stickX);
    const reach = 300;
    const dash = t.dashPresses > 0;
    const defend = t.defendPresses > 0;
    t.dashPresses = 0;
    t.defendPresses = 0;
    return {
      moveX: Math.abs(t.stickX) > 0.15 ? t.stickX : 0,
      moveY: Math.abs(t.stickY) > 0.15 ? t.stickY : 0,
      aimX: (ship?.x ?? 0) + Math.cos(this.touchAim) * reach,
      aimY: (ship?.y ?? 0) + Math.sin(this.touchAim) * reach,
      fire: t.attack || this.autoFire,
      boost: t.boost,
      dash,
      defend,
      defendHeld: t.defend,
    };
  }

  /**
   * Engine sounds of the ship you fly: a faint hum while it moves, and a
   * slightly louder version instead while it boosts (loops that fade in and out; the
   * short boost sound still plays when boost starts). Bigger tiers sound
   * deeper. Silent while the game is stopped or over.
   */
  private updateEngineSound() {
    const ship = controlledShip(this.state);
    const playing = !!ship && !ship.dead && !this.isFrozen() && !this.state.gameOver;
    const thrust = playing ? ship!.thrust : 'idle';
    const pitch = playing ? CONFIG.audio.pitchPerTier ** (ship!.tier - 1) * this.timeScale ** 0.5 : 1;
    // While boosting, the boost loop takes over from the hum (it's the same sound, a little louder).
    this.sounds.setLoop('sfx.engine-move', thrust === 'move' ? CONFIG.audio.engineMoveLevel : 0, pitch);
    this.sounds.setLoop('sfx.engine-boost', thrust === 'boost' ? CONFIG.audio.engineBoostLevel : 0, pitch);
  }

  private update(dt: number) {
    const i = this.input;
    this.updateEngineSound();
    this.tickAutoMerge(dt);
    // An interrupted run was found: nothing moves until you choose (the screen asks).
    if (this.resumeOffer) {
      i.unlock();
      i.wasPressed('Space');
      i.wasPressed('MouseRight');
      i.wasPressed('Escape');
      return;
    }
    // The run is over: free the mouse for the end-of-run screen.
    if (this.state.gameOver) i.unlock();
    if (this.endShown && i.isDown('KeyR')) this.restart();
    if (i.wasPressed('KeyM')) this.toggleSound();
    if (i.wasPressed('KeyQ')) this.autoFire = !this.autoFire;
    // (Not the Esc that just ended a cursor lock: that one already paused.)
    if (i.wasPressed('Escape') && performance.now() - i.lockLostAt > 300) this.setPaused(!this.paused);
    // Tab: open the pause screen on the Run log tab, or close it again.
    if (i.wasPressed('Tab') && !this.state.gameOver) {
      if (!this.paused) this.openLog++;
      this.setPaused(!this.paused);
      this.sendHud();
    }
    // Level-up cards: pick with 1, 2 or 3 (or a click).
    const cards = this.state.cards;
    if (cards && !this.paused) {
      const n = cards.findIndex((_, k) => i.wasPressed(`Digit${k + 1}`));
      if (n >= 0) this.pickCard(n);
    } else if (!this.paused && !this.state.gameOver) {
      // Otherwise 1–9 select a weapon skill, and the mouse wheel steps through them.
      for (let k = 0; k < 9; k++) if (i.wasPressed(`Digit${k + 1}`)) selectWeapon(this.state, k);
      const steps = (i.wasPressed('WheelDown') ? 1 : 0) - (i.wasPressed('WheelUp') ? 1 : 0);
      if (steps) selectWeapon(this.state, steps, true);
    }
    if (this.paused || this.state.cards) {
      // Menus and cards need the real cursor.
      i.unlock();
      // Ignore one-off presses made while the game is stopped.
      i.wasPressed('Space');
      i.wasPressed('MouseRight');
      this.touch.dashPresses = 0;
      this.touch.defendPresses = 0;
      this.touch.attack = this.touch.defend = this.touch.boost = false;
      this.touch.stickX = this.touch.stickY = 0;
      return;
    }
    if (TEST_KEYS_ENABLED) this.handleTestKeys();
    this.rememberPositions();
    // Spawn enemies a bit outside the visible area.
    // The blow that destroys your last ship: time slows right down for a moment, then it explodes.
    const fb = this.state.finalBlow;
    if (fb && !fb.ready) {
      if (this.slowmo <= 0) this.slowmo = CONFIG.death.slowmoTime;
      this.slowmo -= dt;
      if (this.slowmo <= 0) fb.ready = true;
    }
    updateGame(this.state, this.readControls(), dt * this.timeScale, this.spawnDistance());
    this.playQueuedSounds();
    this.saveIfChanged();
    this.tickRunSave(dt);
    // Just picked up the Merge Module: pause on the equipment screen with its drawer open
    // (after any level-up cards on screen have been picked).
    if (this.state.unlocked === 'merge-module' && !this.state.cards) {
      this.state.unlocked = null;
      this.openMerge++;
      this.setPaused(true);
      this.sendHud();
    }
    // The run just ended: add it to the run log (once).
    if (this.state.gameOver && !this.runs) {
      this.runs = recordRun(this.state);
      addRunToLifetime(this.state);
      clearRun();
      this.sendHud();
    }
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

  /** How far from you enemies appear: just outside the visible area. */
  private spawnDistance() {
    return Math.hypot(this.renderer.viewWidth, this.renderer.viewHeight) / 2 + CONFIG.spawnMargin;
  }

  private handleTestKeys() {
    const i = this.input;
    const s = this.state;
    if (s.gameOver) return;
    if (i.wasPressed('Equal', 'NumpadAdd')) testAddShips(s, 1);
    if (i.wasPressed('BracketRight')) testAddShips(s, 16);
    if (i.wasPressed('KeyT')) testAddNextTier(s);
    if (i.wasPressed('Minus', 'NumpadSubtract')) testRemoveShip(s);
    if (i.wasPressed('KeyG')) s.invincible = !s.invincible;
    if (i.wasPressed('KeyK')) testKillEnemies(s, this.renderer.view);
    if (i.wasPressed('KeyL')) gainXp(s, xpToNextLevel(s.level) - s.xp);
    if (i.wasPressed('KeyJ')) testGiveAllSkills(s);
    if (i.wasPressed('KeyI')) {
      // Drop 3 items of one random rarity right next to you (enough for a merge).
      const f = controlledShip(s);
      const rarity = rollRarity({ common: 1, uncommon: 1, superior: 1, rare: 1, epic: 1, legendary: 1, mythic: 1 });
      if (f) for (let n = 0; n < 3; n++) s.loot.push({ item: rollItem(s, { rarity }), x: f.x + 60 + n * 25, y: f.y - 40, vx: 0, vy: 0, life: 40 });
    }
    // Drop the next Merge Module upgrade next to you (normally they drop after looting enough items; see CONFIG.items).
    if (i.wasPressed('KeyY')) {
      const f = controlledShip(s);
      const level = s.mergeLevel + 1;
      if (f && level <= MAX_MERGE_LEVEL && !s.loot.some((l) => l.qol))
        s.loot.push({ qol: 'merge-module', level, x: f.x + 120, y: f.y + 60, vx: 0, vy: 0, life: Infinity });
    }
    if (i.wasPressed('KeyE')) testSpawnElite(s, this.spawnDistance());
    if (i.wasPressed('KeyH')) testSpawnSwarm(s, this.spawnDistance());
    if (i.wasPressed('KeyO')) {
      s.elitesEnabled = !s.elitesEnabled;
      saveSetting(ELITES_SETTING, s.elitesEnabled ? 'on' : 'off');
    }
    if (i.wasPressed('KeyU')) {
      const modes = ROTATION_MODES;
      this.renderer.rotation = modes[(modes.indexOf(this.renderer.rotation) + 1) % modes.length];
      saveSetting(ROTATION_SETTING, this.renderer.rotation);
    }
    if (i.wasPressed('KeyX')) testDestroyFleet(s);
  }

  /** How fast game time runs (slow motion while your last ship's final blow lands). */
  private get timeScale() {
    const fb = this.state.finalBlow;
    return fb && !fb.ready ? CONFIG.death.slowmoScale : 1;
  }

  /** The run is over and its end-of-run screen is showing (CONFIG.death.screenDelay after the end). */
  private get endShown() {
    const s = this.state;
    return s.gameOver && s.time - s.gameOverAt >= CONFIG.death.screenDelay;
  }

  /** True while the game is stopped: paused (equipment screen) or showing level-up cards. */
  private isFrozen() {
    return this.paused || this.state.cards !== null || this.resumeOffer !== null;
  }

  /** Note where every ship and shot is before a step (see drawAtSmoothPositions). */
  private rememberPositions() {
    this.previous.clear();
    for (const s of this.state.ships) this.previous.set(s, { x: s.x, y: s.y, angle: s.angle });
    for (const b of this.state.bullets) this.previous.set(b, { x: b.x, y: b.y, angle: 0 });
  }

  /**
   * The game moves things 60 times a second, but many screens refresh faster
   * (120 Hz, 144 Hz). Drawing ships and shots only where the last step left
   * them makes them stutter against the smoothly moving camera, which looks
   * like a blurry double image at high speed. So for drawing, each one is put
   * `alpha` of the way from where it was one step ago to where it is now,
   * then moved back after.
   */
  private drawAtSmoothPositions(alpha: number, draw: () => void) {
    const moved: { o: { x: number; y: number; angle?: number }; x: number; y: number; angle?: number }[] = [];
    const place = (o: { x: number; y: number; angle?: number }) => {
      const p = this.previous.get(o);
      if (!p) return;
      moved.push({ o, x: o.x, y: o.y, angle: o.angle });
      o.x = p.x + (o.x - p.x) * alpha;
      o.y = p.y + (o.y - p.y) * alpha;
      if (o.angle !== undefined) o.angle = p.angle + wrapAngle(o.angle - p.angle) * alpha;
    };
    for (const s of this.state.ships) place(s);
    for (const b of this.state.bullets) place(b);
    draw();
    for (const m of moved) {
      m.o.x = m.x;
      m.o.y = m.y;
      if (m.angle !== undefined) m.o.angle = m.angle;
    }
  }

  /** Move particles, and add new ones from the thrusters of ships on (or near) the screen. */
  private updateParticles(dt: number) {
    this.particles.update(dt);
    const v = this.renderer.view;
    const margin = 100;
    const near = (x: number, y: number) => x > v.x - margin && x < v.x + v.w + margin && y > v.y - margin && y < v.y + v.h + margin;
    for (const s of this.state.ships) {
      if (s.dead || s.absorbed || !near(s.x, s.y)) continue;
      const base = tierSprite(this.assets, typeOf(s).sprites.ship, s.tier);
      this.particles.emitMounts(this.layouts, this.layouts.ships[base], s.thrust, s.x, s.y, s.angle, dt, s.vx, s.vy);
    }
    // Objects with particle emitters (art.json): missiles (Inert until they fire up, then Fired),
    // gun shots, mines, wrecks, laser beams and elite laser warnings.
    const emit = (base: string, tier: number, state: string, x: number, y: number, angle: number, suffix = '', vx = 0, vy = 0) => {
      if (!near(x, y)) return;
      const name = tierSprite(this.assets, base, tier, suffix);
      const layout = this.layouts.objects[name];
      if (layout) this.particles.emitMounts(this.layouts, layout, state, x, y, angle, dt, vx, vy);
    };
    for (const b of this.state.bullets) {
      if (b.homing > 0) emit(b.sprite, b.tier, b.lit ? 'fired' : 'inert', b.x, b.y, b.facing ?? Math.atan2(b.vy, b.vx), '', b.vx, b.vy);
      else emit(b.sprite, b.tier, 'flying', b.x, b.y, Math.atan2(b.vy, b.vx), '', b.vx, b.vy);
    }
    for (const m of this.state.mines) emit('projectile.mine', m.tier, 'armed', m.x, m.y, 0);
    for (const w of this.state.wrecks) emit(SHIP_TYPES[w.type].sprites.ship, w.tier, 'drifting', w.x, w.y, w.angle, '.wreck', w.vx, w.vy);
    for (const b of this.state.beams) emit('vfx.laser', b.tier, 'beam', b.x, b.y, b.angle);
    for (const s of this.state.ships)
      if (s.elite && s.elite.laserCharge > 0)
        emit('vfx.laser', s.tier, 'warning', s.x + Math.cos(s.angle) * s.stats.gunOffset, s.y + Math.sin(s.angle) * s.stats.gunOffset, s.angle);
  }

  private render(frameDt: number, alpha: number) {
    const r = this.renderer;
    const frozen = this.isFrozen();
    this.drawAtSmoothPositions(frozen ? 1 : alpha, () => {
      const ship = controlledShip(this.state);
      if (ship) {
        // Camera smoothly follows the ship you're flying.
        const k = Math.min(1, frameDt * 8);
        r.camX += (ship.x - r.camX) * k;
        r.camY += (ship.y - r.camY) * k;
      }
      // Slow motion: zoom in a little on the doomed ship (back out as it explodes).
      const slow = this.timeScale < 1;
      r.setZoom(this.state.zoom * (slow ? CONFIG.death.slowmoZoom : 1), false, slow);
      if (!frozen || this.needsDraw) {
        // Screen shake (the flagship's explosion): the view jumps around a little, fading out.
        const sh = this.state.shake;
        const amp = sh.time > 0 && !frozen ? (sh.strength * (sh.time / CONFIG.death.shakeTime)) / r.worldScale : 0;
        const sx = amp * (Math.random() * 2 - 1);
        const sy = amp * (Math.random() * 2 - 1);
        r.camX += sx;
        r.camY += sy;
        r.begin(frozen ? 0 : frameDt);
        if (!frozen) this.updateParticles(frameDt * this.timeScale);
        renderGame(this.state, r, this.assets, { layouts: this.layouts, particles: this.particles });
        // While the cursor is locked the real one is hidden: draw the game's own.
        if (this.input.locked) {
          const p = r.screenToWorld(this.input.mouseX, this.input.mouseY);
          r.drawSprite(this.assets.get('ui.cursor'), p.x, p.y, 0, 0, 1, true);
        }
        r.end();
        r.camX -= sx;
        r.camY -= sy;
        this.needsDraw = false;
      }
    });

    this.drawRadar();

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
    const activeWeapon = activeWeaponSkill(st);
    this.onHud({
      fleetSize: fleetValue(st.playerFleet),
      fleetMix: fleetMix(st),
      maxFleetSize: st.maxFleetSize,
      wave: st.wave,
      time: st.survived,
      // The end-of-run screen waits a moment, so you see your flagship go up.
      gameOver: this.endShown,
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
        // Point Defense Cannons show their ammo instead of a cooldown.
        cooldown: sk.id === 'pdc' ? 1 - st.pdc.ammo : sk.timer,
        total: sk.id === 'pdc' ? 1 : cooldownOf(st, sk),
        active: sk === activeWeapon,
        slot: st.skills.filter((k) => SKILLS[k.id].side === 'left').indexOf(sk),
      })),
      cards: st.cards ? st.cards.map((c) => describeCard(c, st)) : null,
      equipment: this.paused ? equipmentInfo(st, this.openMerge, this.openLog, this.autoMergeState) : null,
      found: st.found && st.time - st.found.time < 3 ? itemInfo(st, st.found.item) : null,
      eliteAlert: st.time - st.eliteAlertTime < eliteAlertTime(st),
      eliteSkills: ownedSkill(st, 'techScanner') ? st.eliteAlertSkills.map((list) => list.map((id) => SKILLS[id].name)) : [],
      timeDilation: st.timeDilation > 0,
      radar: !!ownedSkill(st, 'radar'),
      swarmAlert: st.time - st.swarmAlertTime < CONFIG.swarm.alertSeconds,
      stats: { ...st.stats },
      history: st.history,
      invincible: st.invincible,
      elitesEnabled: st.elitesEnabled,
      rotation: this.renderer.rotation,
      display: displayText(this.renderer.displayInfo),
      runs: this.runs,
      soundOn: this.sounds.enabled,
      autoFire: this.autoFire,
      cursorLock: this.input.cursorLock,
      fps: this.fps,
      resumeOffer: this.resumeOffer && {
        wave: this.resumeOffer.wave,
        fleetValue: this.resumeOffer.fleetValue,
        level: this.resumeOffer.level,
        savedAt: this.resumeOffer.savedAt,
      },
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

function itemInfo(state: GameState, it: Item): ItemInfo {
  return {
    id: it.id,
    ...describeItem(it),
    equipped: slotOf(state, it.id) >= 0,
    rarity: it.rarity,
    rarityRank: rarityTier(it.rarity),
    plus: it.plus ?? 0,
    stat: it.stat,
    amount: it.amount,
  };
}

/** Everything the equipment screen needs. */
function equipmentInfo(state: GameState, openMerge: number, openLog: number, auto: { time: number; made: Item | null }): EquipmentInfo {
  const byId = new Map(state.items.map((it) => [it.id, it]));
  const slots = state.slots.map((id, i) => {
    const it = id === null ? undefined : byId.get(id);
    return { item: it ? itemInfo(state, it) : null, tier: slotTier(i), locked: !slotUnlocked(state, i) };
  });
  const inventory = state.items.filter((it) => slotOf(state, it.id) < 0).map((it) => itemInfo(state, it));
  const totals = (Object.keys(ITEM_STATS) as ItemStat[])
    .filter((k) => state.bonus[k] > 1.001)
    .map((k) => `+${Math.round((state.bonus[k] - 1) * 100)}% ${ITEM_STATS[k].bonus}`);
  return {
    slots,
    inventory,
    totals,
    gearscore: gearscore(state),
    mergeModule: state.mergeLevel > 0,
    mergeLevel: state.mergeLevel,
    mergeName: MERGE_LEVELS[state.mergeLevel]?.name ?? '',
    mergeAllow: state.mergeAllow,
    mergeOrder: state.mergeOrder,
    autoMerge: state.autoMerge && state.mergeLevel >= MAX_MERGE_LEVEL,
    autoProgress: auto.time / CONFIG.items.autoMergeEvery,
    autoMade: auto.made ? itemInfo(state, auto.made) : null,
    openMerge,
    openLog,
  };
}
