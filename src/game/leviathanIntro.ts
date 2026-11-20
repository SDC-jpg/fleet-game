// The Leviathan's entrance (CONFIG.leviathan.intro): words typing across the top of the screen,
// distant purple lightning far beyond the stars, a flash as a rift tears open there, its
// silhouette rushing out of it (each piece glowing as it comes out, then dark), then the real
// Leviathan comes for you. This file is the timeline; render.ts draws it (drawIntroLayer) and the
// HUD shows the words.
//
// The distant layer is measured in screen pixels on a 1080-tall screen, from the middle of the
// screen when the intro started, and moves only a little with your fleet (`parallax`).

import { randRange } from '../engine/math';
import { CONFIG } from './config';
import { followHead, makeLeviathanBody, type LeviathanBody } from './leviathan';
import { addSound, controlledShip, spawnLeviathanFrom, type GameState } from './world';

export interface BossIntro {
  /** Seconds since it started. */
  t: number;
  /** Where your flagship was when it started (the distant layer's parallax is measured from there). */
  originX: number;
  originY: number;
  /** Lightning bolts now: where (layer pixels), which of the bolt images, how big, how long it's shown. */
  bolts: { x: number; y: number; frame: number; scale: number; flip: boolean; age: number }[];
  nextBolt: number;
  /** Where the rift is (layer pixels). */
  riftX: number;
  riftY: number;
  /** Which way its silhouette flies out (up and to the left). */
  angle: number;
  /** Its silhouette (its own pixels from the rift; drawn × silhouetteScale), how far its head has come, and when each piece came out (−1 = not yet). */
  body: LeviathanBody | null;
  travel: number;
  out: number[];
  /** When the tail came out, and when the rift closed (−1 = not yet). */
  tailOutAt: number;
  closedAt: number;
  /** The flash (and its sounds) done. */
  flashed: boolean;
}

/** Start the entrance (instead of a wave's usual enemies). */
export function startBossIntro(state: GameState) {
  const at = controlledShip(state) ?? { x: 0, y: 0 };
  state.bossIntro = {
    t: 0,
    originX: at.x,
    originY: at.y,
    bolts: [],
    nextBolt: CONFIG.leviathan.intro.lightningFrom,
    // Off to one side of the top half, never over your fleet in the middle.
    riftX: (Math.random() < 0.5 ? -1 : 1) * randRange(260, 480),
    riftY: randRange(-260, -140),
    angle: Math.atan2(-1, -1) + randRange(-0.2, 0.2),
    body: null,
    travel: 0,
    out: [],
    tailOutAt: -1,
    closedAt: -1,
    flashed: false,
  };
}

/** Each step while it plays. */
export function updateBossIntro(state: GameState, dt: number, spawnDistance: number) {
  const I = CONFIG.leviathan.intro;
  const it = state.bossIntro!;
  it.t += dt;
  // Lightning far away, while the words are on screen.
  for (const b of it.bolts) b.age += dt;
  it.bolts = it.bolts.filter((b) => b.age < I.boltLife);
  if (it.t >= it.nextBolt && it.t < I.textUntil + I.textFade) {
    it.nextBolt = it.t + randRange(I.boltGap[0], I.boltGap[1]);
    it.bolts.push({ x: randRange(-900, 900), y: randRange(-480, 200), frame: Math.floor(Math.random() * 4), scale: randRange(1.2, 2.6), flip: Math.random() < 0.5, age: 0 });
    if (Math.random() < 0.5) addSound(state, 'sfx.leviathan-thunder', controlledShip(state) ?? { x: 0, y: 0 }, 1, randRange(0.4, 1), true);
  }
  // The flash, and the rift tears open.
  if (!it.flashed && it.t >= I.riftAt) {
    it.flashed = true;
    const at = controlledShip(state) ?? { x: 0, y: 0 };
    addSound(state, 'sfx.leviathan-rift', at, 1, 1, true);
    // Its deep roar from beyond the rift (the user's sound).
    addSound(state, 'sfx.leviathan-deeproar', at, 1, 1, true);
  }
  // Its silhouette rushes out of the rift.
  if (it.t >= I.riftAt + I.silhouetteAfter) {
    if (!it.body) {
      it.body = makeLeviathanBody(0, 0, it.angle);
      it.out = it.body.pieces.map(() => -1);
    }
    it.travel += I.silhouetteSpeed * dt;
    // Straight out, with a slow snaking sway.
    const sway = Math.sin(it.travel / 140) * 0.35;
    const a = it.angle + sway;
    const head = it.body.pieces[0];
    const x = head.x + Math.cos(a) * I.silhouetteSpeed * dt;
    const y = head.y + Math.sin(a) * I.silhouetteSpeed * dt;
    followHead(it.body, x, y, a);
    it.body.pieces.forEach((p, i) => {
      if (it.out[i] < 0 && it.travel >= p.behind) it.out[i] = it.t;
    });
    if (it.tailOutAt < 0 && it.out[it.out.length - 1] >= 0) it.tailOutAt = it.t;
  }
  if (it.tailOutAt >= 0 && it.closedAt < 0 && it.t >= it.tailOutAt + I.closeAfter) it.closedAt = it.t;
  // Then it comes for you, from where it went (up and to the left).
  if (it.closedAt >= 0 && it.t >= it.closedAt + I.enterAfter) {
    const near = controlledShip(state);
    if (near) spawnLeviathanFrom(state, near, spawnDistance, it.angle);
    state.bossIntro = null;
  }
}

/** The words now: how many letters are typed, and how visible they are (0–1). null = none. */
export function introText(it: BossIntro | null) {
  const I = CONFIG.leviathan.intro;
  if (!it || it.t >= I.textUntil + I.textFade) return null;
  const letters = Math.min(I.text.length, Math.floor(it.t * I.typeSpeed));
  const alpha = it.t < I.textUntil ? 1 : 1 - (it.t - I.textUntil) / I.textFade;
  return { text: I.text.slice(0, letters), full: I.text, alpha };
}

/** The rift's opening now: 0 = shut, 1 = fully open (it opens over its image's frames, and closes the same way). */
export function riftOpening(it: BossIntro) {
  const I = CONFIG.leviathan.intro;
  if (it.t < I.riftAt) return 0;
  const open = Math.min(1, (it.t - I.riftAt) / 0.5);
  if (it.closedAt < 0) return open;
  return Math.max(0, 1 - (it.t - it.closedAt) / 0.5);
}
