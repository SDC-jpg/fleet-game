// Smooth glow behind effects (a sprite's "glow" in manifest.json, set in ShipArt's Effects section).
//
// The game draws into a small pixel buffer that is enlarged onto the screen, so a soft glow
// can't live there (it would come out in blocks). Instead, each glowing sprite drawn this frame
// is also remembered, and at the end of the frame its glow is drawn on a canvas of its own laid
// over the game canvas: at a lower resolution than the screen (it's soft anyway; the browser
// stretches it smoothly) and blended with the picture beneath by CSS `mix-blend-mode`, one canvas
// per blend mode.
//
// A glow follows the image's outline (like Photoshop's Outer Glow): its silhouette is grown by
// `spread` game pixels, blurred by `softness`, coloured, and cut away where the image itself is,
// so it sits behind the image.

import type { Frame } from './assets';

export type GlowMode = 'color-dodge' | 'linear-dodge';
export const GLOW_MODES: GlowMode[] = ['color-dodge', 'linear-dodge'];
export const GLOW_MODE_LABELS: Record<GlowMode, string> = { 'color-dodge': 'Color Dodge', 'linear-dodge': 'Linear Dodge' };

/** A sprite's glow (manifest "glow"). Sizes are in game pixels, so the glow grows with the zoom like the art. */
export interface Glow {
  /** "#rrggbb". */
  color: string;
  mode: GlowMode;
  /** 0–1. */
  opacity: number;
  /** How far the glow stays solid around the image before it starts to fade (game pixels). */
  spread: number;
  /** How far it fades out beyond that (game pixels; the blur). */
  softness: number;
  /** Switched off, settings kept. */
  hidden?: boolean;
}

/** What "+ Glow" starts with: a blue glow like the user's beam mockup. */
export const DEFAULT_GLOW: Glow = { color: '#3a7bff', mode: 'linear-dodge', opacity: 0.8, spread: 2, softness: 10 };

/** The glow canvas is this many screen pixels per glow pixel on a 1080-tall screen (more on bigger screens). */
const GLOW_PIXELS_PER_1080 = 2;

type Op = { frame: Frame; m: DOMMatrix; ax: number; ay: number; alpha: number };
type Group = { glow: Glow; ops: Op[] };

const canFilter = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
const cssMode = (mode: GlowMode) =>
  mode === 'color-dodge' ? 'color-dodge' : typeof CSS !== 'undefined' && CSS.supports('mix-blend-mode', 'plus-lighter') ? 'plus-lighter' : 'screen';

export class GlowLayers {
  private layers = new Map<GlowMode, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; used: boolean }>();
  private groups = new Map<string, Group>();
  /** Scratch canvases: the silhouettes, the grown and coloured glow, and a small one for the blur fallback. */
  private shape = document.createElement('canvas');
  private grown = document.createElement('canvas');
  private small = document.createElement('canvas');
  /** Off = remember nothing and hide the canvases. */
  enabled = true;

  private screen: HTMLCanvasElement;

  constructor(screen: HTMLCanvasElement) {
    this.screen = screen;
    // Laid over the game canvas, in the order of GLOW_MODES (the CRT canvas, added later, goes between).
    let after: Element = screen;
    for (const mode of GLOW_MODES) {
      const canvas = document.createElement('canvas');
      canvas.className = 'glow-canvas';
      canvas.style.display = 'none';
      canvas.style.mixBlendMode = cssMode(mode);
      after.after(canvas);
      after = canvas;
      this.layers.set(mode, { canvas, ctx: canvas.getContext('2d')!, used: false });
    }
  }

  /** Forget last frame's glowing sprites. */
  begin() {
    this.groups.clear();
  }

  /**
   * Remember a glowing frame drawn this frame: `m` maps the frame's pixels (anchored at ax, ay)
   * to the renderer's buffer, as the buffer's drawing transform was when it was drawn.
   */
  add(glow: Glow, frame: Frame, m: DOMMatrix, ax: number, ay: number, alpha: number) {
    if (!this.enabled || glow.hidden || glow.opacity <= 0 || alpha <= 0) return;
    const key = `${glow.mode}|${glow.color}|${glow.opacity}|${glow.spread}|${glow.softness}`;
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = { glow, ops: [] }));
    g.ops.push({ frame, m, ax, ay, alpha });
  }

  /**
   * Draw this frame's glows. `bufferScale`: screen pixels per buffer pixel; `screenScale`: screen
   * pixels per game pixel.
   */
  render(bufferScale: number, screenScale: number) {
    const sw = this.screen.width;
    const sh = this.screen.height;
    const down = Math.max(1, (sh / 1080) * GLOW_PIXELS_PER_1080);
    const w = Math.ceil(sw / down);
    const h = Math.ceil(sh / down);
    const toGlow = bufferScale / down; // glow pixels per buffer pixel
    const perGamePixel = screenScale / down; // glow pixels per game pixel
    for (const layer of this.layers.values()) {
      if (layer.used) layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      layer.used = false;
    }
    if (this.enabled)
      for (const g of this.groups.values()) {
        const layer = this.layers.get(g.glow.mode) ?? this.layers.get('linear-dodge')!;
        if (layer.canvas.width !== w || layer.canvas.height !== h) {
          layer.canvas.width = w;
          layer.canvas.height = h;
        }
        if (this.drawGroup(layer.ctx, g, toGlow, perGamePixel, w, h)) layer.used = true;
      }
    for (const layer of this.layers.values()) {
      layer.canvas.style.display = layer.used ? 'block' : 'none';
      layer.canvas.style.width = this.screen.style.width;
      layer.canvas.style.height = this.screen.style.height;
    }
  }

  /** Hide everything (e.g. while nothing is drawn). */
  hide() {
    for (const layer of this.layers.values()) layer.canvas.style.display = 'none';
  }

  private drawGroup(out: CanvasRenderingContext2D, g: Group, toGlow: number, perGamePixel: number, w: number, h: number) {
    const spread = Math.max(0, g.glow.spread) * perGamePixel;
    const soft = Math.max(0, g.glow.softness) * perGamePixel;
    const pad = Math.ceil(spread + soft * 2 + 2);
    // The area these sprites cover on the glow canvas, plus room for the glow, cut to the canvas.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const ops: { op: Op; m: DOMMatrix }[] = [];
    for (const op of g.ops) {
      const m = new DOMMatrix().scale(toGlow, toGlow).multiply(op.m).translate(-op.ax, -op.ay);
      for (const [px, py] of [
        [0, 0],
        [op.frame.w, 0],
        [0, op.frame.h],
        [op.frame.w, op.frame.h],
      ]) {
        const p = m.transformPoint({ x: px, y: py });
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      ops.push({ op, m });
    }
    x0 = Math.max(0, Math.floor(x0 - pad));
    y0 = Math.max(0, Math.floor(y0 - pad));
    x1 = Math.min(w, Math.ceil(x1 + pad));
    y1 = Math.min(h, Math.ceil(y1 + pad));
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return false;

    // 1. The silhouettes (smoothed: this is the soft layer).
    const shape = fit(this.shape, bw, bh);
    shape.setTransform(1, 0, 0, 1, 0, 0);
    shape.clearRect(0, 0, bw, bh);
    shape.imageSmoothingEnabled = true;
    for (const { op, m } of ops) {
      shape.globalAlpha = op.alpha;
      shape.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
      shape.drawImage(op.frame.image, op.frame.sx, op.frame.sy, op.frame.w, op.frame.h, 0, 0, op.frame.w, op.frame.h);
    }
    shape.setTransform(1, 0, 0, 1, 0, 0);
    shape.globalAlpha = 1;

    // 2. Grown by `spread` (copies shifted around rings), then coloured.
    const grown = fit(this.grown, bw, bh);
    grown.globalCompositeOperation = 'source-over';
    grown.clearRect(0, 0, bw, bh);
    grown.drawImage(this.shape, 0, 0, bw, bh, 0, 0, bw, bh);
    if (spread >= 0.5) {
      const rings = Math.min(4, Math.ceil(spread / 2));
      for (let r = 1; r <= rings; r++) {
        const radius = (spread * r) / rings;
        const n = Math.min(32, Math.max(8, Math.ceil((2 * Math.PI * radius) / 2)));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          grown.drawImage(this.shape, 0, 0, bw, bh, Math.cos(a) * radius, Math.sin(a) * radius, bw, bh);
        }
      }
    }
    grown.globalCompositeOperation = 'source-in';
    grown.fillStyle = g.glow.color;
    grown.fillRect(0, 0, bw, bh);
    grown.globalCompositeOperation = 'source-over';

    // 3. Blurred by `softness` onto the layer.
    out.save();
    out.globalAlpha = Math.min(1, g.glow.opacity);
    if (soft >= 0.5 && canFilter) {
      out.filter = `blur(${soft / 2}px)`;
      out.drawImage(this.grown, 0, 0, bw, bh, x0, y0, bw, bh);
    } else if (soft >= 0.5) {
      // No canvas blur in this browser: shrink and stretch back (smoothly), which blurs too.
      const k = Math.max(1, soft / 2);
      const sw = Math.max(1, Math.round(bw / k));
      const sh = Math.max(1, Math.round(bh / k));
      const small = fit(this.small, sw, sh);
      small.clearRect(0, 0, sw, sh);
      small.imageSmoothingEnabled = true;
      small.drawImage(this.grown, 0, 0, bw, bh, 0, 0, sw, sh);
      out.imageSmoothingEnabled = true;
      out.drawImage(this.small, 0, 0, sw, sh, x0, y0, bw, bh);
    } else out.drawImage(this.grown, 0, 0, bw, bh, x0, y0, bw, bh);
    out.restore();

    // 4. Cut away where the image itself is, so the glow sits behind it.
    out.save();
    out.globalCompositeOperation = 'destination-out';
    out.drawImage(this.shape, 0, 0, bw, bh, x0, y0, bw, bh);
    out.restore();
    return true;
  }
}

/** Make a scratch canvas at least w × h and return its context. */
function fit(c: HTMLCanvasElement, w: number, h: number) {
  if (c.width < w || c.height < h) {
    c.width = Math.max(c.width, w);
    c.height = Math.max(c.height, h);
  }
  return c.getContext('2d')!;
}
