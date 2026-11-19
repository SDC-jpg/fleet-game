// Colour gradients laid over art (bosses, ShipArt → Bosses → Gradients), mixed in like
// Photoshop's blend modes. A tinted copy of an image is made once and kept (per image, per
// place along the gradient), so drawing costs nothing extra. The gradient runs down the image
// (art faces up: its top row is the front), and `rowT` says where each row falls along the body.

import type { Frame, Sprite } from "../engine/assets";
import type { BlendMode, BossGradient, GradientStop } from "./artLayout";

/** The blend modes offered, in menu order, with their names as in Photoshop. */
export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: "multiply", label: "Multiply" },
  { id: "screen", label: "Screen" },
  { id: "color-dodge", label: "Color Dodge" },
  { id: "linear-dodge", label: "Linear Dodge (Add)" },
  { id: "soft-light", label: "Soft Light" },
  { id: "hard-light", label: "Hard Light" },
  { id: "hue", label: "Hue" },
  { id: "color", label: "Color" },
];

/** A new gradient: white at the head to black at the tail. */
export const newGradient = (): BossGradient => ({
  mode: "multiply",
  opacity: 1,
  start: 0,
  end: 1,
  stops: [
    { at: 0, color: "#ffffff", opacity: 1 },
    { at: 1, color: "#000000", opacity: 1 },
  ],
});

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const rgbToHex = ([r, g, b]: RGB) =>
  "#" +
  [r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

/** The gradient's colour and strength at `t` (0 = its first stop's end... in its own 0–1), between the two stops around it. */
export function sampleStops(
  stops: GradientStop[],
  t: number,
): { rgb: RGB; opacity: number } {
  const s = [...stops].sort((a, b) => a.at - b.at);
  if (s.length === 0) return { rgb: [1, 1, 1], opacity: 0 };
  if (t <= s[0].at) return { rgb: hexToRgb(s[0].color), opacity: s[0].opacity };
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].at) {
      const a = s[i - 1];
      const b = s[i];
      const f = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1;
      const ca = hexToRgb(a.color);
      const cb = hexToRgb(b.color);
      return {
        rgb: [0, 1, 2].map((k) => ca[k] + (cb[k] - ca[k]) * f) as RGB,
        opacity: a.opacity + (b.opacity - a.opacity) * f,
      };
    }
  }
  const last = s[s.length - 1];
  return { rgb: hexToRgb(last.color), opacity: last.opacity };
}

// == Blend modes (Photoshop's formulas; colours 0–1; b = the art, s = the gradient) ==

const lum = ([r, g, b]: RGB) => 0.3 * r + 0.59 * g + 0.11 * b;
function clipColor(c: RGB): RGB {
  const l = lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  let out = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as RGB;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as RGB;
  return out;
}
const setLum = (c: RGB, l: number) => {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
};
const sat = (c: RGB) => Math.max(...c) - Math.min(...c);
function setSat(c: RGB, s: number): RGB {
  const x = Math.max(...c);
  const n = Math.min(...c);
  if (x === n) return [0, 0, 0];
  return c.map((v) => ((v - n) * s) / (x - n)) as RGB;
}
const softLight = (b: number, s: number) =>
  s <= 0.5
    ? b - (1 - 2 * s) * b * (1 - b)
    : b +
      (2 * s - 1) *
        ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b);
const multiply = (b: number, s: number) => b * s;
const screen = (b: number, s: number) => b + s - b * s;

export function blend(mode: BlendMode, b: RGB, s: RGB): RGB {
  const each = (f: (b: number, s: number) => number) =>
    [f(b[0], s[0]), f(b[1], s[1]), f(b[2], s[2])] as RGB;
  switch (mode) {
    case "multiply":
      return each(multiply);
    case "screen":
      return each(screen);
    case "color-dodge":
      return each((b, s) =>
        b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)),
      );
    case "linear-dodge":
      return each((b, s) => Math.min(1, b + s));
    case "soft-light":
      return each(softLight);
    case "hard-light":
      return each((b, s) =>
        s <= 0.5 ? multiply(b, 2 * s) : screen(b, 2 * s - 1),
      );
    case "hue":
      return setLum(setSat(s, sat(b)), lum(b));
    case "color":
      return setLum(s, lum(b));
  }
}

/** Where a row of an image falls along the body: t = a + b × row (0 = tip of the head, 1 = end of the tail). */
export interface RowT {
  a: number;
  b: number;
}

/** The gradients that actually show (not hidden, some opacity, at least one stop). */
export const shownGradients = (list: BossGradient[]) =>
  list.filter((g) => !g.hidden && g.opacity > 0 && g.stops.length > 0);

function tintFrame(f: Frame, gradients: BossGradient[], at: RowT): Frame {
  const c = document.createElement("canvas");
  c.width = f.w;
  c.height = f.h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, 0, 0, f.w, f.h);
  const img = ctx.getImageData(0, 0, f.w, f.h);
  const d = img.data;
  for (let y = 0; y < f.h; y++) {
    const t = at.a + at.b * (y + 0.5);
    // Each gradient's colour for this row (the same all the way across).
    const rows = gradients.map((g) => {
      const span = g.end - g.start;
      const { rgb, opacity } = sampleStops(
        g.stops,
        span !== 0 ? (t - g.start) / span : 0,
      );
      return {
        mode: g.mode,
        rgb,
        k: Math.max(0, Math.min(1, opacity * g.opacity)),
      };
    });
    for (let x = 0; x < f.w; x++) {
      const i = (y * f.w + x) * 4;
      if (d[i + 3] === 0) continue;
      let c: RGB = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
      for (const r of rows) {
        if (r.k <= 0) continue;
        const m = blend(r.mode, c, r.rgb);
        c = [
          c[0] + (m[0] - c[0]) * r.k,
          c[1] + (m[1] - c[1]) * r.k,
          c[2] + (m[2] - c[2]) * r.k,
        ];
      }
      d[i] = Math.round(Math.max(0, Math.min(1, c[0])) * 255);
      d[i + 1] = Math.round(Math.max(0, Math.min(1, c[1])) * 255);
      d[i + 2] = Math.round(Math.max(0, Math.min(1, c[2])) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { image: c, sx: 0, sy: 0, w: f.w, h: f.h };
}

/** Tinted copies made so far, per source sprite: for one set of gradients (`sig`), by place along the body. */
const copies = new WeakMap<
  Sprite,
  { sig: string; byPlace: Map<string, Sprite> }
>();

/**
 * `sprite` with these gradients laid over it, its rows falling at `at` along the body.
 * `sig` identifies the gradients (e.g. their JSON); when it changes, older copies are dropped.
 */
export function tintedSprite(
  sprite: Sprite,
  gradients: BossGradient[],
  sig: string,
  at: RowT,
): Sprite {
  if (gradients.length === 0) return sprite;
  let entry = copies.get(sprite);
  if (!entry || entry.sig !== sig)
    copies.set(sprite, (entry = { sig, byPlace: new Map() }));
  const key = `${at.a.toFixed(4)}|${at.b.toFixed(6)}`;
  let out = entry.byPlace.get(key);
  if (!out) {
    out = {
      ...sprite,
      frames: sprite.frames.map((f) => tintFrame(f, gradients, at)),
    };
    entry.byPlace.set(key, out);
  }
  return out;
}
