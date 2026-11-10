// Pixel-perfect renderer.
//
// The world is first drawn into a small "buffer" canvas where 1 pixel = 1 game
// pixel. That buffer is then enlarged onto the screen by a whole number
// (the zoom), which keeps pixel art crisp, even for rotated sprites.

import { frameAt, type Sprite } from './assets';

export class PixelRenderer {
  private screen: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private buffer = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;

  /** Screen pixels per game pixel. Animates smoothly toward `targetScale`. */
  scale = 4;
  private targetScale = 4;
  /** Camera centre, in world coordinates. */
  camX = 0;
  camY = 0;
  /** World coordinate of the buffer's top-left pixel (for the current frame). */
  private originX = 0;
  private originY = 0;

  constructor(screen: HTMLCanvasElement) {
    this.screen = screen;
    this.sctx = screen.getContext('2d')!;
    this.ctx = this.buffer.getContext('2d')!;
    this.resize();
  }

  private get dpr() {
    return window.devicePixelRatio || 1;
  }

  /** Match the screen canvas to the window size. Call when the window resizes. */
  resize() {
    const dpr = this.dpr;
    this.screen.width = Math.floor(window.innerWidth * dpr);
    this.screen.height = Math.floor(window.innerHeight * dpr);
    this.screen.style.width = `${this.screen.width / dpr}px`;
    this.screen.style.height = `${this.screen.height / dpr}px`;
  }

  /** Set the zoom step (e.g. 4, 3, 2, 1). The change animates. */
  setZoom(step: number, instant = false) {
    // Round so each game pixel is a whole number of real screen pixels,
    // even with Windows display scaling (125%, 150%...).
    this.targetScale = Math.max(1, Math.round(step * this.dpr));
    if (instant) this.scale = this.targetScale;
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
    return { x: this.originX, y: this.originY, w: this.buffer.width, h: this.buffer.height };
  }

  /** Start a new frame. `dt` is the real time since the last frame. */
  begin(dt: number) {
    // Smooth zoom transition between steps.
    const diff = this.targetScale - this.scale;
    this.scale = Math.abs(diff) < 0.01 ? this.targetScale : this.scale + diff * Math.min(1, dt * 7);

    const bw = Math.ceil(this.screen.width / this.scale);
    const bh = Math.ceil(this.screen.height / this.scale);
    if (this.buffer.width !== bw || this.buffer.height !== bh) {
      this.buffer.width = bw;
      this.buffer.height = bh;
    }
    this.originX = Math.round(this.camX - bw / 2);
    this.originY = Math.round(this.camY - bh / 2);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.clearRect(0, 0, bw, bh);
  }

  /** Draw a sprite at a world position. `time` picks the animation frame. */
  drawSprite(sprite: Sprite, x: number, y: number, angle = 0, time = 0, alpha = 1) {
    const f = frameAt(sprite, time);
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.setTransform(1, 0, 0, 1, Math.round(x - this.originX), Math.round(y - this.originY));
    if (angle !== 0) ctx.rotate(angle);
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, -sprite.anchorX, -sprite.anchorY, f.w, f.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /**
   * Fill the whole view with a repeating tile. `parallax` < 1 makes it move
   * slower than the camera, so it feels far away.
   */
  drawTiled(sprite: Sprite, parallax: number) {
    const f = sprite.frames[0];
    const ctx = this.ctx;
    const ox = Math.round(this.originX * parallax);
    const oy = Math.round(this.originY * parallax);
    const startX = -(((ox % f.w) + f.w) % f.w);
    const startY = -(((oy % f.h) + f.h) % f.h);
    for (let y = startY; y < this.buffer.height; y += f.h)
      for (let x = startX; x < this.buffer.width; x += f.w) ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, x, y, f.w, f.h);
  }

  /** Plain rectangle in world coordinates (used for health bars). */
  fillRect(x: number, y: number, w: number, h: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x - this.originX), Math.round(y - this.originY), w, h);
  }

  /** Copy the buffer to the screen, enlarged. */
  end() {
    this.sctx.imageSmoothingEnabled = false;
    this.sctx.fillStyle = '#000';
    this.sctx.fillRect(0, 0, this.screen.width, this.screen.height);
    this.sctx.drawImage(this.buffer, 0, 0, this.buffer.width * this.scale, this.buffer.height * this.scale);
  }

  /** Convert a mouse position (CSS pixels) to world coordinates. */
  screenToWorld(cssX: number, cssY: number) {
    return {
      x: this.originX + (cssX * this.dpr) / this.scale,
      y: this.originY + (cssY * this.dpr) / this.scale,
    };
  }
}
