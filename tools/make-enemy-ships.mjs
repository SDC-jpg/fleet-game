// Makes the enemy ship images from the player ship images
// (public/assets/ships/fighter*.png), with their sky-blue team parts turned once
// (the rule the game used to apply at load time, CONFIG.teamColors):
// - enemy*.png: red (standard enemies, ballistic guns)
// - enemy-energy*.png: purple (energy variant)
// - enemy-explosive*.png: orange (explosive variant)
// After that they're ordinary art the user can repaint freely; the game doesn't recolour ships.
//
//   node tools/make-enemy-ships.mjs          -> only creates missing files
//   node tools/make-enemy-ships.mjs --force  -> overwrites them (careful: replaces edited enemy art!)
//   node tools/make-enemy-ships.mjs --check <files...> -> just counts team-blue pixels in those files
//
// Uses the container's Chromium (like screenshot.mjs) to read and write PNGs.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const SHIPS = fileURLToPath(new URL('../public/assets/ships/', import.meta.url));
const FORCE = process.argv.includes('--force');
const checkAt = process.argv.indexOf('--check');
// Same numbers as CONFIG.teamColors in src/game/config.ts.
const RULE = { hueMin: 180, hueMax: 230, minSaturation: 0.4 };
/** File name start → how far the team blue turns (degrees): 200° sky blue + 170 = red, + 90 = purple, + 195 = orange. */
const COPIES = { enemy: 170, 'enemy-energy': 90, 'enemy-explosive': 195 };
const TIERS = [1, 2, 3, 4, 5, 6, 7, 8];
const src = (t) => `${SHIPS}fighter${t === 1 ? '' : `-t${t}`}.png`;
const dst = (name, t) => `${SHIPS}${name}${t === 1 ? '' : `-t${t}`}.png`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  /** Recolours one PNG in the browser; returns [new PNG as base64, team-blue pixel count]. */
  const recolor = (file, shift = 0) =>
    page.evaluate(
      async ({ data, rule }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + data;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, c.width, c.height);
        const d = px.data;
        let count = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b), ch = max - min;
          let h = 0;
          if (ch > 0) h = max === r ? ((g - b) / ch) % 6 : max === g ? (b - r) / ch + 2 : (r - g) / ch + 4;
          h = (h * 60 + 360) % 360;
          const s = max === 0 ? 0 : ch / max, v = max / 255;
          if (s === 0 || s < rule.minSaturation || h < rule.hueMin || h > rule.hueMax) continue;
          count++;
          const nh = (h + rule.shift) % 360;
          const f = (n) => { const k = (n + nh / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
          d[i] = f(5); d[i + 1] = f(3); d[i + 2] = f(1);
        }
        ctx.putImageData(px, 0, 0);
        return [c.toDataURL('image/png').split(',')[1], count];
      },
      { data: readFileSync(file).toString('base64'), rule: { ...RULE, shift } },
    );

  if (checkAt >= 0) {
    for (const f of process.argv.slice(checkAt + 1)) console.log(`${(await recolor(f))[1]} team-blue pixels  ${f}`);
  } else {
    for (const [name, shift] of Object.entries(COPIES))
      for (const t of TIERS) {
        const out = dst(name, t);
        if (!existsSync(src(t))) continue;
        if (existsSync(out) && !FORCE) {
          console.log(`kept     ${out}`);
          continue;
        }
        const [png, count] = await recolor(src(t), shift);
        writeFileSync(out, Buffer.from(png, 'base64'));
        console.log(`made     ${out} (${count} pixels recoloured)`);
      }
  }
} finally {
  await browser.close();
}
