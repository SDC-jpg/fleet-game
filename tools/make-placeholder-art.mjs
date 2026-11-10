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
const ENEMY_HULL = [
  [28, 16], [20, 9], [16, 4], [12, 4], [14, 10], [6, 8], [4, 12], [8, 16],
  [4, 20], [6, 24], [14, 22], [12, 28], [16, 28], [20, 23],
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

function enemyFighter() {
  const img = new Img(32, 32);
  const P = { hull: hex('#c8453b'), dark: hex('#85251f'), light: hex('#ff9a6e'), eye: hex('#ffe066'), line: hex('#2a0b0b') };
  fillPolygon(img, ENEMY_HULL, (x, y) => (y >= 16 ? P.dark : y <= 12 ? P.light : P.hull));
  disc(img, 19, 16, 1.8, P.eye);
  img.set(19, 16, hex('#ffffff'));
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

// ---------- Projectiles ----------
function playerBullet() {
  const img = new Img(8, 8);
  const cols = ['#2c5a9e', '#4a90d9', '#9fd3ff', '#e8fbff', '#ffffff'];
  for (let x = 1; x <= 6; x++) {
    const c = hex(cols[Math.min(cols.length - 1, x - 1)]);
    img.set(x, 3, c);
    img.set(x, 4, c);
  }
  return img;
}
function enemyBullet() {
  const img = new Img(8, 8);
  disc(img, 4, 4, 2.6, hex('#ff7a3a'));
  disc(img, 4, 4, 1.5, hex('#ffe066'));
  return img;
}

// ---------- Effects (flipbooks: frames side by side) ----------
function explosionSheet() {
  const F = 8, S = 32;
  const sheet = new Img(S * F, S);
  for (let f = 0; f < F; f++) {
    const t = f / (F - 1);
    const frame = new Img(S, S);
    const radius = 4 + t * 11;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
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

function hitSheet() {
  const F = 4, S = 16;
  const sheet = new Img(S * F, S);
  for (let f = 0; f < F; f++) {
    const frame = new Img(S, S);
    const len = [2, 4, 6, 7][f];
    const col = hex(['#ffffff', '#ffe066', '#ffb347', '#e2522f'][f]);
    if (f < 2) disc(frame, 8, 8, 2.2 - f * 0.7, hex('#ffffff'));
    for (let i = 1 + f; i <= len; i++)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (i % 2 || f < 2) frame.set(8 + dx * i, 8 + dy * i, col);
    sheet.blit(frame, f * S, 0);
  }
  return sheet;
}

function recruitSheet() {
  const F = 6, S = 48;
  const sheet = new Img(S * F, S);
  for (let f = 0; f < F; f++) {
    const frame = new Img(S, S);
    const r = 6 + f * 3.1;
    const thick = 3 - f * 0.4;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - 24, y + 0.5 - 24);
        if (Math.abs(d - r) < thick / 2 + 0.5 && noise(x, y, 7) > f * 0.12)
          frame.set(x, y, hex(f < 2 ? '#e8fbff' : f < 4 ? '#9fd3ff' : '#4a90d9'));
      }
    sheet.blit(frame, f * S, 0);
  }
  return sheet;
}

// ---------- UI ----------
function commandRing() {
  const img = new Img(44, 44);
  for (let y = 0; y < 44; y++)
    for (let x = 0; x < 44; x++) {
      const dx = x + 0.5 - 22, dy = y + 0.5 - 22;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (Math.abs(d - 20) < 0.7 && Math.floor(((a + Math.PI) / (2 * Math.PI)) * 16) % 2 === 0)
        img.set(x, y, hex('#9fd3ff', 170));
    }
  return img;
}

// ---------- Backgrounds (tile seamlessly) ----------
function starsFar() {
  const S = 128;
  const img = new Img(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) img.set(x, y, hex('#05060d'));
  const r = rng(7);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S);
    img.set(x, y, hex(['#262a40', '#3a3f5c', '#5a6080'][Math.floor(r() * 3)]));
  }
  return img;
}
function starsNear() {
  const S = 128;
  const img = new Img(S, S);
  const r = rng(99);
  for (let i = 0; i < 18; i++) {
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
  'ships/fighter-player.png': playerFighter,
  'ships/fighter-enemy.png': enemyFighter,
  'ships/fighter-wreck.png': wreckFighter,
  'projectiles/bullet-player.png': playerBullet,
  'projectiles/bullet-enemy.png': enemyBullet,
  'vfx/explosion.png': explosionSheet,
  'vfx/hit.png': hitSheet,
  'vfx/recruit.png': recruitSheet,
  'ui/command-ring.png': commandRing,
  'backgrounds/stars-far.png': starsFar,
  'backgrounds/stars-near.png': starsNear,
};

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
