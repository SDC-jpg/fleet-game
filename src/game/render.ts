// Draws the game state. Every picture comes from the asset manifest by name.

import type { Assets, Sprite } from '../engine/assets';
import type { PixelRenderer } from '../engine/renderer';
import { SHIP_TYPES, CONFIG } from './config';
import { controlledShip, maxHpOf, typeOf, type GameState, type Ship, type Thrust } from './world';

export function renderGame(state: GameState, r: PixelRenderer, assets: Assets) {
  r.drawTiled(assets.get('bg.stars-far'), 0.3);
  r.drawTiled(assets.get('bg.stars-near'), 0.6);

  for (const w of state.wrecks) {
    // Blink when about to disappear.
    const blinking = w.life < CONFIG.wreckBlinkTime && Math.floor(w.life * 6) % 2 === 0;
    r.drawSprite(assets.get(SHIP_TYPES[w.type].sprites.wreck), w.x, w.y, w.angle, state.time, blinking ? 0.35 : 1);
  }

  // Draw every other ship first, then the command ring and the ship you fly on top.
  const flagship = controlledShip(state);
  const ordered = state.ships.filter((s) => s !== flagship);
  for (const s of ordered) drawShip(r, assets, s, state.time);
  if (flagship) {
    r.drawSprite(assets.get('ui.command-ring'), flagship.x, flagship.y, 0, state.time);
    drawShip(r, assets, flagship, state.time);
  }

  for (const b of state.bullets) r.drawSprite(assets.get(b.sprite), b.x, b.y, Math.atan2(b.vy, b.vx), state.time);

  for (const e of state.effects) r.drawSprite(assets.get(e.sprite), e.x, e.y, e.angle, e.age);

  // Arrows at the screen edge pointing to things you can't see.
  const wreckArrow = assets.get('ui.arrow.wreck');
  for (const w of state.wrecks) drawEdgeArrow(r, wreckArrow, w.x, w.y, state.time);
  const enemyArrow = assets.get('ui.arrow.enemy');
  for (const s of state.ships) if (s.team === 'enemy') drawEdgeArrow(r, enemyArrow, s.x, s.y, state.time);
}

/** Draws one ship, plus a small health bar under it if it's damaged. */
function drawShip(r: PixelRenderer, assets: Assets, s: Ship, time: number) {
  const t = typeOf(s);
  r.drawSprite(assets.get(shipSprite(assets, t.sprites[s.team], s.thrust)), s.x, s.y, s.angle, time);
  const maxHp = maxHpOf(s);
  if (s.hp < maxHp) {
    const w = 16;
    const x = s.x - w / 2;
    const y = s.y + t.radius + 4;
    r.fillRect(x, y, w, 1, '#000000');
    r.fillRect(x, y, Math.max(1, Math.round((w * s.hp) / maxHp)), 1, s.team === 'player' ? '#7fe07f' : '#ff6b5a');
  }
}

/**
 * Picks the image for a ship's engine state: "<name>.boost", then "<name>.move",
 * then plain "<name>", using the first one that exists in the manifest.
 */
function shipSprite(assets: Assets, base: string, thrust: Thrust) {
  const options = thrust === 'boost' ? ['.boost', '.move'] : thrust === 'move' ? ['.move'] : [];
  for (const suffix of options) if (assets.has(base + suffix)) return base + suffix;
  return base;
}

/** If (x, y) is off-screen, draw `sprite` at the screen edge, pointing toward it. */
function drawEdgeArrow(r: PixelRenderer, sprite: Sprite, x: number, y: number, time: number) {
  const v = r.view;
  if (x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h) return;
  const inset = 10;
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  const dx = x - cx;
  const dy = y - cy;
  // Shrink the direction until it touches the (slightly inset) screen edge.
  const k = Math.min((v.w / 2 - inset) / Math.abs(dx || 1e-6), (v.h / 2 - inset) / Math.abs(dy || 1e-6));
  r.drawSprite(sprite, cx + dx * k, cy + dy * k, Math.atan2(dy, dx), time);
}
