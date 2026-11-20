// Generates the Leviathan's attack placeholders (all purple, the user's rule 2026-11-19) as PNG
// files in public/assets/bosses/leviathan/. Flat shapes with a dark 1 px outline, like the other
// placeholders; the user replaces them with their own art.
//
//   node tools/make-leviathan-art.mjs            -> only creates files that don't exist yet
//   node tools/make-leviathan-art.mjs --force    -> overwrites them (careful: replaces your art!)
//
// Every file written is recorded in tools/placeholders.json (see placeholders.mjs).

import { deflateSync } from 'node:zlib';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordPlaceholder } from './placeholders.mjs';

const ASSETS = fileURLToPath(new URL('../public/assets/', import.meta.url));
const FORCE = process.argv.includes('--force');

// ---------- Tiny PNG writer ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
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
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) Buffer.from(img.data.buffer, y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

class Img {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data.set(c, (y * this.w + x) * 4);
  }
  alpha(x, y) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.data[(y * this.w + x) * 4 + 3];
  }
  /** A dark 1 px outline around everything drawn so far. */
  outline(c = OUT) {
    const add = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (!this.alpha(x, y) && (this.alpha(x + 1, y) > 128 || this.alpha(x - 1, y) > 128 || this.alpha(x, y + 1) > 128 || this.alpha(x, y - 1) > 128)) add.push([x, y]);
    for (const [x, y] of add) this.set(x, y, c);
  }
  blit(src, ox, oy) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        if (src.data[i + 3]) this.set(ox + x, oy + y, src.data.subarray(i, i + 4));
      }
  }
}
const hex = (s, a = 255) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), a];
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Purple palette.
const OUT = hex('#1a0826');
const DARK = hex('#4a1a7a');
const MID = hex('#8a3cd8');
const LIGHT = hex('#c58cff');
const CORE = hex('#f0dcff');

/** A filled disc. */
function disc(img, cx, cy, r, c) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) img.set(x, y, c);
}
/** A ring from r0 to r1. */
function ring(img, cx, cy, r0, r1, c) {
  for (let y = Math.floor(cy - r1); y <= cy + r1; y++)
    for (let x = Math.floor(cx - r1); x <= cx + r1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= r0 && d <= r1) img.set(x, y, c);
    }
}
/** A 1 px line. */
function line(img, x0, y0, x1, y1, c) {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) || 1;
  for (let i = 0; i <= n; i++) img.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
}
/** Frames side by side. */
function strip(frames) {
  const out = new Img(frames[0].w * frames.length, frames[0].h);
  frames.forEach((f, i) => out.blit(f, i * f.w, 0));
  return out;
}

// ---------- The images ----------
const ART = {
  // Body hit: a burst of purple shards, play once (faces right = away from the body).
  'bosses/leviathan/bump.png': () =>
    strip(
      [0, 1, 2, 3, 4].map((f) => {
        const img = new Img(24, 24);
        const r = 3 + f * 2.2;
        if (f < 2) disc(img, 12, 12, 4 - f, CORE);
        for (let i = 0; i < 7; i++) {
          const a = -1.2 + (i / 6) * 2.4;
          const len = f < 4 ? 3 : 2;
          line(img, 12 + Math.cos(a) * r, 12 + Math.sin(a) * r, 12 + Math.cos(a) * (r + len), 12 + Math.sin(a) * (r + len), f < 2 ? LIGHT : MID);
        }
        img.outline();
        return img;
      }),
    ),
  // Energy ball: a crackling purple orb about the charge ball's size (44 px), looping.
  'bosses/leviathan/orb.png': () =>
    strip(
      [0, 1, 2, 3].map((f) => {
        const img = new Img(44, 44);
        disc(img, 22, 22, 13, DARK);
        disc(img, 22, 22, 11, MID);
        disc(img, 21, 21, 7, LIGHT);
        disc(img, 20, 20, 3.5, CORE);
        const r = rng(17 + f * 31);
        for (let k = 0; k < 4; k++) {
          // Little lightning arcs crackling off the surface.
          let a = r() * Math.PI * 2;
          let x = 22 + Math.cos(a) * 11;
          let y = 22 + Math.sin(a) * 11;
          for (let s = 0; s < 3; s++) {
            a += (r() - 0.5) * 1.2;
            const nx = x + Math.cos(a) * 3.5;
            const ny = y + Math.sin(a) * 3.5;
            line(img, x, y, nx, ny, CORE);
            x = nx;
            y = ny;
          }
        }
        img.outline();
        return img;
      }),
    ),
  // Its pulse: a ring that grows out to the edge (140 px = the pulse's reach at 70), play once.
  'bosses/leviathan/orb-pulse.png': () =>
    strip(
      [0, 1, 2, 3, 4, 5].map((f) => {
        const img = new Img(140, 140);
        const r = 14 + f * 11;
        ring(img, 70, 70, r - (f < 3 ? 4 : 3), r, f < 2 ? LIGHT : MID);
        ring(img, 70, 70, r - 1, r, f < 4 ? CORE : LIGHT);
        img.outline();
        return img;
      }),
    ),
  // Blood: a glowing purple droplet shot, looping shimmer.
  'bosses/leviathan/blood.png': () =>
    strip(
      [0, 1].map((f) => {
        const img = new Img(10, 10);
        disc(img, 5, 5, 3.5, MID);
        disc(img, 4.5, 4.5, 2, f ? CORE : LIGHT);
        img.outline();
        return img;
      }),
    ),
  // Blood hitting a ship: a small splash, play once.
  'bosses/leviathan/blood-hit.png': () =>
    strip(
      [0, 1, 2, 3].map((f) => {
        const img = new Img(16, 16);
        if (f === 0) disc(img, 8, 8, 3, LIGHT);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + f * 0.3;
          const d = 2 + f * 1.6;
          disc(img, 8 + Math.cos(a) * d, 8 + Math.sin(a) * d, f < 3 ? 1.2 : 0.7, f < 2 ? LIGHT : MID);
        }
        img.outline();
        return img;
      }),
    ),
  // A parasite: half a tier-1 ship, a little purple tick with hooked legs, facing right. Two frames (legs twitch).
  'bosses/leviathan/parasite.png': () =>
    strip(
      [0, 1].map((f) => {
        const img = new Img(20, 20);
        for (const side of [-1, 1])
          for (let k = 0; k < 3; k++) {
            const x = 7 + k * 3;
            const tw = (k + f) % 2 ? 1 : 0;
            line(img, x, 10 + side * 3, x - 1 - tw, 10 + side * 7, DARK);
          }
        // Body (oval) and head with two pincers in front.
        for (let y = 0; y < 20; y++)
          for (let x = 0; x < 20; x++) if (((x + 0.5 - 9) / 6) ** 2 + ((y + 0.5 - 10) / 4) ** 2 <= 1) img.set(x, y, MID);
        disc(img, 15, 10, 2.5, DARK);
        img.set(18, 8, LIGHT);
        img.set(18, 12, LIGHT);
        img.set(17, 8, DARK);
        img.set(17, 12, DARK);
        disc(img, 8, 9, 2, LIGHT);
        img.set(15, 9, CORE);
        img.outline();
        return img;
      }),
    ),
  // Intro: distant purple lightning, 4 different bolts (one frame each; the game picks one).
  'bosses/leviathan/lightning.png': () =>
    strip(
      [0, 1, 2, 3].map((f) => {
        const img = new Img(80, 160);
        const r = rng(201 + f * 13);
        const bolt = (x, y, a, len, width, depth) => {
          for (let s = 0; s < len; s++) {
            const nx = x + Math.cos(a) * 6;
            const ny = y + Math.sin(a) * 6;
            for (let w = 0; w < width; w++) line(img, x + w, y, nx + w, ny, width > 1 ? CORE : LIGHT);
            if (depth < 2 && r() < 0.18) bolt(nx, ny, a + (r() < 0.5 ? -0.7 : 0.7), Math.floor(len / 2), 1, depth + 1);
            x = nx;
            y = ny;
            a = Math.PI / 2 + (r() - 0.5) * 1.1;
          }
        };
        bolt(40 + (r() - 0.5) * 20, 0, Math.PI / 2, 26, 2, 0);
        img.outline(MID);
        return img;
      }),
    ),
  // Intro: the rift tearing open (6 frames, play once; the game plays it backwards to close it).
  'bosses/leviathan/rift.png': () =>
    strip(
      [0, 1, 2, 3, 4, 5].map((f) => {
        const img = new Img(100, 260);
        const open = (f + 1) / 6;
        const r = rng(301);
        // A jagged vertical tear: its width at each row, widest in the middle.
        const offs = [];
        let o = 0;
        for (let y = 0; y < 260; y++) {
          o += (r() - 0.5) * 2;
          o *= 0.97;
          offs.push(o);
        }
        for (let y = 0; y < 260; y++) {
          const k = Math.sin((y / 259) * Math.PI);
          const half = Math.max(0, 33 * open * k ** 1.3);
          const cx = 50 + offs[y] * 3 * k;
          for (let x = Math.floor(cx - half - 3); x <= cx + half + 3; x++) {
            const d = Math.abs(x + 0.5 - cx);
            if (d <= half * 0.45) img.set(x, y, CORE);
            else if (d <= half * 0.8) img.set(x, y, LIGHT);
            else if (d <= half) img.set(x, y, MID);
            else if (d <= half + 3 && half > 1) img.set(x, y, DARK);
          }
        }
        img.outline();
        return img;
      }),
    ),
  // Death: a purple explosion (8 frames, play once).
  'bosses/leviathan/explosion.png': () =>
    strip(
      [0, 1, 2, 3, 4, 5, 6, 7].map((f) => {
        const img = new Img(64, 64);
        const k = f / 7;
        const r = rng(401);
        const R = 6 + k * 24;
        if (f < 6) disc(img, 32, 32, R * (1 - k * 0.5), f < 2 ? CORE : f < 4 ? LIGHT : MID);
        if (f < 4) disc(img, 32, 32, R * 0.55, CORE);
        // Puffs around the edge.
        for (let i = 0; i < 9; i++) {
          const a = r() * Math.PI * 2;
          const d = R * (0.7 + r() * 0.4);
          const pr = (3 + r() * 4) * (1 - k * 0.6);
          disc(img, 32 + Math.cos(a) * d, 32 + Math.sin(a) * d, pr, f < 3 ? LIGHT : f < 6 ? MID : DARK);
        }
        img.outline();
        return img;
      }),
    ),
  // Death: a shockwave ring racing out (8 frames, play once; drawn big).
  'bosses/leviathan/shockwave.png': () =>
    strip(
      [0, 1, 2, 3, 4, 5, 6, 7].map((f) => {
        const img = new Img(200, 200);
        const rad = 12 + f * 12;
        const w = f < 3 ? 5 : f < 6 ? 3 : 2;
        ring(img, 100, 100, rad - w, rad, f < 4 ? LIGHT : MID);
        ring(img, 100, 100, rad - 1, rad, CORE);
        img.outline();
        return img;
      }),
    ),
};

let made = 0;
for (const [file, draw] of Object.entries(ART)) {
  const path = join(ASSETS, file);
  if (existsSync(path) && !FORCE) continue;
  mkdirSync(dirname(path), { recursive: true });
  const bytes = encodePng(draw());
  writeFileSync(path, bytes);
  recordPlaceholder(file, bytes);
  console.log('made', file);
  made++;
}
console.log(made ? `${made} file(s) made.` : 'Nothing to make (all exist; --force to remake).');
