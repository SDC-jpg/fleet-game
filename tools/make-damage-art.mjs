// Generates the ship damage placeholders (docs/SHIP-DAMAGE.md) in public/assets/vfx/: textures
// that damage marks are coloured from, tiled across each ship's image. Flat colours, like the
// other placeholders; repaint them in any style (any size; they repeat).
//
//   node tools/make-damage-art.mjs            -> only creates files that don't exist yet
//   node tools/make-damage-art.mjs --force    -> overwrites them (careful: replaces your art!)
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
function encodePng(w, h, data) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(data.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

/** A tile from rows of letters, each letter a colour. */
function tile(rows, colours) {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8Array(w * h * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => data.set(hex(colours[ch]), (y * w + x) * 4)));
  return encodePng(w, h, data);
}

/** Frames side by side from rows of letters (one list of rows per frame, all the same size). */
function strip(frames, colours) {
  const h = frames[0].length;
  const fw = frames[0][0].length;
  const w = fw * frames.length;
  const data = new Uint8Array(w * h * 4);
  frames.forEach((rows, f) => rows.forEach((row, y) => [...row].forEach((ch, x) => colours[ch] && data.set(colours[ch], (y * w + f * fw + x) * 4))));
  return encodePng(w, h, data);
}

const ART = {
  // Exposed innards (gun hits: torn plating): dark hollow, struts, a pipe, a few glowing bits.
  'vfx/damage-innards.png': () =>
    tile(
      [
        '....s.......s...',
        '....s..p....s...',
        '....s...p...s.o.',
        'ssssssssspsssss.',
        '....s.....p.s...',
        '.y..s......ps...',
        '....s.......p...',
        '....s.......sp..',
        '....s.......s.p.',
        '....s..o....s..p',
        'sssssssssssssssp',
        'p...s.......s...',
        '.p..s.......s.y.',
        '..p.s.......s...',
        '...ps.......s...',
        '....p.......s...',
      ],
      { '.': '#16141c', s: '#3b3744', p: '#55687a', o: '#ff8a2a', y: '#ffd35a' },
    ),
  // Scorch (energy burns): sooty blacks and browns the hull turns toward.
  'vfx/damage-scorch.png': () =>
    tile(
      ['abab', 'bcba', 'abac', 'cbab'],
      { a: '#1a1512', b: '#2a201a', c: '#3a2c22' },
    ),
  // The heat ramp: a burn's colour from white hot (left) to cold (right).
  'vfx/damage-heat.png': () => tile(['wyoOrRdk'], { w: '#ffffff', y: '#fff3a0', o: '#ffc040', O: '#ff8a20', r: '#f04818', R: '#b02010', d: '#5a1008', k: '#200806' }),
  // A puff of smoke (3 frames, 4×4, growing and fading).
  'vfx/particle-smoke.png': () =>
    strip(
      [
        ['....', '.aa.', '.aa.', '....'],
        ['.bb.', 'bbbb', 'bbbb', '.bb.'],
        ['.c.c', 'c.c.', '.c.c', 'c.c.'],
      ],
      { a: [150, 150, 158, 220], b: [110, 110, 118, 170], c: [80, 80, 88, 110] },
    ),
  // A spark (3 frames, 2×2: white-yellow, orange, dim red).
  'vfx/particle-spark.png': () =>
    strip(
      [
        ['ab', 'ba'],
        ['c.', '.c'],
        ['d.', '..'],
      ],
      { a: [255, 255, 220, 255], b: [255, 220, 90, 255], c: [255, 150, 40, 255], d: [200, 60, 20, 220] },
    ),
  // The Leviathan's flesh (CONFIG.leviathan.damage; all purple, the user's rule for its effects):
  // glowing flesh inside its wounds (blood bursting out),
  'bosses/leviathan/damage-inside.png': () =>
    tile(
      ['ppPpmppP', 'pPmmPppm', 'mPpppPmp', 'ppmPpppP', 'PpppmPpp', 'pmPppmPp', 'pppPpppm', 'PmppPmpp'],
      { p: '#c13cff', P: '#f08cff', m: '#8a1fd0' },
    ),
  // raw flesh inside ordinary tears,
  'bosses/leviathan/damage-torn.png': () => tile(['abca', 'bcab', 'cabc', 'abcb'], { a: '#3a0f4c', b: '#561a6a', c: '#6e2484' }),
  // charred flesh around them (and its burns),
  'bosses/leviathan/damage-char.png': () => tile(['abac', 'cbab', 'abca', 'bacb'], { a: '#1c0b24', b: '#2c1236', c: '#3e1a4a' }),
  // its burns' colours, hottest (left) to cold (right),
  'bosses/leviathan/damage-heat.png': () => tile(['wpPmMdDk'], { w: '#ffffff', p: '#ffc8ff', P: '#ff7af0', m: '#e040ff', M: '#a020e0', d: '#6a14a0', D: '#3c0c5c', k: '#1c0628' }),
  // and its blood drops (3 frames, 2×2, fading).
  'bosses/leviathan/particle-blood.png': () =>
    strip(
      [
        ['ab', 'bb'],
        ['b.', 'bb'],
        ['c.', '.c'],
      ],
      { a: [240, 140, 255, 255], b: [190, 60, 240, 255], c: [130, 30, 180, 200] },
    ),
};

let made = 0;
for (const [file, draw] of Object.entries(ART)) {
  const path = join(ASSETS, file);
  if (existsSync(path) && !FORCE) continue;
  mkdirSync(dirname(path), { recursive: true });
  const bytes = draw();
  writeFileSync(path, bytes);
  recordPlaceholder(file, bytes);
  console.log('made', file);
  made++;
}
console.log(made ? `${made} file(s) made.` : 'Nothing to make (all exist; --force to remake).');
