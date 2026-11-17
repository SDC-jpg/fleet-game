// Art sheets: every placeholder image on a few big PNG pages, to paint over in Photoshop,
// then put back into the game (only what changed).
//
//   node tools/art-sheet.mjs make              (npm run art-sheet) -> art-sheet/*.png + art-sheet/sheet.json
//   node tools/art-sheet.mjs make --all-tiers  ...also the tier 5-8 versions of effects, UI and shots
//   node tools/art-sheet.mjs apply             (npm run art-sheet:apply) -> lists what changed on the pages
//   node tools/art-sheet.mjs apply --write     ...and writes those images into public/assets
//   node tools/art-sheet.mjs scan              rebuilds tools/placeholders.json (which files are still placeholders)
//
// Pages: ui, projectiles, effects (VFX, thrusters, flames), backgrounds, and one page per ship
// tier (enemy ships and their variants, wrecks, turrets). A page is at most 4096 px wide and
// tall; more spill onto "-2", "-3"... pages. Each image sits in its own box at its exact size
// (flipbook frames in a grid, a few pixels apart), with its name above it and a magenta outline
// just outside it. Only what's inside the boxes is read back; names, outlines and gaps are ignored.
// Only placeholders go on the pages (tools/placeholders.json), so each new round has fewer.
//
// Reads and writes PNGs with the container's Chromium (like screenshot.mjs).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { ASSETS_DIR, hashOf, isPlaceholder, loadPlaceholders, savePlaceholders } from './placeholders.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHEET_DIR = join(ROOT, 'art-sheet');
const MAP_FILE = join(SHEET_DIR, 'sheet.json');
const [cmd = 'make', ...flags] = process.argv.slice(2);
const has = (f) => flags.includes(f);

const PAGE_MAX = 4096;
/**
 * Highest tier of each kind of art that goes on the main pages (more with --all-tiers, up to 6:
 * past tier 6 the detail steps draw the tier-6 image instead, so tier 7-8 art is never shown).
 * Ship pages always have every tier.
 */
const MAX_TIER = { projectiles: 6 };
const DEFAULT_MAX_TIER = 4;
const SHOWN_UP_TO = 6;
const PAD = 16; // around the page
const GAP = 14; // between boxes
const LABEL_H = 13; // name above each box
const FRAME_GAP = 4; // between flipbook frames

/** Width and height of a PNG file, from its header. */
function pngSize(path) {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** Every PNG under a folder, as paths relative to `base` (public/assets by default). */
function filesIn(dir, base = ASSETS_DIR) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.png')) out.push(relative(base, p).replaceAll('\\', '/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** Which page an image goes on, and its tier. */
function placeOf(file) {
  const turret = /^parts\/gun-turret-(\d+)/.exec(file);
  if (turret) return { group: 'ships', tier: Number(turret[1]) };
  const tier = Number(/-t(\d+)(?:-wreck)?\.png$|-t(\d+)\//.exec(file)?.slice(1).find(Boolean) ?? 1);
  if (file.startsWith('ships/')) return { group: 'ships', tier };
  if (file.startsWith('vfx/') || file.startsWith('parts/')) return { group: 'effects', tier };
  const group = file.split('/')[0];
  return { group: group === 'backgrounds' ? 'backgrounds' : group === 'projectiles' ? 'projectiles' : 'ui', tier };
}

async function withBrowser(fn) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    return await fn(await browser.newPage());
  } finally {
    await browser.close();
  }
}

const b64 = (file) => readFileSync(ASSETS_DIR + file).toString('base64');

// ---------- make ----------

async function make() {
  // Don't throw away painting: pages with changes must be applied first (or --force).
  if (existsSync(MAP_FILE) && !has('--force')) {
    const { changed } = await findChanges();
    if (changed.length) {
      console.log(`The current pages have ${changed.length} painted images not put into the game yet:`);
      for (const c of changed) console.log(`  ${c.file}`);
      console.log('Apply them first (apply --write), or make new pages anyway with --force (loses that painting).');
      return;
    }
  }
  const manifest = JSON.parse(readFileSync(ASSETS_DIR + 'manifest.json', 'utf8')).sprites;
  // Frame size per file (flipbooks), from the manifest.
  const frameOf = {};
  const nameOf = {};
  for (const [name, e] of Object.entries(manifest)) {
    if (!e.file || frameOf[e.file]) continue;
    frameOf[e.file] = { fw: e.frameWidth, fh: e.frameHeight };
    nameOf[e.file] = name;
  }
  const placeholders = loadPlaceholders();
  // The art the game uses: manifest images and every part (thrusters, flames, turrets).
  const candidates = [...new Set([...Object.keys(frameOf), ...filesIn(ASSETS_DIR + 'parts')])].filter((f) => existsSync(ASSETS_DIR + f));
  const items = [];
  for (const file of candidates) {
    if (!isPlaceholder(file, placeholders)) continue;
    const { group, tier } = placeOf(file);
    let page;
    const maxTier = MAX_TIER[group] ?? DEFAULT_MAX_TIER;
    if (group === 'ships') page = `ships-t${tier}`;
    else if (tier > SHOWN_UP_TO) continue; // never shown in the game
    else if (tier > maxTier) {
      if (!has('--all-tiers')) continue;
      page = `${group}-t${maxTier + 1}-t${SHOWN_UP_TO}`;
    } else page = group;
    const { w, h } = pngSize(ASSETS_DIR + file);
    const fw = Math.min(w, frameOf[file]?.fw ?? w);
    const fh = Math.min(h, frameOf[file]?.fh ?? h);
    const cols = Math.max(1, Math.floor(w / fw));
    const rows = Math.max(1, Math.floor(h / fh));
    const frames = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) frames.push({ fx: c * fw, fy: r * fh, w: fw, h: fh });
    // Flipbook frames in a grid inside the box, about as wide as tall (and never past the page edge).
    const square = Math.ceil(Math.sqrt((frames.length * (fh + FRAME_GAP)) / (fw + FRAME_GAP)));
    const per = Math.max(1, Math.min(frames.length, square, Math.floor((PAGE_MAX - 2 * PAD + FRAME_GAP) / (fw + FRAME_GAP))));
    frames.forEach((f, i) => {
      f.bx = (i % per) * (fw + FRAME_GAP);
      f.by = Math.floor(i / per) * (fh + FRAME_GAP);
    });
    const label = (nameOf[file] ?? file).replace(/^ui\.|^vfx\./, '');
    const boxW = per * fw + (per - 1) * FRAME_GAP;
    const boxH = Math.ceil(frames.length / per) * (fh + FRAME_GAP) - FRAME_GAP;
    items.push({ file, page, label, hash: placeholders[file], boxW, boxH, frames, slotW: Math.max(boxW, (label.length + 7) * 6 + 4) /* room for ' (team)' */, slotH: LABEL_H + boxH });
  }
  if (!items.length) {
    console.log('No placeholders left to put on a sheet (or run "scan" first).');
    return;
  }

  // Shelf packing per page group, in name order (so tier versions of an effect sit together).
  const pages = [];
  const groups = [...new Set(items.map((i) => i.page))].sort();
  for (const g of groups) {
    const list = items.filter((i) => i.page === g).sort((a, b) => a.file.localeCompare(b.file, 'en', { numeric: true }));
    // A page about as wide as tall: wide enough for its widest image and the square root of its
    // total area (a little more, as rows don't pack perfectly), at most PAGE_MAX.
    const area = list.reduce((sum, it) => sum + (it.slotW + GAP) * (it.slotH + GAP), 0);
    const widest = Math.max(...list.map((it) => it.slotW)) + 2 * PAD;
    const pageW = Math.min(PAGE_MAX, Math.max(widest, Math.round(Math.sqrt(area) * 1.1)));
    let page = null;
    let x = PAD, y = PAD, shelf = 0, n = 0;
    const newPage = () => {
      n++;
      page = { file: `${g}${n > 1 ? `-${n}` : ''}.png`, w: 0, h: 0, items: [] };
      pages.push(page);
      x = PAD;
      y = PAD;
      shelf = 0;
    };
    newPage();
    for (const it of list) {
      if (x > PAD && x + it.slotW > pageW - PAD) {
        x = PAD;
        y += shelf + GAP;
        shelf = 0;
      }
      if (page.items.length && y + it.slotH > PAGE_MAX - PAD) newPage();
      it.x = x;
      it.y = y + LABEL_H;
      page.items.push(it);
      x += it.slotW + GAP;
      shelf = Math.max(shelf, it.slotH);
      page.w = Math.max(page.w, x - GAP + PAD);
      page.h = Math.max(page.h, y + shelf + PAD);
    }
  }

  rmSync(SHEET_DIR, { recursive: true, force: true });
  mkdirSync(SHEET_DIR, { recursive: true });
  await withBrowser(async (p) => {
    for (const page of pages) {
      const png = await p.evaluate(drawPage, {
        page: { w: page.w, h: page.h, labelH: LABEL_H },
        items: page.items.map((it) => ({ data: b64(it.file), x: it.x, y: it.y, label: it.label, frames: it.frames })),
      });
      writeFileSync(join(SHEET_DIR, page.file), Buffer.from(png, 'base64'));
      console.log(`page   art-sheet/${page.file}  ${page.w}×${page.h}  ${page.items.length} images`);
    }
  });
  const map = {
    _readme: 'Where each image sits on the art sheet pages. Made by tools/art-sheet.mjs; do not edit.',
    made: new Date().toISOString(),
    pages: pages.map((pg) => ({ file: pg.file, items: pg.items.map((it) => ({ file: it.file, hash: it.hash, x: it.x, y: it.y, frames: it.frames })) })),
  };
  writeFileSync(MAP_FILE, JSON.stringify(map, null, 1) + '\n');
  console.log(`${items.length} placeholder images on ${pages.length} pages in art-sheet/`);
}

/** In the browser: draw one page (images at their spots, names, outlines). Returns PNG base64. */
async function drawPage({ page, items }) {
  const c = document.createElement('canvas');
  c.width = page.w;
  c.height = page.h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.font = '10px monospace';
  ctx.textBaseline = 'top';
  for (const it of items) {
    const img = new Image();
    img.src = 'data:image/png;base64,' + it.data;
    await img.decode();
    // Team colour check (sky blue parts the game recolours): marked on the label.
    const t = document.createElement('canvas');
    t.width = img.width;
    t.height = img.height;
    const tc = t.getContext('2d');
    tc.drawImage(img, 0, 0);
    const d = tc.getImageData(0, 0, img.width, img.height).data;
    let team = false;
    for (let i = 0; i < d.length && !team; i += 4) {
      if (d[i + 3] === 0) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), ch = max - min;
      if (!ch || ch / max < 0.4) continue;
      let h = max === r ? ((g - b) / ch) % 6 : max === g ? (b - r) / ch + 2 : (r - g) / ch + 4;
      h = (h * 60 + 360) % 360;
      team = h >= 180 && h <= 230;
    }
    for (const f of it.frames) {
      ctx.drawImage(img, f.fx, f.fy, f.w, f.h, it.x + f.bx, it.y + f.by, f.w, f.h);
      // Outline just outside each frame (in the gap; never read back).
      ctx.strokeStyle = 'rgba(255, 0, 255, 0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(it.x + f.bx - 1.5, it.y + f.by - 1.5, f.w + 3, f.h + 3);
    }
    ctx.fillStyle = '#000000';
    ctx.fillText(it.label, it.x + 1, it.y - page.labelH + 1);
    ctx.fillStyle = team ? '#7fd4ff' : '#ffffff';
    ctx.fillText(it.label + (team ? ' (team)' : ''), it.x, it.y - page.labelH);
  }
  return c.toDataURL('image/png').split(',')[1];
}

// ---------- apply ----------

/** What was painted on the pages: changed images (with their new files) and ones changed in the game meanwhile. */
async function findChanges() {
  const map = JSON.parse(readFileSync(MAP_FILE, 'utf8'));
  const changed = [];
  const skipped = [];
  await withBrowser(async (p) => {
    for (const page of map.pages) {
      const path = join(SHEET_DIR, page.file);
      if (!existsSync(path)) continue;
      const items = page.items.filter((it) => {
        // Changed in the game since the sheet was made (e.g. swapped by hand): leave it alone.
        const now = existsSync(ASSETS_DIR + it.file) ? hashOf(readFileSync(ASSETS_DIR + it.file)) : null;
        if (now !== it.hash) skipped.push(it.file);
        return now === it.hash;
      });
      const results = await p.evaluate(comparePage, {
        page: readFileSync(path).toString('base64'),
        items: items.map((it) => ({ data: b64(it.file), x: it.x, y: it.y, frames: it.frames })),
      });
      results.forEach((r, i) => r && changed.push({ file: items[i].file, frames: r.frames, total: items[i].frames.length, png: r.png }));
    }
  });
  return { changed, skipped };
}

async function apply() {
  if (!existsSync(MAP_FILE)) throw new Error('No art-sheet/sheet.json: make the sheet first.');
  const write = has('--write');
  const { changed, skipped } = await findChanges();
  if (skipped.length) console.log(`Not touched (changed in the game since the sheet was made): ${skipped.join(', ')}`);
  if (!changed.length) {
    console.log('No changes found on the pages.');
    return;
  }
  for (const c of changed) console.log(`${write ? 'write ' : 'change'} ${c.file}  (${c.frames}/${c.total} frame${c.total > 1 ? 's' : ''})`);
  if (!write) {
    console.log(`${changed.length} images changed. Run again with --write to put them into the game.`);
    return;
  }
  const placeholders = loadPlaceholders();
  for (const c of changed) {
    writeFileSync(ASSETS_DIR + c.file, Buffer.from(c.png, 'base64'));
    delete placeholders[c.file]; // the artist's art now
  }
  savePlaceholders(placeholders);
  addChangelogLine(changed.map((c) => c.file));
  console.log(`${changed.length} images written; they won't be on the next sheet.`);
}

/**
 * In the browser: for each image, compare its frames on the page with the file. Returns, per
 * image, null (unchanged) or the number of changed frames and the new file (unchanged frames
 * keep the file's own pixels). Tiny differences (±3, from saving) and colours under fully
 * see-through pixels don't count.
 */
async function comparePage({ page, items }) {
  const load = async (data) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + data;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { c, ctx, w: img.width, h: img.height };
  };
  const sheet = await load(page);
  const out = [];
  for (const it of items) {
    const src = await load(it.data);
    let changedFrames = 0;
    for (const f of it.frames) {
      const a = src.ctx.getImageData(f.fx, f.fy, f.w, f.h);
      const b = sheet.ctx.getImageData(it.x + f.bx, it.y + f.by, f.w, f.h);
      let diff = false;
      for (let i = 0; i < a.data.length && !diff; i += 4) {
        const aa = a.data[i + 3], ba = b.data[i + 3];
        if (Math.abs(aa - ba) > 3) diff = true;
        else if (aa > 0 && ba > 0)
          for (let k = 0; k < 3; k++) if (Math.abs(a.data[i + k] - b.data[i + k]) > 3) diff = true;
      }
      if (diff) {
        changedFrames++;
        src.ctx.putImageData(b, f.fx, f.fy);
      }
    }
    out.push(changedFrames ? { frames: changedFrames, png: src.c.toDataURL('image/png').split(',')[1] } : null);
  }
  return out;
}

/** One player-facing CHANGELOG line naming what got new art, under today's date. */
function addChangelogLine(files) {
  // "vfx/explosion-t2.png" → "explosion"; "ships/enemy-energy-t3.png" → "energy enemy ship"; wrecks → "wreck".
  const nameOf = (f) => {
    const base = f.replace(/^.*\//, '').replace(/\.png$/, '').replace(/-t\d+(?=-wreck$|$)/, '');
    if (!f.startsWith('ships/')) return base.replace(/-/g, ' ');
    if (base.endsWith('wreck')) return 'wreck';
    const variant = /^enemy-(\w+)$/.exec(base);
    return variant ? `${variant[1]} enemy ship` : `${base.replace(/-/g, ' ')} ship`;
  };
  const names = [...new Set(files.map(nameOf))].sort();
  const path = join(ROOT, 'CHANGELOG.md');
  let text = readFileSync(path, 'utf8');
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const line = `- New art: ${names.join(', ')} (replacing placeholders).\n`;
  const heading = `## ${today}\n`;
  if (text.includes(heading)) text = text.replace(heading, heading + line);
  else text = text.replace(/\n## /, `\n${heading}${line}\n## `);
  writeFileSync(path, text);
}

// ---------- scan ----------

/** Rebuild the placeholder list: a file is a placeholder if the generators would make it exactly as it is. */
function scan() {
  const tmp = join(tmpdir(), `art-scan-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const node = process.execPath;
  execFileSync(node, [join(ROOT, 'tools/make-placeholder-art.mjs'), '--force', '--out', tmp + '/'], { stdio: 'ignore' });
  execFileSync(node, [join(ROOT, 'tools/make-enemy-ships.mjs'), '--force', '--out', join(tmp, 'ships')], { stdio: 'ignore' });
  const files = {};
  let mine = 0;
  for (const f of filesIn(tmp, tmp)) {
    const real = ASSETS_DIR + f;
    if (!existsSync(real)) continue;
    const h = hashOf(readFileSync(join(tmp, f)));
    if (h === hashOf(readFileSync(real))) files[f] = h;
    else mine++;
  }
  rmSync(tmp, { recursive: true, force: true });
  savePlaceholders(files);
  console.log(`${Object.keys(files).length} placeholder files recorded; ${mine} generated names are already your own art.`);
}

if (cmd === 'make') await make();
else if (cmd === 'apply') await apply();
else if (cmd === 'scan') scan();
else console.log('Use: make [--all-tiers] | apply [--write] | scan');
