// Draws the game state. Every picture comes from the asset manifest by name.

import type { Assets, Sprite } from '../engine/assets';
import type { PixelRenderer } from '../engine/renderer';
import { clamp } from '../engine/math';
import { SHIP_TYPES, CONFIG } from './config';
import { BEAM_SHOW_TIME, laserLength } from './skills';
import type { Particles } from './particles';
import { ownedSkill, pdcPositions } from './newSkills';
import { fileSprite, shipPointToWorld, type ArtLayout, type ArtLayoutsFile } from './artLayout';
import { gunsOf, shipArtBase } from './guns';
import { controlledShip, drawnAsSymbol, isMergePart, symbolTierMax, type GameState, type Ship, type Team } from './world';
import { PIECE_SPRITES, SIDE_HEAD_SPRITE, type LeviathanBody, type PieceKind } from './leviathan';

/**
 * The art name for a tier: "<base>.t3<suffix>" for tier 3, falling back to
 * smaller tiers, then to plain "<base><suffix>". So "ship.fighter" at tier 2
 * is "ship.fighter.t2", and its wreck is "ship.fighter.t2.wreck".
 */
export function tierSprite(assets: Assets, base: string, tier: number, suffix = '') {
  return tierArt(assets, base, tier, suffix, false).name;
}

/** Detail steps in effect (docs/DETAIL-STEPS.md; set by Game.ts or ShipArt's preview each frame). */
let detailSteps = 0;
export function setDetailSteps(steps: number) {
  detailSteps = steps;
}

/**
 * The art to draw for this tier, and how much to enlarge it. A tier with no art of its
 * own uses the closest smaller tier's, scaled up CONFIG.tiers.sizePerTier per missing
 * tier so it still fits the ship's size. Art with no tier versions at all keeps its size.
 * `detail`: with detail steps, use the art of that many tiers lower (enlarged to the
 * same size, so the renderer draws it at 1 pixel per art pixel, crisp). Ships and
 * wrecks pass false: they use shrunk copies of their own design instead.
 */
export function tierArt(assets: Assets, base: string, tier: number, suffix = '', detail = true) {
  const per = CONFIG.tiers.sizePerTier;
  const from = detail ? Math.max(1, tier - detailSteps) : tier;
  for (let t = from; t >= 2; t--) if (assets.has(`${base}.t${t}${suffix}`)) return { name: `${base}.t${t}${suffix}`, scale: per ** (tier - t) };
  // Only tier-1 art left: scaled to the tier if the art has tier versions at all.
  const tiered = tier > 1 && from < tier && assets.has(`${base}.t2${suffix}`);
  return { name: base + suffix, scale: tiered ? per ** (tier - 1) : 1 };
}

/** A tier's art as a sprite, with its scale (see tierArt). */
function tierSpriteScaled(assets: Assets, base: string, tier: number) {
  const a = tierArt(assets, base, tier);
  return { sprite: assets.get(a.name), scale: a.scale };
}

/** A sprite with its team-colour parts recoloured for `team` (null = in its own colours). */
function teamSprite(assets: Assets, name: string, team: Team | null) {
  if (!team) return assets.get(name);
  const tc = CONFIG.teamColors;
  return assets.getRecolored(name, tc[team], tc);
}

/** Art layouts (art.json) and particles, set up by Game.ts. */
export interface ArtExtras {
  layouts: ArtLayoutsFile;
  particles: Particles;
  /** Commander view options and background shifts (see CONFIG.commander); missing = all off. */
  view?: ViewOptions;
}

/** How the commander view and background look this frame (worked out by Game.ts). */
export interface ViewOptions {
  /** Symbol ships show targeting lines / their shots are drawn (Settings). */
  targetLines: boolean;
  shots: boolean;
  /** Blue shift (commander view) and red shift (Time Dilation), 0–1, fading in and out. */
  blue: number;
  red: number;
  /** The long-exposure smear of the stars during Time Dilation: how far back (game pixels). */
  smearX: number;
  smearY: number;
}

/**
 * The starfield, dimmed and colour-shifted: blue while the commander view is on, red during
 * Time Dilation (its stars smeared like a long exposure).
 */
function drawBackground(r: PixelRenderer, assets: Assets, view: ViewOptions | undefined) {
  const C = CONFIG.commander;
  const T = CONFIG.timeDilation;
  const blue = view?.blue ?? 0;
  const red = view?.red ?? 0;
  const shift = Math.max(blue, red);
  const dim = 1 - (1 - C.starDim) * shift;
  const smear = red > 0 && view ? T.smearCopies : 0;
  // A black base first, so the colour shifts below tint the stars instead of filling empty space.
  if (shift > 0) r.fillView('#000000', 1);
  for (const [name, parallax] of [['bg.stars-far', 0.3], ['bg.stars-near', 0.6]] as const) {
    const sprite = assets.get(name);
    // Smear: fainter copies behind, along your movement.
    for (let i = smear; i >= 1; i--)
      r.drawTiled(sprite, parallax, ((dim * red * 0.6) / smear) * (1 - (i - 1) / smear) * 1.8, view!.smearX * (i / smear), view!.smearY * (i / smear));
    r.drawTiled(sprite, parallax, dim);
  }
  // Colour shift, then a thin haze (red wins while Time Dilation runs).
  if (red > 0) {
    r.fillView(T.redShift, red, 'multiply');
    r.fillView(T.redHaze, T.redHazeAlpha * red);
  } else if (blue > 0) {
    r.fillView(C.blueShift, blue, 'multiply');
    r.fillView(C.blueHaze, C.blueHazeAlpha * blue);
  }
}

/**
 * A ship's symbol for the commander view: "ui.hud.<side>.t<tier>", side = player, enemy,
 * enemy-energy or enemy-explosive (from its art), falling back to a smaller tier's symbol.
 */
function symbolSprite(assets: Assets, artBase: string, tier: number) {
  const side = Object.values(SHIP_TYPES).some((t) => t.sprites.ship === artBase) ? 'player' : artBase.replace(/^ship\./, '');
  for (let t = tier; t > 1; t--) if (assets.has(`ui.hud.${side}.t${t}`)) return assets.get(`ui.hud.${side}.t${t}`);
  return assets.get(`ui.hud.${side}.t1`);
}

export function renderGame(state: GameState, r: PixelRenderer, assets: Assets, extras: ArtExtras) {
  drawBackground(r, assets, extras.view);
  const view = extras.view;
  const symbolMax = symbolTierMax(state);

  for (const w of state.wrecks) {
    // Blink when about to disappear.
    const blinking = w.life < CONFIG.wreckBlinkTime && Math.floor(w.life * 6) % 2 === 0;
    const alpha = blinking ? 0.35 : 1;
    // A marker under the wreck, kept full size when zoomed out so wrecks stay easy to spot (early waves only).
    if (state.wave < CONFIG.wreckMarkerUntilWave)
    {
      const m = tierSpriteScaled(assets, 'ui.wreck-marker', w.tier);
      r.drawSprite(m.sprite, w.x, w.y, 0, state.time, alpha, true, m.scale);
    }
    // Commander view: small wrecks are grey HUD dots.
    if (w.tier <= symbolMax || w.tier - detailSteps < 1) {
      r.drawSprite(assets.get('ui.hud.wreck'), w.x, w.y, 0, state.time, alpha, true);
      continue;
    }
    // Drawn from its layout (art.json), in its own colours (wrecks aren't team-coloured).
    const { name, scale } = tierArt(assets, SHIP_TYPES[w.type].sprites.ship, w.tier, '.wreck', false);
    drawLayoutArt(r, assets, extras.layouts.objects[name], name, w.x, w.y, w.angle, 'drifting', null, state.time, alpha, true, scale);
  }

  // Loot: a crate glowing in its rarity's colour (blinks before it disappears),
  // or a quality-of-life drop like the Merge Module (never disappears).
  for (const l of state.loot) {
    const blinking = l.life < CONFIG.wreckBlinkTime && Math.floor(l.life * 6) % 2 === 0;
    // Merge Module upgrades (Mk. II–IV) have their own look: ui.loot.merge-module-2 and up.
    const qol = l.qol && (l.level ?? 1) > 1 ? `${l.qol}-${l.level}` : l.qol;
    const sprite = qol ? `ui.loot.${qol}` : `ui.loot.${l.item?.rarity}`;
    r.drawSprite(assets.get(sprite), l.x, l.y, 0, state.time, blinking ? 0.35 : 1, true);
  }

  // Mines (team-coloured, looping blink).
  for (const m of state.mines) {
    const { name, scale } = tierArt(assets, 'projectile.mine', m.tier);
    drawLayoutArt(r, assets, extras.layouts.objects[name], name, m.x, m.y, 0, 'armed', m.team, m.age, 1, true, scale);
  }

  // Elites get a marker ring under them.
  for (const s of state.ships) {
    if (!s.elite) continue;
    const m = tierSpriteScaled(assets, 'ui.elite-marker', s.tier);
    r.drawSprite(m.sprite, s.x, s.y, 0, state.time, 1, false, m.scale);
  }

  // Thruster particles, under the ships.
  extras.particles.draw(r, assets);

  // Draw every other ship first (small ones under big ones), then the
  // command ring and the ship you fly on top.
  const flagship = controlledShip(state);
  const ordered = state.ships.filter((s) => s !== flagship).sort((a, b) => a.tier - b.tier);
  // Commander view: symbol ships' targeting lines first, under everything (fading out toward the target).
  if (view?.targetLines)
    for (const s of ordered) {
      const t = s.target;
      if (!t || t.dead || s.dead || !drawnAsSymbol(state, s, symbolMax)) continue;
      const color = s.team === 'player' ? CONFIG.commander.lineColorPlayer : CONFIG.commander.lineColorEnemy;
      r.drawLine(s.x, s.y, t.x, t.y, color, CONFIG.commander.targetLineAlpha, 0);
    }
  for (const s of ordered) drawShip(r, assets, extras.layouts, s, state.time, drawnAsSymbol(state, s, symbolMax));
  if (flagship) {
    // The command ring is also the boost meter: its frames go from empty (first) to full (last).
    const { sprite: ring, scale } = tierSpriteScaled(assets, 'ui.command-ring', flagship.tier);
    r.drawSprite(ring, flagship.x, flagship.y, 0, meterTime(ring, state.boostStamina), state.boostLocked ? 0.45 : 1, false, scale);
    drawShip(r, assets, extras.layouts, flagship, state.time, false);
  }

  // Shield bubbles over shielded ships (fading in their last second), and over reinforcements while they can't be hurt.
  for (const s of state.ships) {
    if ((s.shield <= 0 && s.immune <= 0) || s.absorbed) continue;
    const bubble = tierSpriteScaled(assets, 'vfx.shield', s.tier);
    r.drawSprite(bubble.sprite, s.x, s.y, 0, state.time, Math.min(1, Math.max(s.shield > 0 ? s.shieldTime : 0, s.immune * 2)), false, bubble.scale);
  }

  // Frozen ships get an icy overlay.
  for (const s of state.ships) {
    if (s.frozen <= 0 || s.absorbed) continue;
    const ice = tierSpriteScaled(assets, 'vfx.frozen', s.tier);
    r.drawSprite(ice.sprite, s.x, s.y, 0, state.time, Math.min(1, s.frozen * 2), false, ice.scale);
  }

  // Scrambled ships get a glitchy marker.
  for (const s of state.ships) {
    if (s.scrambled <= 0 || s.absorbed) continue;
    r.drawSprite(assets.get('vfx.scrambled'), s.x, s.y - s.stats.radius - 6, 0, state.time, Math.min(1, s.scrambled * 3), false, s.stats.size);
  }

  // An elite's laser warning: a flickering line where its beam is about to go.
  for (const s of state.ships) {
    const laser = s.elite?.skills.find((sk) => sk.id === 'laser');
    if (!laser || !s.elite || s.elite.laserCharge <= 0) continue;
    const w = tierArt(assets, 'vfx.laser-warning', s.tier);
    const warn = teamSprite(assets, w.name, s.team);
    const x = s.x + Math.cos(s.angle) * s.stats.gunOffset;
    const y = s.y + Math.sin(s.angle) * s.stats.gunOffset;
    drawBeam(r, warn, x, y, s.angle, laserLength(s, laser), laser.mods.size * w.scale, state.time);
    // The laser's Warning mounts (art.json), at the muzzle.
    const { name, scale } = tierArt(assets, 'vfx.laser', s.tier);
    drawLayoutArt(r, assets, extras.layouts.objects[name], name, x, y, s.angle, 'warning', s.team, state.time, 1, false, scale);
  }

  // Laser beams: one short segment image repeated along the beam's length.
  for (const b of state.beams) {
    // Commander view: symbol ships' beams are thin lines, fading out toward the end.
    if (b.tier <= symbolMax) {
      const color = b.team === 'player' ? CONFIG.commander.lineColorPlayer : CONFIG.commander.lineColorEnemy;
      const fade = 1 - b.age / BEAM_SHOW_TIME;
      r.drawLine(b.x, b.y, b.x + Math.cos(b.angle) * b.length, b.y + Math.sin(b.angle) * b.length, color, 0.9 * fade, 0);
      continue;
    }
    const { name, scale } = tierArt(assets, 'vfx.laser', b.tier);
    drawBeam(r, teamSprite(assets, name, b.team), b.x, b.y, b.angle, b.length, b.width * scale, b.age);
    // The laser's Beam mounts (art.json), at the muzzle.
    drawLayoutArt(r, assets, extras.layouts.objects[name], name, b.x, b.y, b.angle, 'beam', b.team, b.age, 1, false, scale);
  }

  // Energy guns' beams (CONFIG.guns.types.energy): the laser image along the beam up to what it burns,
  // and a searing impact there (vfx.laser-impact, turned to face back up the beam).
  const ED = CONFIG.guns.types.energy.duration;
  for (const b of state.energyBeams) {
    const alpha = Math.min(1, b.age / 0.05, (ED - b.age) / 0.15);
    if (b.tier <= symbolMax) {
      const color = b.team === 'player' ? CONFIG.commander.lineColorPlayer : CONFIG.commander.lineColorEnemy;
      r.drawLine(b.x, b.y, b.x + Math.cos(b.angle) * b.length, b.y + Math.sin(b.angle) * b.length, color, 0.9 * alpha, b.hit ? 0.9 * alpha : 0);
      continue;
    }
    const { name, scale } = tierArt(assets, 'vfx.laser', b.tier);
    drawBeam(r, teamSprite(assets, name, b.team), b.x, b.y, b.angle, b.length, scale, b.age, alpha);
    drawLayoutArt(r, assets, extras.layouts.objects[name], name, b.x, b.y, b.angle, 'beam', b.team, b.age, alpha, false, scale);
    if (b.hit) {
      const imp = tierArt(assets, 'vfx.laser-impact', b.tier);
      r.drawSprite(teamSprite(assets, imp.name, b.team), b.hit.x, b.hit.y, b.angle + Math.PI, state.time, alpha, false, imp.scale);
    }
  }

  drawSkillObjects(state, r, assets, extras);

  // Point Defense Cannons: two small turrets on the flagship, pointing where they aim.
  const pdcShip = controlledShip(state);
  if (pdcShip && !pdcShip.dead && ownedSkill(state, 'pdc')) {
    const cannon = teamSprite(assets, 'pdc.cannon', 'player');
    pdcPositions(pdcShip).forEach((p, i) => r.drawSprite(cannon, p.x, p.y, state.pdc.cannons[i].angle, state.time, 1, false, pdcShip.stats.size));
  }

  for (const b of state.bullets) {
    // Commander view: symbol ships' shots (and missiles) are HUD shots, or not drawn at all (Settings).
    if (b.tier <= symbolMax) {
      if (view?.shots) {
        const angle = b.homing > 0 ? (b.facing ?? Math.atan2(b.vy, b.vx)) : Math.atan2(b.vy, b.vx);
        drawLayoutArt(r, assets, extras.layouts.objects['projectile.hud'], 'projectile.hud', b.x, b.y, angle, 'flying', b.team, state.time);
      }
      continue;
    }
    const { name, scale } = tierArt(assets, b.sprite, b.tier);
    if (b.homing > 0) {
      // Missiles are drawn from their layout (art.json): Inert until they fire up, then Fired
      // (with their flame mount). They point where they face, which can differ from where they fly.
      const angle = b.facing ?? Math.atan2(b.vy, b.vx);
      drawLayoutArt(r, assets, extras.layouts.objects[name], name, b.x, b.y, angle, b.lit ? 'fired' : 'inert', b.team, state.time, 1, true, scale);
    } else drawLayoutArt(r, assets, extras.layouts.objects[name], name, b.x, b.y, Math.atan2(b.vy, b.vx), 'flying', b.team, state.time, 1, true, scale);
  }

  // Flagship debris: each piece is one frame of vfx.debris, spinning, fading out at the end.
  const debris = state.debris.length ? teamSprite(assets, 'vfx.debris', 'player') : null;
  for (const d of state.debris) {
    const sprite = d.team === 'player' ? debris! : teamSprite(assets, 'vfx.debris', d.team);
    const frame = d.piece % sprite.frames.length;
    const fade = clamp((d.life - d.age) / (d.life * 0.4), 0, 1);
    r.drawSprite(sprite, d.x, d.y, d.angle, sprite.fps > 0 ? (frame + 0.5) / sprite.fps : 0, fade, false, d.scale);
  }

  for (const e of state.effects) {
    let { x, y } = e;
    // An effect tied to a point on an object (e.g. a missile's impact point) appears there.
    if (e.at) {
      const at = tierArt(assets, e.at.sprite, e.at.tier);
      const p = extras.layouts.objects[at.name]?.points?.[e.at.point];
      if (p) ({ x, y } = shipPointToWorld(p.x * at.scale, p.y * at.scale, e.x, e.y, e.at.angle));
    }
    const fx = tierSpriteScaled(assets, e.sprite, e.tier);
    r.drawSprite(fx.sprite, x, y, e.angle, e.age, 1, false, e.scale * fx.scale);
  }

  // Arrows at the screen edge pointing to things you can't see.
  const wreckArrow = assets.get('ui.arrow.wreck');
  for (const w of state.wrecks) drawEdgeArrow(r, wreckArrow, w.x, w.y, state.time);
  const enemyArrow = assets.get('ui.arrow.enemy');
  const eliteArrow = assets.get('ui.arrow.elite');
  for (const s of state.ships) if (s.team === 'enemy') drawEdgeArrow(r, s.elite ? eliteArrow : enemyArrow, s.x, s.y, state.time);
  // Loot: a dot in its rarity's colour, on a ring further in than the arrows (a clear gap past the
  // biggest arrow), so they never overlap. A quality-of-life drop's dot pulses gently, so it's noticed.
  const E = CONFIG.edgeMarkers;
  const k = Math.max(1, r.worldScale);
  const biggestArrow = Math.max(wreckArrow.frames[0].w, enemyArrow.frames[0].w, eliteArrow.frames[0].w);
  const pulse = 0.6 + 0.4 * Math.sin(state.time * 4);
  for (const l of state.loot) {
    const dot = assets.get(`ui.dot.loot.${l.item ? l.item.rarity : 'merge-module'}`);
    const inset = E.arrowInset + (biggestArrow * k) / 2 + E.lootDotGap + (dot.frames[0].w * k) / 2;
    drawEdgeArrow(r, dot, l.x, l.y, state.time, l.qol ? pulse : 1, inset, false);
  }
}

/** What the newer skills left in the world (see moreSkills.ts), each drawn from its own art. */
function drawSkillObjects(state: GameState, r: PixelRenderer, assets: Assets, extras: ArtExtras) {
  for (const o of state.skillObjs) {
    switch (o.kind) {
      case 'crescent': {
        // Spins as it flies; fades out at the very end.
        const spin = o.age * CONFIG.crescent.spin * Math.PI * 2;
        const alpha = clamp((o.life - o.age) / 0.15, 0, 1);
        r.drawSprite(assets.get('vfx.crescent'), o.x, o.y, spin, o.age, alpha, false, o.scale);
        break;
      }
      case 'ionBall': {
        // Flickers faster just before it blows up.
        const left = o.life - o.age;
        const alpha = left < 0.25 && Math.floor(left * 30) % 2 === 0 ? 0.5 : 1;
        r.drawSprite(teamSprite(assets, 'vfx.ion-ball', o.team), o.x, o.y, 0, state.time + o.angle, alpha, false, o.scale);
        break;
      }
      case 'arcBolt': {
        const fx = o.fromX ?? o.x;
        const fy = o.fromY ?? o.y;
        const length = Math.hypot(o.x - fx, o.y - fy);
        drawBeam(r, teamSprite(assets, 'vfx.arc', o.team), fx, fy, Math.atan2(o.y - fy, o.x - fx), length, o.scale, o.age);
        break;
      }
      case 'lance': {
        // An elite's lance flickers thin and faint while it's only a warning.
        const warn = o.age < (o.warning ?? 0);
        if (warn && Math.floor(o.age * 16) % 2) break;
        drawBeam(r, teamSprite(assets, 'vfx.plasma-lance', o.team), o.x, o.y, o.angle, o.length ?? 0, warn ? o.scale * 0.3 : o.scale, state.time);
        break;
      }
      case 'splitBeam': {
        // A short streak behind the beam's tip.
        const len = Math.min(CONFIG.splitBeam.streak * o.scale, o.age * CONFIG.splitBeam.speed);
        drawBeam(r, teamSprite(assets, 'vfx.split-beam', o.team), o.x - Math.cos(o.angle) * len, o.y - Math.sin(o.angle) * len, o.angle, len, o.scale, state.time);
        break;
      }
      case 'pod': {
        // Fades out over its last 0.3 s.
        const alpha = clamp((o.life - o.age) / 0.3, 0, 1);
        r.drawSprite(teamSprite(assets, 'vfx.pod', o.team), o.x, o.y, o.angle, state.time, alpha, false, o.scale);
        break;
      }
      case 'well': {
        // The swirl is drawn to the well's radius, fading in and out.
        const sprite = teamSprite(assets, 'vfx.gravity-well', o.team);
        const alpha = clamp(Math.min(o.age, o.life - o.age) / 0.25, 0, 1) * CONFIG.gravityWell.alpha;
        r.drawSprite(sprite, o.x, o.y, o.age * 2, state.time, alpha, false, o.radius / (sprite.frames[0].w / 2));
        break;
      }
      case 'scrambleWave': {
        const alpha = clamp((o.life - o.age) / 0.2, 0, 1);
        r.drawSprite(teamSprite(assets, 'vfx.scramble-wave', o.team), o.x, o.y, o.angle, state.time, alpha, false, o.scale);
        break;
      }
      case 'thrown': {
        // The tractor beam holds it while it speeds up; then the wreck flies on its own.
        const ship = o.owner;
        if (ship && !ship.dead && o.age < CONFIG.tractorBeam.beamTime) {
          const len = Math.hypot(o.x - ship.x, o.y - ship.y);
          drawBeam(r, teamSprite(assets, 'vfx.tractor-beam', o.team), ship.x, ship.y, Math.atan2(o.y - ship.y, o.x - ship.x), len, o.scale, state.time);
        }
        const w = o.wreck;
        if (w) {
          const { name, scale } = tierArt(assets, SHIP_TYPES[w.type].sprites.ship, w.tier, '.wreck', false);
          drawLayoutArt(r, assets, extras.layouts.objects[name], name, o.x, o.y, w.angle, 'drifting', null, state.time, 1, true, scale);
        }
        break;
      }
      case 'scrap': {
        // An elite's scrap charge: a flickering ring where it will blow up.
        const sprite = teamSprite(assets, 'vfx.wreck-radius', o.team);
        if (Math.floor(o.age * 10) % 2 === 0) r.drawSprite(sprite, o.x, o.y, 0, 0, 1, false, o.radius / (sprite.frames[0].w / 2));
        break;
      }
      case 'wall': {
        // One shimmering segment image repeated along each stretch of the wall; it fades in its last half second.
        const pts = o.points ?? [];
        const alpha = clamp((o.life - o.age) / 0.5, 0, 1);
        const seg = teamSprite(assets, 'vfx.force-wall', o.team);
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          r.drawSprite(seg, (a.x + b.x) / 2, (a.y + b.y) / 2, angle, state.time + i * 0.07, alpha, false, Math.max(o.scale, Math.hypot(b.x - a.x, b.y - a.y) / seg.frames[0].w));
        }
        break;
      }
      case 'hijackPulse': {
        const sprite = teamSprite(assets, 'vfx.hijack-pulse', o.team);
        r.drawSprite(sprite, o.x, o.y, 0, o.age, 1 - o.age / o.life, false, Math.max(0.05, o.radius / (sprite.frames[0].w / 2)));
        break;
      }
    }
  }
}

/** A beam: one short segment image repeated along its length, scaled by `width`. */
export function drawBeam(r: PixelRenderer, seg: Sprite, x: number, y: number, angle: number, length: number, width: number, time: number, alpha = 1) {
  const step = seg.frames[0].w * width;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Only the part on screen (beams can reach far past it).
  const v = r.view;
  const pad = step + seg.frames[0].h * width;
  let lo = 0;
  let hi = length;
  for (const [p, d, min, max] of [
    [x, dx, v.x - pad, v.x + v.w + pad],
    [y, dy, v.y - pad, v.y + v.h + pad],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (p < min || p > max) return;
      continue;
    }
    const t1 = (min - p) / d;
    const t2 = (max - p) / d;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
  }
  if (hi <= lo) return;
  const first = Math.max(0, Math.floor(lo / step));
  const last = Math.min(Math.ceil(length / step), Math.ceil(hi / step));
  for (let i = first; i < last; i++) r.drawSprite(seg, x + dx * (i + 0.5) * step, y + dy * (i + 0.5) * step, angle, time, alpha, false, width);
}

/** Draws one ship, plus a small health bar under it if it's damaged. */
function drawShip(r: PixelRenderer, assets: Assets, layouts: ArtLayoutsFile, s: Ship, time: number, symbol: boolean) {
  if (s.absorbed) return; // already inside the ship it's merging into
  if (s.leviathan) return drawLeviathan(r, assets, s.leviathan, s.x, s.y, s.angle, time);
  // Commander view (and ships too small after detail steps): a HUD symbol by tier, fixed size on screen.
  if (symbol) {
    r.drawSprite(symbolSprite(assets, shipArtBase(s), s.tier), s.x, s.y, 0, time, 1, true);
    if (s.hijackedFrom) r.drawSprite(teamSprite(assets, 'ui.hijack-heart', s.team), s.x, s.y - CONFIG.hijack.heartGap / r.worldScale - 6 / r.worldScale, 0, time, 1, true);
    return;
  }
  // Dash trail behind the ship, pointing back along its movement. Plays once per dash.
  if (s.fleet.dashTime > 0 && !isMergePart(s)) {
    const d = tierArt(assets, 'vfx.dash', s.tier);
    const trail = teamSprite(assets, d.name, s.team);
    r.drawSprite(trail, s.x, s.y, Math.atan2(s.vy, s.vx), CONFIG.dash.duration - s.fleet.dashTime, 1, false, d.scale);
  }
  const { name: base, scale } = tierArt(assets, shipArtBase(s), s.tier, '', false);
  // Ships flying into a merge fade out as they reach the core.
  let alpha = 1;
  if (s.merge && isMergePart(s)) {
    const core = s.merge.core;
    alpha = clamp(Math.hypot(core.x - s.x, core.y - s.y) / (core.stats.radius * 2), 0.3, 1);
  }
  const layout = layouts.ships[base];
  if (s.ghost) {
    // Cloaked: the stars behind show through it, slightly shifted, like glass; the ship itself is faint
    // (yours so you can still follow them, an elite's so it stays fair).
    const file = layout?.base[s.thrust] ?? layout?.base.idle;
    r.drawRefracted(assets.get(file ? fileSprite(file) : base), s.x, s.y, s.angle, time, CONFIG.cloak.refraction, scale);
    alpha *= s.team === 'player' ? CONFIG.cloak.ownAlpha : CONFIG.elite.cloakAlpha;
  }
  // A hijacked ship flickers in its last second before it switches back.
  if (s.hijacked > 0 && s.hijacked < 1 && Math.floor(s.hijacked * 10) % 2) alpha *= 0.4;
  drawLayoutArt(r, assets, layout, base, s.x, s.y, s.angle, s.thrust, null, time, alpha, true, scale);
  // Gun images (turrets) on top, turned to where each gun points.
  gunsOf(s).forEach((g, i) => {
    if (g.image) r.drawAttached(assets.get(fileSprite(g.image)), s.x, s.y, s.angle, g.x, g.y, s.gunAim[i] ?? g.angle, time, alpha);
  });
  // A hijacked ship keeps its old side's art, so a heart above it shows who it fights for
  // (in that side's colour; kept the same size on screen at any zoom).
  if (s.hijackedFrom) {
    const heart = teamSprite(assets, 'ui.hijack-heart', s.team);
    r.drawSprite(heart, s.x, s.y - s.stats.radius - CONFIG.hijack.heartGap / r.worldScale, 0, time, alpha, true);
  }
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
 * A Leviathan: the head at the bottom, then each segment on top of the one before, so the tail
 * is on top. Its art faces up (the game's art faces right), so every piece turns a quarter more.
 * The side-view head shows while it turns (mirrored for the other direction).
 */
export function drawLeviathan(r: PixelRenderer, assets: Assets, body: LeviathanBody, x: number, y: number, angle: number, time: number) {
  for (const p of body.pieces) {
    const { sprite, mirror } = leviathanPieceArt(assets, body, p.kind);
    if (p.kind === 'head') r.drawAttached(sprite, x, y, angle, 0, 0, Math.PI / 2, time, 1, p.scale, mirror);
    else r.drawAttached(sprite, p.x, p.y, p.angle, 0, 0, Math.PI / 2, time, 1, p.scale);
  }
}

/** The image a Leviathan piece shows now (the head: top or side view), and whether it's mirrored. */
export function leviathanPieceArt(assets: Assets, body: LeviathanBody, kind: PieceKind) {
  if (kind !== 'head' || body.view === 0) return { sprite: assets.get(PIECE_SPRITES[kind]), mirror: false };
  return { sprite: assets.get(SIDE_HEAD_SPRITE), mirror: (body.view === 1) !== body.layout.sideViewForRightTurns };
}

/**
 * Draws a ship's or object's art: its base image for this state (from its
 * layout in art.json, or the manifest sprite `base`), with its mounts
 * (thrusters, flames...) under or over it. Used by the game and ShipArt.
 */
export function drawLayoutArt(
  r: PixelRenderer,
  assets: Assets,
  layout: ArtLayout | undefined,
  base: string,
  x: number,
  y: number,
  angle: number,
  state: string,
  /** Recolour its team-colour parts for this team; null = its own colours (ships). */
  team: Team | null,
  time: number,
  alpha = 1,
  /** false = only the mounts (e.g. a laser, whose beam is drawn separately). */
  drawBase = true,
  /** Draw it this much bigger, mounts included (a tier using a smaller tier's art, see tierArt). */
  scale = 1,
) {
  const baseFile = layout?.base[state] ?? layout?.base.idle;
  const mounts = layout?.mounts ?? [];
  let baseSprite = teamSprite(assets, baseFile ? fileSprite(baseFile) : base, team);
  // A hand-drawn small version for the detail steps ("ship.fighter.t7.d1" = one step smaller),
  // used instead of the automatic shrunk copy (normal image only, not a per-state one).
  let baseScale = scale;
  const small = `${base}.d${detailSteps}`;
  if (detailSteps > 0 && !baseFile && assets.has(small)) {
    baseSprite = teamSprite(assets, small, team);
    baseScale = scale * CONFIG.tiers.sizePerTier ** detailSteps;
  }
  // Art too big for RotSprite is drawn as in Grid, mounts too, so they stay put on it.
  const mode = r.rotation;
  if (mode === 'rotsprite' && !r.rotSpriteFits(baseSprite)) r.rotation = 'grid';
  const drawMounts = (behind: boolean) => {
    for (const m of mounts) {
      const file = m.images[state];
      if (!file || m.behind !== behind) continue;
      const sprite = teamSprite(assets, fileSprite(file), team);
      r.drawAttached(sprite, x, y, angle, m.x * scale, m.y * scale, (m.angle * Math.PI) / 180, time, alpha, m.scale * scale, m.flipX, m.flipY);
    }
  };
  try {
    drawMounts(true);
    if (drawBase) r.drawRotated(baseSprite, x, y, angle, time, alpha, baseScale);
    drawMounts(false);
  } finally {
    r.rotation = mode;
  }
}

/**
 * If (x, y) is off-screen, draw `sprite` near the screen edge (its middle `insetPx` screen pixels in),
 * in the direction of (x, y); `rotate` turns it to point there (arrows; dots don't turn).
 */
function drawEdgeArrow(r: PixelRenderer, sprite: Sprite, x: number, y: number, time: number, alpha = 1, insetPx = CONFIG.edgeMarkers.arrowInset, rotate = true) {
  const v = r.view;
  if (x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h) return;
  // Inset in game pixels, so the marker stays on screen at any zoom.
  const inset = insetPx / r.worldScale;
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  const dx = x - cx;
  const dy = y - cy;
  // Shrink the direction until it touches the (slightly inset) screen edge.
  const k = Math.min((v.w / 2 - inset) / Math.abs(dx || 1e-6), (v.h / 2 - inset) / Math.abs(dy || 1e-6));
  r.drawSprite(sprite, cx + dx * k, cy + dy * k, rotate ? Math.atan2(dy, dx) : 0, time, alpha, true);
}

/** The animation time that shows a meter sprite's frame for `fraction` (0 = first frame, 1 = last). */
function meterTime(sprite: Sprite, fraction: number) {
  if (sprite.fps <= 0) return 0;
  const last = sprite.frames.length - 1;
  return (Math.round(fraction * last) + 0.5) / sprite.fps;
}
