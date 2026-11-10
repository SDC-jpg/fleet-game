// Connects everything: input -> game rules -> drawing, plus info for the on-screen HUD.

import { spriteDuration, type Assets } from '../engine/assets';
import { Input } from '../engine/input';
import { startLoop } from '../engine/loop';
import { PixelRenderer } from '../engine/renderer';
import { renderGame } from './render';
import { controlledShip, createGame, updateGame, type Controls, type GameState } from './world';

/** Numbers shown on screen by React. */
export interface HudInfo {
  fleetSize: number;
  maxFleetSize: number;
  wave: number;
  time: number;
  gameOver: boolean;
  assetProblems: string[];
}

export class Game {
  private state: GameState;
  private renderer: PixelRenderer;
  private input: Input;
  private assets: Assets;
  private onHud: (hud: HudInfo) => void;
  private stopLoop: (() => void) | null = null;
  private hudTimer = 0;
  private onResize = () => this.renderer.resize();

  constructor(canvas: HTMLCanvasElement, assets: Assets, onHud: (hud: HudInfo) => void) {
    this.assets = assets;
    this.onHud = onHud;
    this.renderer = new PixelRenderer(canvas);
    this.input = new Input(canvas);
    this.state = this.newState();
  }

  private newState() {
    const state = createGame((name) => spriteDuration(this.assets.get(name)));
    this.renderer.setZoom(state.zoom, true);
    return state;
  }

  start() {
    window.addEventListener('resize', this.onResize);
    this.stopLoop = startLoop(
      (dt) => this.update(dt),
      (frameDt) => this.render(frameDt),
    );
  }

  stop() {
    this.stopLoop?.();
    this.input.destroy();
    window.removeEventListener('resize', this.onResize);
  }

  restart() {
    this.state = this.newState();
  }

  private readControls(): Controls {
    const i = this.input;
    const aim = this.renderer.screenToWorld(i.mouseX, i.mouseY);
    return {
      moveX: (i.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (i.isDown('KeyA', 'ArrowLeft') ? 1 : 0),
      moveY: (i.isDown('KeyS', 'ArrowDown') ? 1 : 0) - (i.isDown('KeyW', 'ArrowUp') ? 1 : 0),
      aimX: aim.x,
      aimY: aim.y,
      fire: i.mouseDown || i.isDown('Space'),
    };
  }

  private update(dt: number) {
    if (this.state.gameOver && this.input.isDown('KeyR')) this.restart();
    // Spawn enemies just outside the visible area.
    const spawnDistance = Math.hypot(this.renderer.viewWidth, this.renderer.viewHeight) / 2 + 40;
    updateGame(this.state, this.readControls(), dt, spawnDistance);
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
    r.begin(frameDt);
    renderGame(this.state, r, this.assets);
    r.end();

    // Update the HUD about 10 times a second (React doesn't need every frame).
    this.hudTimer -= frameDt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.onHud({
        fleetSize: this.state.playerFleet.members.length,
        maxFleetSize: this.state.maxFleetSize,
        wave: this.state.wave,
        time: this.state.time,
        gameOver: this.state.gameOver,
        assetProblems: [...this.assets.problems],
      });
    }
  }
}
