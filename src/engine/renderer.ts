// Pixel-perfect renderer.
//
// The world is first drawn into a small "buffer" canvas where 1 pixel = 1 game
// pixel. That buffer is then enlarged onto the screen by a whole number
// (the zoom), which keeps pixel art crisp, even for rotated sprites.
//
// Zoomed out below 1×, the buffer is screen-sized instead and the art is
// shrunk smoothly into it (a little softer, but nothing flickers).
//
// Rotated pixel art can look crunchy ("laddering"), so there are three ways
// to rotate (`rotation`), to compare:
//   'grid'      rotate on the game-pixel grid (the original way)
//   'hires'     draw everything at screen resolution: pixels tilt as solid squares
//   'rotsprite' ships and their parts use RotSprite copies (see rotsprite.ts),
//               snapped to 128 angle steps, staying on the pixel grid

import { frameAt, type Sprite } from './assets';
import { angleStep, rotatedFrame, stepAngle } from './rotsprite';

export type RotationMode = 'grid' | 'hires' | 'rotsprite';
export const ROTATION_MODES: RotationMode[] = ['grid', 'hires', 'rotsprite'];
export const ROTATION_LABELS: Record<RotationMode, string> = { grid: 'Grid', hires: 'Hi-res', rotsprite: 'RotSprite' };

export class PixelRenderer {
  private screen: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private buffer = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;

  /** Screen pixels per game pixel. Animates smoothly toward `targetScale`. Can be below 1. */
  scale = 4;
  private targetScale = 4;
  /** Camera centre, in world coordinates. */
  camX = 0;
  camY = 0;
  /** World coordinate of the buffer's top-left pixel (for the current frame). */
  private originX = 0;
  private originY = 0;

  /** How rotated sprites are drawn (see the top of this file). */
  rotation: RotationMode = 'grid';

  /** true = fill the canvas's parent element instead of the whole window (used by the ShipArt tool). */
  private fitParent: boolean;

  constructor(screen: HTMLCanvasElement, fitParent = false) {
    this.screen = screen;
    this.fitParent = fitParent;
    this.sctx = screen.getContext('2d')!;
    this.ctx = this.buffer.getContext('2d')!;
    this.resize();
  }

  private get dpr() {
    return window.devicePixelRatio || 1;
  }

  /** Match the screen canvas to the window (or parent) size. Call when it resizes. */
  resize() {
    const dpr = this.dpr;
    const box = this.fitParent ? this.screen.parentElement : null;
    this.screen.width = Math.max(1, Math.floor((box ? box.clientWidth : window.innerWidth) * dpr));
    this.screen.height = Math.max(1, Math.floor((box ? box.clientHeight : window.innerHeight) * dpr));
    this.screen.style.width = `${this.screen.width / dpr}px`;
    this.screen.style.height = `${this.screen.height / dpr}px`;
  }

  /** Set the zoom step (e.g. 4, 3, 2, 1, 0.5). The change animates. */
  setZoom(step: number, instant = false) {
    // At 1× and above, round so each game pixel is a whole number of real
    // screen pixels, even with Windows display scaling (125%, 150%...).
    const exact = step * this.dpr;
    this.targetScale = exact >= 1 ? Math.round(exact) : exact;
    if (instant) this.scale = this.targetScale;
  }

  /** Screen pixels per buffer pixel (1 when zoomed out below 1×, or in 'hires' mode). */
  private get bufferScale() {
    return this.rotation === 'hires' ? 1 : Math.max(1, this.scale);
  }

  /** Buffer pixels per game pixel: 1, less than 1 when zoomed out below 1×, or the zoom in 'hires' mode. */
  get worldScale() {
    return this.rotation === 'hires' ? this.scale : Math.min(1, this.scale);
  }

  /** Visible area in game pixels. */
  get viewWidth() {
    return this.screen.width / this.scale;
  }
  get viewHeight() {
    return this.screen.height / this.scale;
  }

  /** The visible area in world coordinates (as of the last `begin`). */
  get view() {
    const ws = this.worldScale;
    return { x: this.originX, y: this.originY, w: this.buffer.width / ws, h: this.buffer.height / ws };
  }

  /** Start a new frame. `dt` is the real time since the last frame. */
  begin(dt: number) {
    // Smooth zoom transition between steps.
    const diff = this.targetScale - this.scale;
    this.scale = Math.abs(diff) < 0.01 ? this.targetScale : this.scale + diff * Math.min(1, dt * 7);

    const bw = Math.ceil(this.screen.width / this.bufferScale);
    const bh = Math.ceil(this.screen.height / this.bufferScale);
    if (this.buffer.width !== bw || this.buffer.height !== bh) {
      this.buffer.width = bw;
      this.buffer.height = bh;
    }
    const ws = this.worldScale;
    this.originX = Math.round(this.camX - bw / ws / 2);
    this.originY = Math.round(this.camY - bh / ws / 2);
    // Shrunk art is smoothed so it doesn't flicker; enlarged art stays crisp.
    this.ctx.imageSmoothingEnabled = ws < 1;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.clearRect(0, 0, bw, bh);
  }

  /**
   * Draw a sprite at a world position. `time` picks the animation frame.
   * `fixedSize` keeps it at full size even when zoomed out below 1× (for UI like arrows).
   * `scale` draws it bigger or smaller than its art (e.g. an effect with a size upgrade).
   * `flipX` / `flipY` mirror it left–right / top–bottom (after rotating).
   */
  drawSprite(
    sprite: Sprite,
    x: number,
    y: number,
    angle = 0,
    time = 0,
    alpha = 1,
    fixedSize = false,
    scale = 1,
    flipX = false,
    flipY = false,
  ) {
    const f = frameAt(sprite, time);
    const ctx = this.ctx;
    const ws = this.worldScale;
    // Fixed-size sprites are never shrunk below 1×, but are enlarged like everything else in 'hires'.
    const k = (fixedSize ? Math.max(1, ws) : ws) * scale;
    ctx.globalAlpha = alpha;
    ctx.setTransform(k, 0, 0, k, Math.round((x - this.originX) * ws), Math.round((y - this.originY) * ws));
    if (angle !== 0) ctx.rotate(angle);
    if (flipX || flipY) ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, -sprite.anchorX, -sprite.anchorY, f.w, f.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /**
   * Draw a ship-like sprite turned to `angle`. In 'rotsprite' mode it uses a
   * RotSprite copy for the nearest angle step; otherwise it's drawSprite.
   */
  drawRotated(sprite: Sprite, x: number, y: number, angle: number, time = 0, alpha = 1) {
    if (this.rotation !== 'rotsprite') return this.drawSprite(sprite, x, y, angle, time, alpha);
    const r = rotatedFrame(frameAt(sprite, time), sprite.anchorX, sprite.anchorY, angleStep(angle));
    this.drawRotatedCopy(r, x, y, alpha, 1);
  }

  private drawRotatedCopy(r: { canvas: HTMLCanvasElement; x: number; y: number }, x: number, y: number, alpha: number, scale: number) {
    const ctx = this.ctx;
    const ws = this.worldScale;
    ctx.globalAlpha = alpha;
    ctx.setTransform(ws * scale, 0, 0, ws * scale, Math.round((x - this.originX) * ws), Math.round((y - this.originY) * ws));
    ctx.drawImage(r.canvas, r.x, r.y);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /**
   * Draw a sprite attached to something at (x, y) facing `angle`: it sits at
   * (ox, oy) in that thing's own pixels and turns with it, plus its own
   * `localAngle`. Used for ship parts, so they never wobble against the ship.
   */
  drawAttached(
    sprite: Sprite,
    x: number,
    y: number,
    angle: number,
    ox: number,
    oy: number,
    localAngle: number,
    time: number,
    alpha = 1,
    scale = 1,
    flipX = false,
    flipY = false,
  ) {
    const f = frameAt(sprite, time);
    if (this.rotation === 'rotsprite') {
      // Use the same angle step as the ship, so the part stays put on it.
      const a = stepAngle(angleStep(angle));
      const px = x + ox * Math.cos(a) - oy * Math.sin(a);
      const py = y + ox * Math.sin(a) + oy * Math.cos(a);
      const r = rotatedFrame(f, sprite.anchorX, sprite.anchorY, angleStep(a + localAngle), flipX, flipY);
      this.drawRotatedCopy(r, px, py, alpha, scale);
      return;
    }
    const ctx = this.ctx;
    const ws = this.worldScale;
    ctx.globalAlpha = alpha;
    ctx.setTransform(ws, 0, 0, ws, Math.round((x - this.originX) * ws), Math.round((y - this.originY) * ws));
    ctx.rotate(angle);
    ctx.translate(ox, oy);
    if (localAngle !== 0) ctx.rotate(localAngle);
    ctx.scale((flipX ? -1 : 1) * scale, (flipY ? -1 : 1) * scale);
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, -sprite.anchorX, -sprite.anchorY, f.w, f.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /**
   * Fill the whole view with a repeating tile. `parallax` < 1 makes it move
   * slower than the camera, so it feels far away.
   */
  drawTiled(sprite: Sprite, parallax: number) {
    // Backgrounds are never shrunk (tiny stars would vanish); they just scroll slower.
    // In 'hires' mode they're enlarged to match the zoom, so they look the same.
    const f = sprite.frames[0];
    const ctx = this.ctx;
    const ts = Math.max(1, Math.round(this.worldScale));
    const tw = f.w * ts;
    const th = f.h * ts;
    const ox = Math.round(this.originX * this.worldScale * parallax);
    const oy = Math.round(this.originY * this.worldScale * parallax);
    const startX = -(((ox % tw) + tw) % tw);
    const startY = -(((oy % th) + th) % th);
    for (let y = startY; y < this.buffer.height; y += th)
      for (let x = startX; x < this.buffer.width; x += tw) ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, x, y, tw, th);
  }

  /** Plain rectangle in world coordinates (used for health bars). Never thinner than 1 pixel. */
  fillRect(x: number, y: number, w: number, h: number, color: string) {
    const ws = this.worldScale;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(
      Math.round((x - this.originX) * ws),
      Math.round((y - this.originY) * ws),
      Math.max(1, Math.round(w * ws)),
      Math.max(1, Math.round(h * ws)),
    );
  }

  /** Copy the buffer to the screen, enlarged. */
  end() {
    this.sctx.imageSmoothingEnabled = false;
    this.sctx.fillStyle = '#000';
    this.sctx.fillRect(0, 0, this.screen.width, this.screen.height);
    this.sctx.drawImage(this.buffer, 0, 0, this.buffer.width * this.bufferScale, this.buffer.height * this.bufferScale);
  }

  /** Convert world coordinates to a position on the canvas in CSS pixels (as of the last `begin`). */
  worldToScreen(x: number, y: number) {
    return { x: ((x - this.originX) * this.scale) / this.dpr, y: ((y - this.originY) * this.scale) / this.dpr };
  }

  /** Convert a mouse position (CSS pixels) to world coordinates. */
  screenToWorld(cssX: number, cssY: number) {
    return {
      x: this.originX + (cssX * this.dpr) / this.scale,
      y: this.originY + (cssY * this.dpr) / this.scale,
    };
  }
}
