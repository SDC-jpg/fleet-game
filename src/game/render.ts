// Draws the game state. Every picture comes from the asset manifest by name.

import type { Assets, Sprite } from '../engine/assets';
import type { PixelRenderer } from '../engine/renderer';
import { clamp } from '../engine/math';
import { SHIP_TYPES, CONFIG } from './config';
import { laserLength } from './skills';
import { controlledShip, isMergePart, typeOf, type GameState, type Ship, type Team, type Thrust } from './world';

/**
 * The art name for a tier: "<base>.t3<suffix>" for tier 3, falling back to
 * smaller tiers, then to plain "<base><suffix>". So "ship.fighter" at tier 2
 * is "ship.fighter.t2", and its wreck is "ship.fighter.t2.wreck".
 */
export function tierSprite(assets: Assets, base: string, tier: number, suffix = '') {
  for (let t = tier; t >= 2; t--) if (assets.has(`${base}.t${t}${suffix}`)) return `${base}.t${t}${suffix}`;
  return base + suffix;
}

/** A sprite with its team-colour parts recoloured for `team`. */
function teamSprite(assets: Assets, name: string, team: Team) {
  const tc = CONFIG.teamColors;
  return assets.getRecolored(name, tc[team], tc);
}

export function renderGame(state: GameState, r: PixelRenderer, assets: Assets) {
  r.drawTiled(assets.get('bg.stars-far'), 0.3);
  r.drawTiled(assets.get('bg.stars-near'), 0.6);

  for (const w of state.wrecks) {
    // Blink when about to disappear.
    const blinking = w.life < CONFIG.wreckBlinkTime && Math.floor(w.life * 6) % 2 === 0;
    const alpha = blinking ? 0.35 : 1;
    // A marker ring under the wreck, kept full size when zoomed out so wrecks stay easy to spot.
    r.drawSprite(assets.get(tierSprite(assets, 'ui.wreck-marker', w.tier)), w.x, w.y, 0, state.time, alpha, true);
    const sprite = assets.get(tierSprite(assets, SHIP_TYPES[w.type].sprites.ship, w.tier, '.wreck'));
    r.drawSprite(sprite, w.x, w.y, w.angle, state.time, alpha);
  }

  // Loot: a crate glowing in its rarity's colour (blinks before it disappears).
  for (const l of state.loot) {
    const blinking = l.life < CONFIG.wreckBlinkTime && Math.floor(l.life * 6) % 2 === 0;
    r.drawSprite(assets.get(`ui.loot.${l.item.rarity}`), l.x, l.y, 0, state.time, blinking ? 0.35 : 1, true);
  }

  // Mines (team-coloured, looping blink).
  for (const m of state.mines) {
    const sprite = teamSprite(assets, tierSprite(assets, 'projectile.mine', m.tier), m.team);
    r.drawSprite(sprite, m.x, m.y, 0, m.age);
  }

  // Elites get a marker ring under them.
  for (const s of state.ships) if (s.elite) r.drawSprite(assets.get(tierSprite(assets, 'ui.elite-marker', s.tier)), s.x, s.y, 0, state.time);

  // Draw every other ship first (small ones under big ones), then the
  // command ring and the ship you fly on top.
  const flagship = controlledShip(state);
  const ordered = state.ships.filter((s) => s !== flagship).sort((a, b) => a.tier - b.tier);
  for (const s of ordered) drawShip(r, assets, s, state.time);
  if (flagship) {
    // The command ring is also the boost meter: its frames go from empty (first) to full (last).
    const ring = assets.get(tierSprite(assets, 'ui.command-ring', flagship.tier));
    r.drawSprite(ring, flagship.x, flagship.y, 0, meterTime(ring, state.boostStamina), state.boostLocked ? 0.45 : 1);
    drawShip(r, assets, flagship, state.time);
  }

  // Shield bubbles over shielded ships (fading in their last second).
  for (const s of state.ships) {
    if (s.shield <= 0 || s.absorbed) continue;
    const bubble = assets.get(tierSprite(assets, 'vfx.shield', s.tier));
    r.drawSprite(bubble, s.x, s.y, 0, state.time, Math.min(1, s.shieldTime));
  }

  // Frozen ships get an icy overlay.
  for (const s of state.ships) {
    if (s.frozen <= 0 || s.absorbed) continue;
    r.drawSprite(assets.get(tierSprite(assets, 'vfx.frozen', s.tier)), s.x, s.y, 0, state.time, Math.min(1, s.frozen * 2));
  }

  // An elite's laser warning: a flickering line where its beam is about to go.
  for (const s of state.ships) {
    const laser = s.elite?.skills.find((sk) => sk.id === 'laser');
    if (!laser || !s.elite || s.elite.laserCharge <= 0) continue;
    const warn = teamSprite(assets, tierSprite(assets, 'vfx.laser-warning', s.tier), s.team);
    const x = s.x + Math.cos(s.angle) * s.stats.gunOffset;
    const y = s.y + Math.sin(s.angle) * s.stats.gunOffset;
    drawBeam(r, warn, x, y, s.angle, laserLength(s, laser), laser.mods.size, state.time);
  }

  // Laser beams: one short segment image repeated along the beam's length.
  for (const b of state.beams) {
    const seg = teamSprite(assets, tierSprite(assets, 'vfx.laser', b.tier), b.team);
    drawBeam(r, seg, b.x, b.y, b.angle, b.length, b.width, b.age);
  }

  for (const b of state.bullets) {
    const sprite = teamSprite(assets, tierSprite(assets, b.sprite, b.tier), b.team);
    r.drawSprite(sprite, b.x, b.y, Math.atan2(b.vy, b.vx), state.time);
  }

  for (const e of state.effects)
    r.drawSprite(assets.get(tierSprite(assets, e.sprite, e.tier)), e.x, e.y, e.angle, e.age, 1, false, e.scale);

  // Arrows at the screen edge pointing to things you can't see.
  const wreckArrow = assets.get('ui.arrow.wreck');
  for (const w of state.wrecks) drawEdgeArrow(r, wreckArrow, w.x, w.y, state.time);
  const lootArrow = assets.get('ui.arrow.loot');
  for (const l of state.loot) drawEdgeArrow(r, lootArrow, l.x, l.y, state.time);
  const enemyArrow = assets.get('ui.arrow.enemy');
  const eliteArrow = assets.get('ui.arrow.elite');
  for (const s of state.ships) if (s.team === 'enemy') drawEdgeArrow(r, s.elite ? eliteArrow : enemyArrow, s.x, s.y, state.time);
}

/** A beam: one short segment image repeated along its length, scaled by `width`. */
function drawBeam(r: PixelRenderer, seg: Sprite, x: number, y: number, angle: number, length: number, width: number, time: number) {
  const w = seg.frames[0].w;
  const n = Math.ceil(length / (w * width));
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let i = 0; i < n; i++) r.drawSprite(seg, x + dx * (i + 0.5) * w * width, y + dy * (i + 0.5) * w * width, angle, time, 1, false, width);
}

/** Draws one ship, plus a small health bar under it if it's damaged. */
function drawShip(r: PixelRenderer, assets: Assets, s: Ship, time: number) {
  if (s.absorbed) return; // already inside the ship it's merging into
  // Dash trail behind the ship, pointing back along its movement. Plays once per dash.
  if (s.fleet.dashTime > 0 && !isMergePart(s)) {
    const trail = teamSprite(assets, tierSprite(assets, 'vfx.dash', s.tier), s.team);
    r.drawSprite(trail, s.x, s.y, Math.atan2(s.vy, s.vx), CONFIG.dash.duration - s.fleet.dashTime);
  }
  const base = tierSprite(assets, typeOf(s).sprites.ship, s.tier);
  // Ships flying into a merge fade out as they reach the core.
  let alpha = 1;
  if (s.merge && isMergePart(s)) {
    const core = s.merge.core;
    alpha = clamp(Math.hypot(core.x - s.x, core.y - s.y) / (core.stats.radius * 2), 0.3, 1);
  }
  r.drawSprite(teamSprite(assets, shipSprite(assets, base, s.thrust), s.team), s.x, s.y, s.angle, time, alpha);
  const maxHp = s.stats.maxHp;
  if (s.hp < maxHp) {
    const w = Math.round(16 * s.stats.size);
    const x = s.x - w / 2;
    const y = s.y + s.stats.radius + 4;
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
  // Inset in game pixels, so the arrow stays fully on screen at any zoom.
  const inset = 10 / r.worldScale;
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  const dx = x - cx;
  const dy = y - cy;
  // Shrink the direction until it touches the (slightly inset) screen edge.
  const k = Math.min((v.w / 2 - inset) / Math.abs(dx || 1e-6), (v.h / 2 - inset) / Math.abs(dy || 1e-6));
  r.drawSprite(sprite, cx + dx * k, cy + dy * k, Math.atan2(dy, dx), time, 1, true);
}

/** The animation time that shows a meter sprite's frame for `fraction` (0 = first frame, 1 = last). */
function meterTime(sprite: Sprite, fraction: number) {
  if (sprite.fps <= 0) return 0;
  const last = sprite.frames.length - 1;
  return (Math.round(fraction * last) + 0.5) / sprite.fps;
}
