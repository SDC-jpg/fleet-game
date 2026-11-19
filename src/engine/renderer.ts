// Pixel-perfect renderer.
//
// The world is first drawn into a small "buffer" canvas where 1 pixel = 1 game
// pixel. That buffer is then enlarged onto the screen by a whole number
// (the zoom), which keeps pixel art crisp, even for rotated sprites.
//
// Zoomed out below 1×, the buffer is screen-sized instead and the art is
// shrunk smoothly into it (a little softer, but nothing flickers).
//
// Detail steps (docs/DETAIL-STEPS.md): `detail` below 1 draws the whole world
// smaller inside the buffer (like zooming out, but the zoom itself stays a whole
// number). Art drawn at a tier size step (1.5×, 1.5²×... of the detail factor) uses
// shrunk copies that keep only the art's own colours (shrink.ts), drawn 1 buffer
// pixel per copy pixel, so it stays crisp pixel art.
//
// Rotated pixel art can look crunchy ("laddering"), so there are three ways
// to rotate (`rotation`), to compare:
//   'grid'      rotate on the game-pixel grid (the original way)
//   'hires'     draw everything at screen resolution: pixels tilt as solid squares
//   'rotsprite' ships and their parts use RotSprite copies (see rotsprite.ts),
//               snapped to 128 angle steps, staying on the pixel grid

import { frameAt, type Frame, type Sprite } from './assets';
import { angleStep, rotatedFrame, stepAngle } from './rotsprite';
import { shrunkFrame } from './shrink';
import type { CrtFilter, CrtParams } from './crt';

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
  /**
   * Detail factor (1 = normal; 1/1.5 per detail step): the world is drawn this much
   * smaller. Animates toward its target like the zoom.
   */
  detail = 1;
  private targetDetail = 1;
  /**
   * Shrunk art sizes count as "a tier size step" (and get crisp copies) when they're this
   * multiple of the detail factor apart: CONFIG.tiers.sizePerTier (set by the game).
   */
  detailStep = 1.5;
  /** Camera centre, in world coordinates. */
  camX = 0;
  camY = 0;
  /** World coordinate of the buffer's top-left pixel (for the current frame). */
  private originX = 0;
  private originY = 0;

  /** How rotated sprites are drawn (see the top of this file). */
  rotation: RotationMode = 'grid';
  /**
   * In 'rotsprite' mode, art bigger than this (width × height of one frame, in art
   * pixels) is drawn as in 'grid' instead: its 8× copy and rotated copies would take
   * too much memory and time (about tier 6 ships and up). 324 × 324 = a tier-5 ship.
   */
  rotSpriteMaxArea = 324 * 324;

  /** Whether this sprite is small enough for RotSprite (see rotSpriteMaxArea). */
  rotSpriteFits(sprite: Sprite) {
    const f = sprite.frames[0];
    return !f || f.w * f.h <= this.rotSpriteMaxArea;
  }

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

  /**
   * Physical screen pixels per zoom unit. In the game, zoom steps are measured
   * against a 1080-pixel-tall monitor, using the monitor's real pixels (not
   * Windows-scaled ones): zoom 3 shows a 360-pixel-tall view on any monitor
   * and with any Windows display scaling. In ShipArt (fitParent), a zoom step
   * is simply screen pixels per art pixel.
   */
  private get zoomUnit() {
    if (this.fitParent) return this.dpr;
    return Math.max(1, window.screen.height * this.dpr) / 1080;
  }

  /** Set the zoom step (e.g. 4, 3, 2, 1, 0.5). The change animates. */
  setZoom(step: number, instant = false, unrounded = false) {
    // At 1× and above, round so each game pixel is a whole number of real
    // screen pixels, even with Windows display scaling (125%, 150%...).
    // `unrounded`: a brief dramatic zoom in between (pixels may be a little uneven meanwhile).
    const exact = step * this.zoomUnit;
    this.targetScale = exact >= 1 && !unrounded ? Math.round(exact) : exact;
    if (instant) this.scale = this.targetScale;
  }

  /** Set the detail factor (1 = normal, 1/1.5 per detail step). The change animates. */
  setDetail(factor: number, instant = false) {
    this.targetDetail = factor;
    if (instant) this.detail = factor;
  }

  /** Screen pixels per buffer pixel (1 when zoomed out below 1×, or in 'hires' mode). */
  private get bufferScale() {
    return this.rotation === 'hires' ? 1 : Math.max(1, this.scale);
  }

  /** Buffer pixels per game pixel: 1, less than 1 when zoomed out below 1×, or the zoom in 'hires' mode. */
  get worldScale() {
    return (this.rotation === 'hires' ? this.scale : Math.min(1, this.scale)) * this.detail;
  }

  /** Screen pixels per game pixel (zoom and detail factor together). */
  private get screenScale() {
    return this.scale * this.detail;
  }

  /** Visible area in game pixels. */
  get viewWidth() {
    return this.screen.width / this.screenScale;
  }
  get viewHeight() {
    return this.screen.height / this.screenScale;
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
    const dd = this.targetDetail - this.detail;
    this.detail = Math.abs(dd) < 0.002 ? this.targetDetail : this.detail + dd * Math.min(1, dt * 7);

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
    ctx.setTransform(1, 0, 0, 1, Math.round((x - this.originX) * ws), Math.round((y - this.originY) * ws));
    if (angle !== 0) ctx.rotate(angle);
    if (flipX || flipY) ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    this.blit(f, sprite.anchorX, sprite.anchorY, k);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /**
   * Draw a frame (anchored at the current origin) `k` times its art size. Shrunk by a
   * tier size step while the detail factor is settled, it uses a crisp shrunk copy
   * (shrink.ts) instead of smoothing the art down.
   */
  private blit(f: Frame, anchorX: number, anchorY: number, k: number) {
    const ctx = this.ctx;
    const copyAt = this.crispSize(k);
    if (copyAt) {
      const c = shrunkFrame(f, copyAt);
      ctx.imageSmoothingEnabled = false;
      if (k !== copyAt) ctx.scale(k / copyAt, k / copyAt);
      ctx.drawImage(c, -Math.round(anchorX * copyAt), -Math.round(anchorY * copyAt));
      ctx.imageSmoothingEnabled = this.worldScale < 1;
      return;
    }
    // Only art drawn smaller than its pixels is smoothed (so it doesn't flicker); full size and up stays crisp.
    const smooth = this.worldScale < 1;
    if (smooth && k >= 0.999) ctx.imageSmoothingEnabled = false;
    ctx.scale(k, k);
    ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, -anchorX, -anchorY, f.w, f.h);
    ctx.imageSmoothingEnabled = smooth;
  }

  /**
   * The size to make a crisp shrunk copy at, for art drawn `k` times its size, or 0 to
   * draw it normally: only while shrunk by detail steps (settled, not mid-change) and at
   * a tier size step from the world's scale (ships, parts, tier art; not freely growing effects).
   */
  private crispSize(k: number) {
    if (this.detail >= 1 || this.detail !== this.targetDetail || k >= 0.999 || this.rotation === 'hires') return 0;
    const ws = this.worldScale;
    const steps = Math.log(k / ws) / Math.log(this.detailStep);
    const j = Math.round(steps);
    if (Math.abs(steps - j) > 0.01) return 0;
    return ws * this.detailStep ** j;
  }

  /** Scratch canvas for drawRefracted. */
  private refractCanvas = document.createElement('canvas');

  /**
   * Draw a sprite as if it were glass: inside its silhouette, whatever is
   * already drawn behind it shows through, shifted `shift` game pixels (the
   * Cloaking skill). Draw the faint sprite itself on top for an outline.
   */
  drawRefracted(sprite: Sprite, x: number, y: number, angle: number, time = 0, shift = 2, scale = 1) {
    const f = frameAt(sprite, time);
    const ws = this.worldScale;
    const size = Math.ceil(Math.hypot(f.w, f.h) * ws * scale) + 4;
    const c = this.refractCanvas;
    if (c.width < size || c.height < size) {
      c.width = Math.max(c.width, size);
      c.height = Math.max(c.height, size);
    }
    const r = c.getContext('2d')!;
    r.imageSmoothingEnabled = false;
    const half = Math.round(size / 2);
    const sx = Math.round((x - this.originX) * ws) - half;
    const sy = Math.round((y - this.originY) * ws) - half;
    r.setTransform(1, 0, 0, 1, 0, 0);
    r.globalCompositeOperation = 'source-over';
    r.clearRect(0, 0, size, size);
    // What's behind, shifted, then cut to the sprite's shape.
    const d = Math.round(shift * ws);
    r.drawImage(this.buffer, sx + d, sy + Math.round(d / 2), size, size, 0, 0, size, size);
    r.globalCompositeOperation = 'destination-in';
    r.setTransform(ws * scale, 0, 0, ws * scale, half, half);
    if (angle !== 0) r.rotate(angle);
    r.drawImage(f.image, f.sx, f.sy, f.w, f.h, -sprite.anchorX, -sprite.anchorY, f.w, f.h);
    r.setTransform(1, 0, 0, 1, 0, 0);
    r.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(c, 0, 0, size, size, sx, sy, size, size);
  }

  /**
   * Draw a ship-like sprite turned to `angle`. In 'rotsprite' mode it uses a
   * RotSprite copy for the nearest angle step (if the art isn't too big for it); otherwise it's drawSprite.
   * `scale` draws it bigger (e.g. a tier with no art of its own, using a smaller tier's).
   */
  drawRotated(sprite: Sprite, x: number, y: number, angle: number, time = 0, alpha = 1, scale = 1) {
    // Shrunk by detail steps, ships are drawn as in Grid (RotSprite copies are full size).
    if (this.rotation !== 'rotsprite' || !this.rotSpriteFits(sprite) || this.detail < 1)
      return this.drawSprite(sprite, x, y, angle, time, alpha, false, scale);
    const r = rotatedFrame(frameAt(sprite, time), sprite.anchorX, sprite.anchorY, angleStep(angle));
    this.drawRotatedCopy(r, x, y, alpha, scale);
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
    if (this.rotation === 'rotsprite' && this.detail >= 1) {
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
    ctx.setTransform(1, 0, 0, 1, Math.round((x - this.originX) * ws), Math.round((y - this.originY) * ws));
    ctx.rotate(angle);
    ctx.translate(ox * ws, oy * ws);
    if (localAngle !== 0) ctx.rotate(localAngle);
    if (flipX || flipY) ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    this.blit(f, sprite.anchorX, sprite.anchorY, ws * scale);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /**
   * Draw a vertical slice of a sprite (its columns u0 to u1) at (x, y) turned to `angle`, with the
   * slice's point (ax, ay) (in the slice's own pixels) there. `flipY` mirrors it top–bottom around
   * that point. Used for bending images (Leviathan fins: one slice per bone). Always drawn as in Grid.
   */
  drawSlice(sprite: Sprite, time: number, u0: number, u1: number, ax: number, ay: number, x: number, y: number, angle: number, scale = 1, flipY = false, alpha = 1) {
    const f = frameAt(sprite, time);
    const w = Math.min(f.w, u1) - Math.max(0, u0);
    if (w <= 0) return;
    const ctx = this.ctx;
    const ws = this.worldScale;
    ctx.globalAlpha = alpha;
    ctx.setTransform(1, 0, 0, 1, Math.round((x - this.originX) * ws), Math.round((y - this.originY) * ws));
    if (angle !== 0) ctx.rotate(angle);
    const k = ws * scale;
    ctx.scale(k, flipY ? -k : k);
    ctx.drawImage(f.image, f.sx + Math.max(0, u0), f.sy, w, f.h, -ax, -ay, w, f.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /**
   * Fill the whole view with a repeating tile. `parallax` < 1 makes it move
   * slower than the camera, so it feels far away.
   */
  drawTiled(sprite: Sprite, parallax: number, alpha = 1, offsetX = 0, offsetY = 0) {
    // Backgrounds are never shrunk (tiny stars would vanish); they just scroll slower.
    // In 'hires' mode they're enlarged to match the zoom, so they look the same.
    const f = sprite.frames[0];
    const ctx = this.ctx;
    const ts = Math.max(1, Math.round(this.worldScale));
    const tw = f.w * ts;
    const th = f.h * ts;
    // `offset` (game pixels) shifts the tiles, e.g. for the long-exposure smear of Time Dilation.
    const ox = Math.round((this.originX + offsetX) * this.worldScale * parallax);
    const oy = Math.round((this.originY + offsetY) * this.worldScale * parallax);
    ctx.globalAlpha = alpha;
    const startX = -(((ox % tw) + tw) % tw);
    const startY = -(((oy % th) + th) % th);
    for (let y = startY; y < this.buffer.height; y += th)
      for (let x = startX; x < this.buffer.width; x += tw) ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, x, y, tw, th);
    ctx.globalAlpha = 1;
  }

  /**
   * Cover everything drawn so far with a colour: 'multiply' tints it (like a colour filter),
   * 'source-over' lays a see-through haze over it. Used for the background's colour shifts.
   */
  fillView(color: string, alpha: number, mode: GlobalCompositeOperation = 'source-over') {
    if (alpha <= 0) return;
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = mode;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.buffer.width, this.buffer.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** A thin line between two world points, fading from `alphaFrom` to `alphaTo` (HUD lines). `width` in screen-ish pixels. */
  drawLine(x1: number, y1: number, x2: number, y2: number, color: string, alphaFrom = 1, alphaTo = 1, width = 1) {
    const ctx = this.ctx;
    const ws = this.worldScale;
    const ax = (x1 - this.originX) * ws;
    const ay = (y1 - this.originY) * ws;
    const bx = (x2 - this.originX) * ws;
    const by = (y2 - this.originY) * ws;
    const g = ctx.createLinearGradient(ax, ay, bx, by);
    g.addColorStop(0, withAlpha(color, alphaFrom));
    g.addColorStop(1, withAlpha(color, alphaTo));
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1, width * Math.min(1, ws));
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
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

  /** The CRT screen effect (crt.ts) and its settings, if the game uses it. */
  crt: { filter: CrtFilter; params: CrtParams } | null = null;

  /** Copy the buffer to the screen, enlarged (through the CRT effect when it's on). */
  end() {
    if (this.crt?.params.enabled && this.crt.filter.render(this.buffer, this.bufferScale, this.crt.params)) return;
    this.crt?.filter.hide();
    this.sctx.imageSmoothingEnabled = false;
    this.sctx.fillStyle = '#000';
    this.sctx.fillRect(0, 0, this.screen.width, this.screen.height);
    this.sctx.drawImage(this.buffer, 0, 0, this.buffer.width * this.bufferScale, this.buffer.height * this.bufferScale);
  }

  /** For the test bar: the monitor's real size, Windows display scaling, and screen pixels per art pixel. */
  get displayInfo() {
    const dpr = this.dpr;
    return {
      monitor: `${Math.round(window.screen.width * dpr)}×${Math.round(window.screen.height * dpr)}`,
      scaling: Math.round(dpr * 100),
      pixelsPerArtPixel: Math.round(this.screenScale * 100) / 100,
    };
  }

  /** Convert world coordinates to a position on the canvas in CSS pixels (as of the last `begin`). */
  worldToScreen(x: number, y: number) {
    const k = this.screenScale;
    return { x: ((x - this.originX) * k) / this.dpr, y: ((y - this.originY) * k) / this.dpr };
  }

  /** Convert a mouse position (CSS pixels) to world coordinates. */
  screenToWorld(cssX: number, cssY: number) {
    return {
      x: this.originX + (cssX * this.dpr) / this.screenScale,
      y: this.originY + (cssY * this.dpr) / this.screenScale,
    };
  }
}

/** "#5fc4ff" and 0.4 → "rgba(95, 196, 255, 0.4)". */
function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}
