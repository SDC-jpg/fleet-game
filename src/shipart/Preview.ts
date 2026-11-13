// The ShipArt preview: draws one ship or object with the game's own drawing
// code (so it looks exactly like the game), plays one of its states with
// particles and effects, and lets you drag mounts, their VFX points and named
// points (like a missile's impact point) with the mouse. Guides (outlines and
// handles) are drawn on a second canvas on top.

import type { Assets } from '../engine/assets';
import { PixelRenderer, type RotationMode } from '../engine/renderer';
import { CONFIG, SHIP_TYPES } from '../game/config';
import { Particles } from '../game/particles';
import { drawLayoutArt, tierSprite } from '../game/render';
import { fileSprite, shipPointToWorld, worldToShipPoint, type ArtLayout, type ArtLayoutsFile, type Mount } from '../game/artLayout';
import { tierOf, type ArtKind } from '../game/artKinds';
import type { Team } from '../game/world';

export interface PreviewSettings {
  data: ArtLayoutsFile;
  /** The sprite being shown ("ship.fighter.t2", "projectile.missile"...) and its kind. */
  subject: string;
  kind: ArtKind;
  /** One of the kind's preview states. */
  state: string;
  /** An effect sprite to show on its own (Effects section), instead of the subject. */
  effect: string | null;
  zoom: number;
  spin: boolean;
  fly: boolean;
  team: Team;
  guides: boolean;
  /** false = plain black background instead of stars. */
  stars: boolean;
  /** How rotated sprites are drawn (see renderer.ts). */
  rotation: RotationMode;
  /** The selected mount (index), or point (name). */
  selected: number | null;
  selectedPoint: string | null;
  readOnly: boolean;
}

/** What the mouse is dragging. */
type Drag = { kind: 'mount' | 'vfx' | 'point'; index: number; point?: string; grabX: number; grabY: number };

export interface PreviewEvents {
  /** A mount was clicked (null = empty space). */
  select: (index: number | null) => void;
  /** A point was clicked. */
  selectPoint: (id: string) => void;
  /** A drag is starting (save an undo step). */
  dragStart: () => void;
  /** A mount moved to (x, y), its VFX point to offset (x, y), or a point to (x, y), in the subject's pixels. */
  moveMount: (index: number, x: number, y: number) => void;
  moveVfx: (index: number, x: number, y: number) => void;
  movePoint: (id: string, x: number, y: number) => void;
  /** Mouse position on the subject, in its pixels (null = off the canvas). */
  hover: (p: { x: number; y: number } | null) => void;
}

/** Missile Sequence preview timing (seconds): fire up, reach top speed, burst, start over. */
const SEQ = { ignite: 0.25, impact: 1.25, restart: 2.1 };

export class Preview {
  private renderer: PixelRenderer;
  private overlay: HTMLCanvasElement;
  private particles = new Particles();
  private handle = 0;
  private last = performance.now();
  private time = 0;
  /** Seconds into the current state (restarts when the state changes). */
  private stateTime = 0;
  private lastState = '';
  private x = 0;
  private y = 0;
  private angle = 0;
  private drag: Drag | null = null;
  private assets: Assets;
  private events: PreviewEvents;
  settings: PreviewSettings;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, assets: Assets, settings: PreviewSettings, events: PreviewEvents) {
    this.assets = assets;
    this.events = events;
    this.renderer = new PixelRenderer(canvas, true);
    this.overlay = overlay;
    this.settings = settings;
    overlay.addEventListener('mousedown', this.onDown);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
    window.addEventListener('resize', this.onResize);
    this.onResize();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      this.handle = requestAnimationFrame(tick);
    };
    this.handle = requestAnimationFrame(tick);
  }

  destroy() {
    cancelAnimationFrame(this.handle);
    this.overlay.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('resize', this.onResize);
  }

  /** Put the subject back in the middle, facing right (e.g. when switching subjects or turning off spin and fly). */
  resetPosition() {
    this.x = this.y = this.angle = 0;
    this.stateTime = 0;
    this.particles.clear();
  }

  private onResize = () => {
    this.renderer.resize();
    const box = this.overlay.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    this.overlay.width = box.clientWidth * dpr;
    this.overlay.height = box.clientHeight * dpr;
  };

  private get layout(): ArtLayout | undefined {
    const st = this.settings;
    return st.data[st.kind.section][st.subject];
  }

  /** The state mounts and particles use right now (the Sequence preview moves through several). */
  private mountState() {
    const st = this.settings;
    if (st.kind.id === 'missile' && st.state === 'sequence') return this.stateTime < SEQ.ignite ? 'inert' : 'fired';
    return st.kind.states.find((s) => s.id === st.state)?.uses ?? st.state;
  }

  /** How fast the subject flies forward now (game speeds, so particles trail like in the game). */
  private speed() {
    const st = this.settings;
    if (st.kind.id === 'missile') {
      const M = CONFIG.missiles;
      if (st.state === 'sequence') {
        const t = this.stateTime;
        if (t < SEQ.ignite) return M.ejectSpeed;
        if (t >= SEQ.impact) return 0;
        return M.ejectSpeed + (M.speed - M.ejectSpeed) * Math.min(1, (t - SEQ.ignite) / M.rampTime);
      }
      if (!st.fly || st.state === 'impact') return 0;
      return st.state === 'inert' ? M.ejectSpeed : M.speed;
    }
    const t = SHIP_TYPES.fighter;
    if (!st.fly || st.state === 'idle') return 0;
    if (st.state === 'boost') return t.maxSpeed * t.boostMultiplier;
    if (st.state === 'dash') return t.maxSpeed * 3;
    return t.maxSpeed;
  }

  private frame(dt: number) {
    const st = this.settings;
    const r = this.renderer;
    this.time += dt;
    if (st.state !== this.lastState) {
      this.lastState = st.state;
      this.stateTime = 0;
    }
    this.stateTime += dt;
    // The missile sequence starts over (back in the middle) once its burst has played.
    const sequence = st.kind.id === 'missile' && st.state === 'sequence';
    if (sequence && this.stateTime >= SEQ.restart) {
      this.stateTime = 0;
      this.x = this.y = 0;
      this.particles.clear();
    }
    if (st.spin && !sequence) this.angle += dt * 0.6;
    const v = this.speed();
    this.x += Math.cos(this.angle) * v * dt;
    this.y += Math.sin(this.angle) * v * dt;
    // The camera stays on the subject; when it flies, the stars scroll past.
    r.camX = this.x;
    r.camY = this.y;
    r.setZoom(st.zoom, true);
    r.rotation = st.rotation;
    r.begin(dt);
    // The screen behind is black, so leaving the stars out gives a plain black background.
    if (st.stars) {
      r.drawTiled(this.assets.get('bg.stars-far'), 0.3);
      r.drawTiled(this.assets.get('bg.stars-near'), 0.6);
    }

    if (st.effect) {
      this.drawEffect(st.effect);
      r.end();
      this.drawGuides();
      return;
    }

    const state = this.mountState();
    const tier = tierOf(st.subject);
    const hidden = sequence && this.stateTime >= SEQ.impact;
    this.particles.update(dt);
    if (!hidden && !(st.kind.id === 'missile' && st.state === 'impact'))
      this.particles.emitMounts(st.data, this.layout, state, this.x, this.y, this.angle, dt);
    this.particles.draw(r, this.assets);
    if (st.state === 'dash') {
      // The dash trail replays every second.
      const trail = this.assets.getRecolored(tierSprite(this.assets, 'vfx.dash', tier), CONFIG.teamColors[st.team], CONFIG.teamColors);
      r.drawSprite(trail, this.x, this.y, this.angle, this.time % 1);
    }
    // Impact (and the end of the sequence): the burst at the impact point. The missile shows faintly in Impact, for placing it.
    const impact = st.kind.points.find((p) => p.id === 'impact');
    if (impact && (st.state === 'impact' || hidden)) {
      const p = this.layout?.points?.[impact.id] ?? { x: 0, y: 0 };
      const w = shipPointToWorld(p.x, p.y, this.x, this.y, this.angle);
      const age = st.state === 'impact' ? this.time % 1 : this.stateTime - SEQ.impact;
      r.drawSprite(this.assets.get(tierSprite(this.assets, impact.effect, tier)), w.x, w.y, 0, age);
    }
    if (!hidden) drawLayoutArt(r, this.assets, this.layout, st.subject, this.x, this.y, this.angle, state, st.team, this.time, st.state === 'impact' ? 0.35 : 1);
    r.end();
    this.drawGuides();
  }

  /**
   * An effect on its own, in the middle: looping effects play on and on;
   * play-once effects replay after a short pause.
   */
  private drawEffect(name: string) {
    const st = this.settings;
    const sprite = this.assets.getRecolored(name, CONFIG.teamColors[st.team], CONFIG.teamColors);
    const length = sprite.fps > 0 ? sprite.frames.length / sprite.fps : 1;
    const t = sprite.loop ? this.time : this.time % (length + 0.5);
    if (sprite.loop || t < length) this.renderer.drawSprite(sprite, this.x, this.y, this.angle, t);
  }

  /** The image a mount shows in this state, or (if hidden in this state) any of its images, for its outline. */
  private mountImage(m: Mount) {
    const file = m.images[this.mountState()] ?? Object.values(m.images).find((f) => f);
    return file ? this.assets.get(fileSprite(file)) : null;
  }

  /** The four corners of a mount's image (a small square for particle-only mounts), in the subject's pixels. */
  private mountCorners(m: Mount) {
    const sprite = this.mountImage(m);
    const w = sprite ? sprite.frames[0].w : 6;
    const h = sprite ? sprite.frames[0].h : 6;
    const ax = sprite ? sprite.anchorX : 3;
    const ay = sprite ? sprite.anchorY : 3;
    const a = (m.angle * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [
      [-ax, -ay],
      [w - ax, -ay],
      [w - ax, h - ay],
      [-ax, h - ay],
    ].map(([px, py]) => {
      const lx = px * m.scale * (m.flipX ? -1 : 1);
      const ly = py * m.scale * (m.flipY ? -1 : 1);
      return { x: m.x + lx * c - ly * s, y: m.y + lx * s + ly * c };
    });
  }

  private toScreen(p: { x: number; y: number }) {
    const w = shipPointToWorld(p.x, p.y, this.x, this.y, this.angle);
    return this.renderer.worldToScreen(w.x, w.y);
  }

  private drawGuides() {
    const ctx = this.overlay.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const st = this.settings;
    if (!st.guides) return;
    const layout = st.effect ? undefined : this.layout;
    // The subject's centre (its anchor): where positions are measured from.
    const o = this.toScreen({ x: 0, y: 0 });
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(o.x - 6, o.y);
    ctx.lineTo(o.x + 6, o.y);
    ctx.moveTo(o.x, o.y - 6);
    ctx.lineTo(o.x, o.y + 6);
    ctx.stroke();
    if (!layout) return;
    const state = this.mountState();
    layout.mounts.forEach((m, i) => {
      const selected = i === st.selected;
      const shown = !!m.images[state] || !!m.emit?.[state];
      const pts = this.mountCorners(m).map((p) => this.toScreen(p));
      ctx.setLineDash(shown ? [] : [4, 3]);
      ctx.strokeStyle = selected ? '#ffd34a' : shown ? 'rgba(159,211,255,0.55)' : 'rgba(159,211,255,0.35)';
      ctx.lineWidth = selected ? 2 : 1;
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      // VFX point: a small ring with a cross.
      const v = this.toScreen({ x: m.x + m.vfxX, y: m.y + m.vfxY });
      ctx.strokeStyle = selected ? '#ff7ad9' : 'rgba(255,122,217,0.5)';
      ctx.lineWidth = selected ? 2 : 1;
      ctx.beginPath();
      ctx.arc(v.x, v.y, 4, 0, Math.PI * 2);
      ctx.moveTo(v.x - 7, v.y);
      ctx.lineTo(v.x + 7, v.y);
      ctx.moveTo(v.x, v.y - 7);
      ctx.lineTo(v.x, v.y + 7);
      ctx.stroke();
    });
    // Named points (e.g. Impact): a yellow diamond with its name.
    for (const def of st.kind.points) {
      const p = layout.points?.[def.id] ?? { x: 0, y: 0 };
      const s = this.toScreen(p);
      const selected = st.selectedPoint === def.id;
      ctx.strokeStyle = selected ? '#ffd34a' : 'rgba(255,211,74,0.6)';
      ctx.lineWidth = selected ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 6);
      ctx.lineTo(s.x + 6, s.y);
      ctx.lineTo(s.x, s.y + 6);
      ctx.lineTo(s.x - 6, s.y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '10px monospace';
      ctx.fillText(def.label, s.x + 8, s.y - 6);
    }
  }

  /** Mouse position in the subject's pixels. */
  private shipPoint(e: MouseEvent) {
    const rect = this.overlay.getBoundingClientRect();
    const w = this.renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    return worldToShipPoint(w.x, w.y, this.x, this.y, this.angle);
  }

  /** Is point p inside mount m's image? */
  private insideMount(m: Mount, p: { x: number; y: number }) {
    const pts = this.mountCorners(m);
    // Inside a convex shape: on the same side of every edge.
    let sign = 0;
    for (let k = 0; k < 4; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % 4];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (cross === 0) continue;
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
    return true;
  }

  private onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const st = this.settings;
    const layout = this.layout;
    const p = this.shipPoint(e);
    if (!st.guides || st.effect) return this.events.select(null);
    const scale = this.renderer.worldToScreen(1, 0).x - this.renderer.worldToScreen(0, 0).x;
    const near = 6 / Math.max(scale, 0.01);
    // Named points first (small handles on top).
    for (const def of st.kind.points) {
      const pt = layout?.points?.[def.id] ?? { x: 0, y: 0 };
      if (Math.hypot(p.x - pt.x, p.y - pt.y) <= near) {
        this.events.selectPoint(def.id);
        if (!st.readOnly) this.startDrag({ kind: 'point', index: -1, point: def.id, grabX: p.x - pt.x, grabY: p.y - pt.y });
        return;
      }
    }
    if (!layout) return this.events.select(null);
    // Then the selected mount's VFX point. Other mounts' points can't be grabbed,
    // so clicking a mount's middle picks the mount.
    const sel = st.selected !== null ? layout.mounts[st.selected] : undefined;
    if (sel && Math.hypot(p.x - (sel.x + sel.vfxX), p.y - (sel.y + sel.vfxY)) <= near) {
      if (!st.readOnly) this.startDrag({ kind: 'vfx', index: st.selected!, grabX: p.x - sel.vfxX, grabY: p.y - sel.vfxY });
      return;
    }
    // Then mount images, topmost (last drawn) first.
    for (let i = layout.mounts.length - 1; i >= 0; i--) {
      const m = layout.mounts[i];
      if (this.insideMount(m, p)) {
        this.events.select(i);
        if (!st.readOnly) this.startDrag({ kind: 'mount', index: i, grabX: p.x - m.x, grabY: p.y - m.y });
        return;
      }
    }
    this.events.select(null);
  };

  private startDrag(d: Drag) {
    this.events.dragStart();
    this.drag = d;
  }

  private onMove = (e: MouseEvent) => {
    const rect = this.overlay.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    const p = this.shipPoint(e);
    this.events.hover(inside ? { x: Math.round(p.x), y: Math.round(p.y) } : null);
    if (!this.drag) return;
    // Whole pixels only, so pixel art lines up.
    const x = Math.round(p.x - this.drag.grabX);
    const y = Math.round(p.y - this.drag.grabY);
    if (this.drag.kind === 'mount') this.events.moveMount(this.drag.index, x, y);
    else if (this.drag.kind === 'vfx') this.events.moveVfx(this.drag.index, x, y);
    else this.events.movePoint(this.drag.point!, x, y);
  };

  private onUp = () => {
    this.drag = null;
  };
}
