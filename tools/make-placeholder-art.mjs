// Generates the placeholder pixel art as PNG files in public/assets/.
//
//   npm run make-art            -> only creates files that don't exist yet
//   npm run make-art -- --force -> overwrites everything (careful: replaces your art!)
//
// No libraries needed: this file includes a tiny PNG writer.

import { deflateSync } from 'node:zlib';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = fileURLToPath(new URL('../public/assets/', import.meta.url));
const FORCE = process.argv.includes('--force');

// ---------- Tiny PNG writer ----------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * (img.w * 4 + 1)] = 0; // filter: none
    Buffer.from(img.data.buffer, y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Simple pixel canvas ----------
class Img {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  set(x, y, c) {
    if (!this.inside(x, y)) return;
    this.data.set(c, (y * this.w + x) * 4);
  }
  alpha(x, y) {
    return this.inside(x, y) ? this.data[(y * this.w + x) * 4 + 3] : 0;
  }
  // Copy another image into this one at (ox, oy).
  blit(src, ox, oy) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        if (src.data[i + 3]) this.set(ox + x, oy + y, src.data.subarray(i, i + 4));
      }
  }
}

const hex = (s, a = 255) => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
  a,
];
const CLEAR = [0, 0, 0, 0];

// Deterministic random numbers, so the art is the same every run.
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Per-pixel noise that stays the same for the same (x, y).
const noise = (x, y, s = 0) => rng(x * 7919 + y * 104729 + s * 15485863)();

function inPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function fillPolygon(img, pts, colorAt) {
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (inPolygon(x + 0.5, y + 0.5, pts)) img.set(x, y, colorAt(x, y));
}
// Adds a 1-pixel outline around everything that is drawn.
function outline(img, color) {
  const edge = [];
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (!img.alpha(x, y) && (img.alpha(x - 1, y) || img.alpha(x + 1, y) || img.alpha(x, y - 1) || img.alpha(x, y + 1)))
        edge.push([x, y]);
  for (const [x, y] of edge) img.set(x, y, color);
}
function disc(img, cx, cy, r, color) {
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) img.set(x, y, color);
}

// ---------- Ships (all drawn facing RIGHT) ----------
const FIGHTER_HULL = [
  [29, 16], [22, 12], [14, 11], [9, 5], [5, 5], [8, 12], [5, 14],
  [5, 18], [8, 20], [5, 27], [9, 27], [14, 21], [22, 20],
];

function playerFighter() {
  const img = new Img(32, 32);
  const P = { hull: hex('#4a90d9'), dark: hex('#2c5a9e'), light: hex('#9fd3ff'), tip: hex('#e8fbff'), engine: hex('#ffb347'), line: hex('#0e1a33') };
  fillPolygon(img, FIGHTER_HULL, (x, y) => (y >= 16 ? P.dark : y <= 13 && x > 14 ? P.light : P.hull));
  for (const y of [5, 26]) for (const x of [6, 7, 8]) img.set(x, y, P.tip); // wing tips
  disc(img, 21, 16, 1.6, P.tip); // cockpit
  for (let y = 14; y <= 17; y++) { img.set(4, y, P.engine); img.set(3, y, hex('#ff7a3a')); }
  outline(img, P.line);
  return img;
}

function wreckFighter() {
  const img = new Img(32, 32);
  const r = rng(42);
  const P = { hull: hex('#6b6f78'), dark: hex('#44474f'), burn: hex('#2a2a2e'), ember: hex('#ff7a3a'), line: hex('#16171b') };
  fillPolygon(img, FIGHTER_HULL, (x, y) => (y >= 16 ? P.dark : P.hull));
  // Punch holes and burn marks.
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      if (!img.alpha(x, y)) continue;
      const n = r();
      if (n < 0.1) img.set(x, y, CLEAR);
      else if (n < 0.25) img.set(x, y, P.burn);
    }
  for (const [x, y] of [[12, 15], [18, 18], [9, 22]]) img.set(x, y, P.ember);
  outline(img, P.line);
  return img;
}

// ---------- Bigger tiers (2, 3, 4) ----------
// Same simple style as the tier-1 fighter, scaled up, with more engines and
// wing guns the higher the tier. Blues sit at hue ~200° like the user's art,
// strong enough (saturation >= 40%) for the game to recolour them red for enemies.
const TIER_CANVAS = { 2: 96, 3: 144, 4: 216 };
const TIER_HULL_SCALE = { 2: 1.8, 3: 2.75, 4: 4.1 };
const TIER_BLUES = { hull: hex('#41a6d9'), dark: hex('#28739e'), light: hex('#7ecff2'), tip: hex('#e8fbff'), line: hex('#0e1a33') };
const TIER_GREYS = { hull: hex('#6b6f78'), dark: hex('#44474f'), light: hex('#80848d'), tip: hex('#9a9ea6'), line: hex('#16171b') };

function rect(img, x0, y0, w, h, color) {
  for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
    for (let x = Math.round(x0); x < Math.round(x0 + w); x++) img.set(x, y, color);
}

/** Hull, wing guns, stripes and cockpit of a tier-N ship, without outline or flames. */
function drawTierHull(img, tier, P) {
  const C = TIER_CANVAS[tier], k = TIER_HULL_SCALE[tier];
  const cx = C / 2, cy = C / 2;
  const map = ([x, y]) => [cx + (x - 17) * k, cy + (y - 16) * k];
  // Wing guns (one per side), drawn first so the hull overlaps their base.
  for (const side of [-1, 1]) rect(img, cx - 6 * k, cy + side * 4.6 * k - k * 0.5, 13 * k, k, P.tip);
  fillPolygon(img, FIGHTER_HULL.map(map), (x, y) => (y >= cy ? P.dark : y <= cy - 3 * k && x > cx - 3 * k ? P.light : P.hull));
  // One light stripe per tier across the body.
  for (let i = 0; i < tier; i++) rect(img, cx - k * (1 + i * 1.6), cy - 2.5 * k, Math.max(1, k * 0.5), 5 * k, P.light);
  disc(img, cx + 4 * k, cy, 1.6 * k, P.tip); // cockpit
  return { C, k, cx, cy };
}

/** Where the engines sit: one per tier, stacked at the back. */
function enginePositions(tier) {
  const C = TIER_CANVAS[tier], k = TIER_HULL_SCALE[tier];
  const ys = [];
  for (let i = 0; i < tier; i++) ys.push(C / 2 + (i - (tier - 1) / 2) * 2.4 * k);
  return { x: C / 2 - 13 * k, ys, k };
}

function tierFighter(tier, thrust = 'idle') {
  const C = TIER_CANVAS[tier];
  const img = new Img(C, C);
  drawTierHull(img, tier, TIER_BLUES);
  const e = enginePositions(tier);
  for (const y of e.ys) rect(img, e.x, y - e.k * 0.7, e.k * 1.2, e.k * 1.4, hex('#ffb347'));
  outline(img, TIER_BLUES.line);
  // Flames go on after the outline, so they glow instead of having a border.
  if (thrust !== 'idle') {
    const len = (thrust === 'boost' ? 7 : 3.5) * e.k;
    const cols = thrust === 'boost' ? ['#ffffff', '#ffe066', '#ffb347', '#ff7a3a'] : ['#ffe066', '#ffb347', '#ff7a3a'];
    for (const y of e.ys)
      for (let d = 0; d < len; d++) {
        const half = Math.max(0.5, e.k * 0.6 * (1 - d / len));
        const c = hex(cols[Math.min(cols.length - 1, Math.floor((d / len) * cols.length))]);
        rect(img, e.x - 1 - d, y - half, 1, half * 2, c);
      }
  }
  return img;
}

function tierWreck(tier) {
  const C = TIER_CANVAS[tier];
  const img = new Img(C, C);
  const r = rng(42 + tier);
  drawTierHull(img, tier, TIER_GREYS);
  const burn = hex('#2a2a2e'), ember = hex('#ff7a3a');
  for (let y = 0; y < C; y++)
    for (let x = 0; x < C; x++) {
      if (!img.alpha(x, y)) continue;
      // Holes and burns in clumps, so they read at any size.
      const n = noise(Math.floor(x / tier), Math.floor(y / tier), 3);
      if (n < 0.1) img.set(x, y, CLEAR);
      else if (n < 0.25) img.set(x, y, burn);
      else if (r() < 0.004 * tier) img.set(x, y, ember);
    }
  outline(img, TIER_GREYS.line);
  return img;
}

// ---------- Projectiles ----------
// One image per tier, used by both teams (blue, recoloured red for enemies).
function bullet(tier = 1) {
  const k = 1.5 ** (tier - 1);
  const S = Math.round(8 * k / 2) * 2;
  const img = new Img(S, S);
  const len = Math.round(6 * k), thick = Math.max(2, Math.round(2 * k));
  const cols = ['#28739e', '#41a6d9', '#7ecff2', '#e8fbff', '#ffffff'];
  const x0 = Math.floor((S - len) / 2), y0 = Math.floor((S - thick) / 2);
  for (let i = 0; i < len; i++) {
    const c = hex(cols[Math.min(cols.length - 1, Math.floor((i / len) * cols.length))]);
    for (let j = 0; j < thick; j++) img.set(x0 + i, y0 + j, c);
  }
  return img;
}

// ---------- Effects (flipbooks: frames side by side) ----------
function explosionSheet(S = 32) {
  const F = 8;
  const sheet = new Img(S * F, S);
  for (let f = 0; f < F; f++) {
    const t = f / (F - 1);
    const frame = new Img(S, S);
    const radius = (4 + t * 11) * (S / 32);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2);
        const n = noise(x, y, 1);
        if (d > radius * (0.75 + 0.35 * n)) continue;
        if (noise(x, y, f + 10) < t ** 1.6 * 0.9) continue; // breaks up over time
        const k = d / radius + t * 0.8; // how "cool" this pixel is
        const c = k < 0.4 ? '#ffffff' : k < 0.7 ? '#ffe066' : k < 1.0 ? '#ffb347' : k < 1.3 ? '#e2522f' : k < 1.6 ? '#7a2a22' : '#3a3438';
        frame.set(x, y, hex(c));
      }
    sheet.blit(frame, f * S, 0);
  }
  return sheet;
}

function hitSheet(S = 16) {
  const F = 4, k = S / 16, c = S / 2;
  const sheet = new Img(S * F, S);
  for (let f = 0; f < F; f++) {
    const frame = new Img(S, S);
    const len = [2, 4, 6, 7][f];
    const col = hex(['#ffffff', '#ffe066', '#ffb347', '#e2522f'][f]);
    if (f < 2) disc(frame, c, c, (2.2 - f * 0.7) * k, hex('#ffffff'));
    for (let i = 1 + f; i <= len; i++)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (i % 2 || f < 2) rect(frame, c + (dx * i - 0.5) * k + 0.5, c + (dy * i - 0.5) * k + 0.5, Math.max(1, k), Math.max(1, k), col);
    sheet.blit(frame, f * S, 0);
  }
  return sheet;
}

function recruitSheet(S = 48) {
  const F = 6, k = S / 48;
  const sheet = new Img(S * F, S);
  for (let f = 0; f < F; f++) {
    const frame = new Img(S, S);
    const r = (6 + f * 3.1) * k;
    const thick = (3 - f * 0.4) * k;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2);
        if (Math.abs(d - r) < thick / 2 + 0.5 && noise(x, y, 7) > f * 0.12)
          frame.set(x, y, hex(f < 2 ? '#e8fbff' : f < 4 ? '#9fd3ff' : '#4a90d9'));
      }
    sheet.blit(frame, f * S, 0);
  }
  return sheet;
}

// Merge flash: a bright burst and a ring of light when 16 ships become one.
function mergeSheet(S) {
  const F = 8, R = S / 2;
  const sheet = new Img(S * F, S);
  for (let f = 0; f < F; f++) {
    const t = f / (F - 1);
    const frame = new Img(S, S);
    const ring = R * (0.25 + t * 0.7);
    const core = R * 0.45 * (1 - t) ** 1.5;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - R, y + 0.5 - R);
        const a = Math.atan2(y + 0.5 - R, x + 0.5 - R);
        if (d < core) frame.set(x, y, hex(d < core * 0.5 ? '#ffffff' : '#ffe066'));
        else if (Math.abs(d - ring) < Math.max(1, R * 0.05 * (1 - t))) frame.set(x, y, hex(t < 0.5 ? '#ffffff' : '#ffe066'));
        // Rays that fade out.
        else if (t < 0.6 && d < ring && Math.floor(((a + Math.PI) / (2 * Math.PI)) * 24) % 3 === 0 && noise(x, y, f + 30) < 0.5 - t * 0.7)
          frame.set(x, y, hex('#ffb347'));
      }
    sheet.blit(frame, f * S, 0);
  }
  return sheet;
}

// Dash trail: speed streaks streaming back from the ship (the ship sits at the
// right edge, see anchorX in the manifest). Sky blue parts get team colours.
function dashSheet(W, H) {
  const F = 6, k = H / 28;
  const sheet = new Img(W * F, H);
  const streaks = [
    { y: 0, len: 1, col: '#e8fbff', thick: 3 },
    { y: -0.45, len: 0.75, col: '#41a6d9', thick: 2 },
    { y: 0.45, len: 0.75, col: '#41a6d9', thick: 2 },
    { y: -0.85, len: 0.45, col: '#7ecff2', thick: 2 },
    { y: 0.85, len: 0.45, col: '#7ecff2', thick: 2 },
  ];
  for (let f = 0; f < F; f++) {
    const t = f / (F - 1);
    const frame = new Img(W, H);
    for (const st of streaks) {
      const len = Math.round((W - 4) * st.len * (1 - t * 0.75));
      const th = Math.max(1, Math.round(st.thick * k * (1 - t * 0.4)));
      const y0 = Math.round(H / 2 + st.y * (H / 2 - 3) - th / 2);
      // Streaks start a little behind the ship's centre and break into dashes as they fade.
      const x1 = W - Math.round(8 * k);
      const dash = Math.max(2, Math.round(8 * k));
      const gap = Math.round(dash * t * 0.8);
      for (let x = x1 - len; x < x1; x++) {
        if ((x1 - x) % dash < gap) continue;
        rect(frame, x, y0, 1, th, hex(st.col));
      }
    }
    outline(frame, hex('#0e1a33'));
    sheet.blit(frame, f * W, 0);
  }
  return sheet;
}

// ---------- UI ----------
// Wreck marker: four corner brackets that pulse in and out (loops), so wrecks
// stand out from the stars when zoomed out.
function wreckMarker(S = 48) {
  const F = 6;
  const sheet = new Img(S * F, S);
  const arm = Math.round(S * 0.22);
  const th = Math.max(2, Math.round(S / 24));
  for (let f = 0; f < F; f++) {
    const frame = new Img(S, S);
    const inset = 2 + Math.round((1 - Math.cos((f / F) * Math.PI * 2)) * S * 0.04);
    const c = hex('#ffcf5a');
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const x = sx ? S - inset - arm : inset;
      const y = sy ? S - inset - th : inset;
      rect(frame, x, y, arm, th, c); // horizontal arm
      rect(frame, sx ? S - inset - th : inset, sy ? S - inset - arm : inset, th, arm, c); // vertical arm
    }
    outline(frame, hex('#2a1d05'));
    sheet.blit(frame, f * S, 0);
  }
  return sheet;
}

function commandRing(S = 44) {
  const img = new Img(S, S);
  const R = S / 2 - 2;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (Math.abs(d - R) < 0.7 && Math.floor(((a + Math.PI) / (2 * Math.PI)) * 16) % 2 === 0)
        img.set(x, y, hex('#9fd3ff', 170));
    }
  return img;
}

// Edge-of-screen arrow, pointing right.
function edgeArrow(fill, dark) {
  const img = new Img(11, 11);
  fillPolygon(img, [[9.5, 5.5], [2, 1.5], [4, 5.5], [2, 9.5]], () => hex(fill));
  outline(img, hex(dark));
  return img;
}

// ---------- Backgrounds (tile seamlessly) ----------
// The two star layers use different, large tile sizes (512 and 768) so their
// repeats rarely line up and the eye can't spot a grid.
// Star counts keep the same density as the original 128×128 tiles.
function starsFar() {
  const S = 512;
  const img = new Img(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) img.set(x, y, hex('#05060d'));
  const r = rng(7);
  for (let i = 0; i < Math.round(70 * (S / 128) ** 2); i++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S);
    img.set(x, y, hex(['#262a40', '#3a3f5c', '#5a6080'][Math.floor(r() * 3)]));
  }
  return img;
}
function starsNear() {
  const S = 768;
  const img = new Img(S, S);
  const r = rng(99);
  for (let i = 0; i < Math.round(18 * (S / 128) ** 2); i++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S);
    const c = hex(['#cfd8ff', '#ffffff', '#ffe6b0', '#b0d8ff'][Math.floor(r() * 4)]);
    img.set(x, y, c);
    if (r() < 0.3) {
      const dim = [c[0], c[1], c[2], 110];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) img.set((x + dx + S) % S, (y + dy + S) % S, dim);
    }
  }
  return img;
}

// ---------- Write files ----------
const FILES = {
  // One image for both teams; the game recolours its blue parts for enemies.
  'ships/fighter.png': playerFighter,
  'ships/fighter-wreck.png': wreckFighter,
  'projectiles/bullet.png': () => bullet(1),
  'vfx/explosion.png': () => explosionSheet(32),
  'vfx/hit.png': () => hitSheet(16),
  'vfx/recruit.png': () => recruitSheet(48),
  'ui/command-ring.png': () => commandRing(44),
  'ui/wreck-marker.png': () => wreckMarker(48),
  'vfx/dash.png': () => dashSheet(56, 28),
  'ui/arrow-enemy.png': () => edgeArrow('#ff6b5a', '#2a0b0b'),
  'ui/arrow-wreck.png': () => edgeArrow('#b8bcc6', '#16171b'),
  'backgrounds/stars-far.png': starsFar,
  'backgrounds/stars-near.png': starsNear,
};

// Bigger tiers: everything grows 1.5× per tier.
for (const tier of [2, 3, 4]) {
  const k = 1.5 ** (tier - 1);
  const even = (n) => Math.round(n / 2) * 2;
  FILES[`ships/fighter-t${tier}.png`] = () => tierFighter(tier);
  FILES[`ships/fighter-t${tier}-move.png`] = () => tierFighter(tier, 'move');
  FILES[`ships/fighter-t${tier}-boost.png`] = () => tierFighter(tier, 'boost');
  FILES[`ships/fighter-t${tier}-wreck.png`] = () => tierWreck(tier);
  FILES[`projectiles/bullet-t${tier}.png`] = () => bullet(tier);
  FILES[`vfx/explosion-t${tier}.png`] = () => explosionSheet(even(32 * k));
  FILES[`vfx/hit-t${tier}.png`] = () => hitSheet(even(16 * k));
  FILES[`vfx/recruit-t${tier}.png`] = () => recruitSheet(even(48 * k));
  // The merge flash is sized for the ship it creates.
  FILES[tier === 2 ? 'vfx/merge.png' : `vfx/merge-t${tier}.png`] = () => mergeSheet(TIER_CANVAS[tier]);
  FILES[`ui/command-ring-t${tier}.png`] = () => commandRing(even(44 * k));
  FILES[`ui/wreck-marker-t${tier}.png`] = () => wreckMarker(even(48 * k));
  FILES[`vfx/dash-t${tier}.png`] = () => dashSheet(even(56 * k), even(28 * k));
}

for (const [name, draw] of Object.entries(FILES)) {
  const path = join(OUT_DIR, name);
  if (existsSync(path) && !FORCE) {
    console.log(`skip   ${name} (already exists)`);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(draw()));
  console.log(`write  ${name}`);
}
