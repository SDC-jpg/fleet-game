// Connects everything: input -> game rules -> drawing, plus info for the on-screen HUD.

import { spriteDuration, type Assets } from '../engine/assets';
import { Input } from '../engine/input';
import { startLoop } from '../engine/loop';
import { PixelRenderer } from '../engine/renderer';
import type { Sounds } from '../engine/sound';
import { clamp } from '../engine/math';
import { renderGame, tierSprite } from './render';
import { CONFIG } from './config';
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
  stats: RunStats;
  /** Fleet value at each wave start, for the end-of-run graph. */
  history: HistoryPoint[];
  invincible: boolean;
  soundOn: boolean;
  /** Frames drawn per second (averaged over half a second). */
  fps: number;
  assetProblems: string[];
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
    if (this.state.gameOver) paused = false;
    this.paused = paused;
    this.needsDraw = true;
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
    };
  }

  private update(dt: number) {
    const i = this.input;
    if (this.state.gameOver && i.isDown('KeyR')) this.restart();
    if (i.wasPressed('KeyM')) this.toggleSound();
    if (i.wasPressed('Escape')) this.setPaused(!this.paused);
    if (this.paused) {
      i.wasPressed('Space'); // ignore dashes pressed while paused
      return;
    }
    if (TEST_KEYS_ENABLED) this.handleTestKeys();
    // Spawn enemies a bit outside the visible area.
    const spawnDistance = Math.hypot(this.renderer.viewWidth, this.renderer.viewHeight) / 2 + CONFIG.spawnMargin;
    updateGame(this.state, this.readControls(), dt, spawnDistance);
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
    if (!this.paused || this.needsDraw) {
      r.begin(this.paused ? 0 : frameDt);
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
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.onHud({
        fleetSize: fleetValue(this.state.playerFleet),
        fleetMix: fleetMix(this.state),
        maxFleetSize: this.state.maxFleetSize,
        wave: this.state.wave,
        time: this.state.survived,
        gameOver: this.state.gameOver,
        paused: this.paused,
        dashCooldown: this.state.dashCooldown,
        stats: { ...this.state.stats },
        history: this.state.history,
        invincible: this.state.invincible,
        soundOn: this.sounds.enabled,
        fps: this.fps,
        assetProblems: [...this.assets.problems, ...this.sounds.problems],
      });
    }
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
