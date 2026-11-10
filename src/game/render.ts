// Draws the game state. Every picture comes from the asset manifest by name.

import type { Assets } from '../engine/assets';
import type { PixelRenderer } from '../engine/renderer';
import { SHIP_TYPES, CONFIG } from './config';
import { controlledShip, typeOf, type GameState } from './world';

export function renderGame(state: GameState, r: PixelRenderer, assets: Assets) {
  r.drawTiled(assets.get('bg.stars-far'), 0.3);
  r.drawTiled(assets.get('bg.stars-near'), 0.6);

  for (const w of state.wrecks) {
    // Blink when about to disappear.
    const blinking = w.life < CONFIG.wreckBlinkTime && Math.floor(w.life * 6) % 2 === 0;
    r.drawSprite(assets.get(SHIP_TYPES[w.type].sprites.wreck), w.x, w.y, w.angle, state.time, blinking ? 0.35 : 1);
  }

  const flagship = controlledShip(state);
  if (flagship) r.drawSprite(assets.get('ui.command-ring'), flagship.x, flagship.y, 0, state.time);

  for (const s of state.ships) {
    const t = typeOf(s);
    r.drawSprite(assets.get(t.sprites[s.team]), s.x, s.y, s.angle, state.time);
    // Small health bar under damaged ships.
    if (s.hp < t.maxHp) {
      const w = 16;
      const x = s.x - w / 2;
      const y = s.y + t.radius + 4;
      r.fillRect(x, y, w, 1, '#000000');
      r.fillRect(x, y, Math.max(1, Math.round((w * s.hp) / t.maxHp)), 1, s.team === 'player' ? '#7fe07f' : '#ff6b5a');
    }
  }

  for (const b of state.bullets) r.drawSprite(assets.get(b.sprite), b.x, b.y, Math.atan2(b.vy, b.vx), state.time);

  for (const e of state.effects) r.drawSprite(assets.get(e.sprite), e.x, e.y, e.angle, e.age);
}
