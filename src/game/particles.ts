// Particles: small visual-only dots (e.g. from thrusters, or a missile's
// trail). They don't affect the game, so they live with the drawing code, not
// in world.ts. Each kind's look is a sprite in the manifest (a short flipbook,
// e.g. a dot shrinking away); amounts and speeds are set per emitter in
// ShipArt (art.json). CONFIG.particles.max caps how many exist at once.

import type { PixelRenderer } from '../engine/renderer';
import type { Assets } from '../engine/assets';
import { randRange } from '../engine/math';
import { CONFIG } from './config';
import { mountWorldAngle, particleSettings, shipPointToWorld, type ArtLayout, type ArtLayoutsFile, type ParticleSettings } from './artLayout';

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

  /**
   * Spawn about kind.perSecond × dt particles at (x, y), flying toward `angle` (radians), spread over the kind's cone.
   * The emitter moved at (vx, vy) during this step: the particles are born at evenly spaced moments within the
   * step, each where the emitter was then and already aged a little. A fast emitter (a missile) leaves an evenly
   * spaced trail, and a higher spawn rate packs it tighter.
   */
  emit(kind: ParticleSettings, x: number, y: number, angle: number, dt: number, vx = 0, vy = 0) {
    const n = kind.perSecond * dt;
    // Whole particles, plus a chance for the fraction, so low rates still produce the right amount over time.
    const count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      if (this.list.length >= CONFIG.particles.max) return;
      // Anywhere in a cone kind.angle degrees wide, centred on `angle` (360 = any direction).
      const a = angle + ((randRange(-0.5, 0.5) * Math.min(360, kind.angle)) / 180) * Math.PI;
      const speed = kind.speed * randRange(0.7, 1.3);
      // Evenly spaced through the step (the first one born latest, nearest the emitter).
      const back = ((i + 0.5) / count) * dt;
      const pvx = Math.cos(a) * speed;
      const pvy = Math.sin(a) * speed;
      this.list.push({
        sprite: kind.sprite,
        x: x - vx * back + pvx * back,
        y: y - vy * back + pvy * back,
        vx: pvx,
        vy: pvy,
        age: back,
        life: kind.life * randRange(0.8, 1.2),
        drag: kind.drag,
      });
    }
  }

  /**
   * About perSecond × dt particles born at random points within `radius` of (x, y), each flying straight
   * in to the centre, arriving as its life ends (a charging effect: sparks rushing into a ball).
   */
  emitInward(sprite: string, x: number, y: number, radius: number, perSecond: number, life: number, dt: number) {
    const n = perSecond * dt;
    const count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    for (let i = 0; i < count && this.list.length < CONFIG.particles.max; i++) {
      const a = Math.random() * Math.PI * 2;
      // sqrt spreads them evenly over the circle's area (not bunched in the middle).
      const d = radius * Math.sqrt(Math.random());
      const l = life * randRange(0.8, 1.2);
      this.list.push({ sprite, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: (-Math.cos(a) * d) / l, vy: (-Math.sin(a) * d) / l, age: 0, life: l, drag: 0 });
    }
  }

  /**
   * Particles from a ship's or object's mounts: every mount that gives off
   * particles in this state does so from its VFX point, out the back of the mount.
   * (vx, vy) is how fast the ship or object is moving (spreads the particles along its path).
   */
  /** `scale`: the art is drawn this much bigger (see tierArt), so the mounts sit further out. */
  emitMounts(
    data: ArtLayoutsFile,
    layout: ArtLayout | undefined,
    state: string,
    x: number,
    y: number,
    angle: number,
    dt: number,
    vx = 0,
    vy = 0,
    scale = 1,
    /** Where a point of the art sits now (a banking ship's tilted hull: render.ts shipVolume); missing = where it's drawn flat. */
    spot?: (x: number, y: number) => { x: number; y: number },
  ) {
    if (!layout) return;
    for (const m of layout.mounts) {
      if (!m.emit?.[state]) continue;
      const at = spot ? spot(m.x + m.vfxX, m.y + m.vfxY) : { x: m.x + m.vfxX, y: m.y + m.vfxY };
      const p = shipPointToWorld(at.x * scale, at.y * scale, x, y, angle);
      this.emit(particleSettings(data, m, state), p.x, p.y, mountWorldAngle(m, angle) + Math.PI, dt, vx, vy);
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
