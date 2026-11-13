// Particles: small visual-only dots (e.g. from thrusters). They don't affect
// the game, so they live with the drawing code, not in world.ts. Each kind's
// look is a sprite in the manifest (a short flipbook, e.g. a dot shrinking
// away); amounts and speeds are in CONFIG.particles.

import type { PixelRenderer } from '../engine/renderer';
import type { Assets } from '../engine/assets';
import { randRange } from '../engine/math';
import { CONFIG } from './config';
import { mountWorldAngle, particleSettings, shipPointToWorld, type ParticleSettings, type ShipLayout, type ShipState } from './shipLayout';

interface Particle {
  sprite: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  drag: number;
}

export class Particles {
  private list: Particle[] = [];

  /** Spawn about kind.perSecond × dt particles at (x, y), flying toward `angle` (radians), spread out a little. */
  emit(kind: ParticleSettings, x: number, y: number, angle: number, dt: number) {
    let n = kind.perSecond * dt;
    // Fractions become a chance, so low rates still produce the right amount over time.
    while (n > 0) {
      if (n < 1 && Math.random() >= n) break;
      n--;
      if (this.list.length >= CONFIG.particles.max) return;
      const a = angle + ((randRange(-1, 1) * kind.spread) / 180) * Math.PI;
      const speed = kind.speed * randRange(0.7, 1.3);
      this.list.push({
        sprite: kind.sprite,
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        age: 0,
        life: kind.life * randRange(0.8, 1.2),
        drag: kind.drag,
      });
    }
  }

  /**
   * Thruster particles for one ship: from the VFX point of every thruster mount
   * showing in this state, flying out the back of the thruster.
   */
  emitThrusters(layout: ShipLayout | undefined, state: ShipState, x: number, y: number, angle: number, dt: number) {
    if (!layout || state === 'idle') return;
    for (const m of layout.mounts) {
      if (m.category !== 'thruster' || !m.images[state]) continue;
      const p = shipPointToWorld(m.x + m.vfxX, m.y + m.vfxY, x, y, angle);
      this.emit(particleSettings(m, state), p.x, p.y, mountWorldAngle(m, angle) + Math.PI, dt);
    }
  }

  update(dt: number) {
    for (const p of this.list) {
      p.age += dt;
      // Drag slows particles down smoothly (the same at any frame rate).
      if (p.drag > 0) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.age < p.life);
  }

  /** Each particle plays its flipbook stretched over its life (so it ends on the last frame). */
  draw(r: PixelRenderer, assets: Assets) {
    for (const p of this.list) {
      const sprite = assets.get(p.sprite);
      const frames = sprite.frames.length;
      const frame = Math.min(frames - 1, Math.floor((p.age / p.life) * frames));
      r.drawSprite(sprite, p.x, p.y, 0, sprite.fps > 0 ? (frame + 0.5) / sprite.fps : 0);
    }
  }

  clear() {
    this.list = [];
  }
}
