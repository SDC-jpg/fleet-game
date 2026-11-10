// Opens the game in an invisible browser, runs some steps, and saves screenshots.
// Lets Claude see the game. Needs the dev server running (npm run dev).
//
//   node tools/screenshot.mjs --out screenshots [steps...]
//
// Steps (run in order):
//   wait:1500          wait 1.5 seconds
//   press:Equal*10     press a key (here 10 times). Key names: KeyW, Space, Equal, Minus, KeyG...
//   hold:KeyD:800      hold a key for 0.8 seconds
//   keydown:KeyD       start holding a key (screenshots taken now show it held)
//   keyup:KeyD         let go of a key
//   mouse:900,300      move the mouse to x,y (pixels from the top-left of the page)
//   down / up          press / release the left mouse button
//   shot:name          save a screenshot as <out>/name.png
// With no steps: wait 1.5 s, then take one screenshot called "game".

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const outDir = opt('--out', 'screenshots');
const url = opt('--url', 'http://localhost:5173');
const [width, height] = opt('--size', '1280x720').split('x').map(Number);
const steps = args.length ? args : ['wait:1500', 'shot:game'];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  // The container has no sandbox support; fine since we only open our own local game.
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[browser ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) console.log(`[missing file] ${r.status()} ${r.url()}`);
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.mouse.move(width / 2 + 100, height / 2);

  for (const step of steps) {
    const [cmd, ...rest] = step.split(':');
    const arg = rest.join(':');
    if (cmd === 'wait') await page.waitForTimeout(Number(arg));
    else if (cmd === 'press') {
      const [key, times = '1'] = arg.split('*');
      for (let i = 0; i < Number(times); i++) await page.keyboard.press(key);
    } else if (cmd === 'hold') {
      const [key, ms] = arg.split(':');
      await page.keyboard.down(key);
      await page.waitForTimeout(Number(ms));
      await page.keyboard.up(key);
    } else if (cmd === 'keydown') await page.keyboard.down(arg);
    else if (cmd === 'keyup') await page.keyboard.up(arg);
    else if (cmd === 'mouse') {
      const [x, y] = arg.split(',').map(Number);
      await page.mouse.move(x, y);
    } else if (cmd === 'down') await page.mouse.down();
    else if (cmd === 'up') await page.mouse.up();
    else if (cmd === 'shot') {
      const file = join(outDir, `${arg || 'shot'}.png`);
      await page.screenshot({ path: file });
      console.log(`saved ${file}`);
    } else throw new Error(`Unknown step "${step}"`);
  }
} finally {
  await browser.close();
}
