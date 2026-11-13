// The ShipArt preview: draws one ship with the game's own drawing code (so it
// looks exactly like the game), plays a state (idle, move, boost, dash) with
// particles, and lets you drag mounts and their VFX points with the mouse.
// Guides (outlines and points) are drawn on a second canvas on top.

import type { Assets } from '../engine/assets';
import { PixelRenderer } from '../engine/renderer';
import { CONFIG, SHIP_TYPES } from '../game/config';
import { Particles } from '../game/particles';
import { drawShipArt, tierSprite } from '../game/render';
import {
  fileSprite,
  shipPointToWorld,
  worldToShipPoint,
  type Mount,
  type ShipLayoutsFile,
  type ShipState,
} from '../game/shipLayout';
import type { Team } from '../game/world';

/** What the preview shows: the game's ship states, plus dash (thrusters as when moving, with the dash trail). */
export type PreviewState = ShipState | 'dash';

export interface PreviewSettings {
  data: ShipLayoutsFile;
  ship: string;
  state: PreviewState;
  zoom: number;
  spin: boolean;
  fly: boolean;
  team: Team;
  guides: boolean;
  selected: number | null;
  readOnly: boolean;
}

/** What the mouse is dragging. */
type Drag = { kind: 'mount' | 'vfx'; index: number; grabX: number; grabY: number };

export interface PreviewEvents {
  /** A mount was clicked (null = empty space). */
  select: (index: number | null) => void;
  /** A drag is starting (save an undo step). */
  dragStart: () => void;
  /** A mount moved to (x, y), or its VFX point to offset (x, y), in ship pixels. */
  moveMount: (index: number, x: number, y: number) => void;
  moveVfx: (index: number, x: number, y: number) => void;
  /** Mouse position on the ship, in ship pixels (null = off the canvas). */
  hover: (p: { x: number; y: number } | null) => void;
}

/** The mount state a preview state uses (dash doesn't change thrusters). */
export const mountState = (s: PreviewState): ShipState => (s === 'dash' ? 'move' : s);

export class Preview {
  private renderer: PixelRenderer;
  private overlay: HTMLCanvasElement;
  private particles = new Particles();
  private handle = 0;
  private last = performance.now();
  private time = 0;
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

  /** Put the ship back in the middle, facing right (e.g. when switching ships or turning off spin and fly). */
  resetPosition() {
    this.x = this.y = this.angle = 0;
    this.particles.clear();
  }

  private onResize = () => {
    this.renderer.resize();
    const box = this.overlay.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    this.overlay.width = box.clientWidth * dpr;
    this.overlay.height = box.clientHeight * dpr;
  };

  /** How fast the ship flies forward in each state (game speeds, so particles trail like in the game). */
  private speed() {
    const t = SHIP_TYPES.fighter;
    const s = this.settings.state;
    if (!this.settings.fly || s === 'idle') return 0;
    if (s === 'boost') return t.maxSpeed * t.boostMultiplier;
    if (s === 'dash') return t.maxSpeed * 3;
    return t.maxSpeed;
  }

  private frame(dt: number) {
    const st = this.settings;
    const r = this.renderer;
    this.time += dt;
    if (st.spin) this.angle += dt * 0.6;
    const v = this.speed();
    this.x += Math.cos(this.angle) * v * dt;
    this.y += Math.sin(this.angle) * v * dt;
    // The camera stays on the ship; when flying, the stars scroll past.
    r.camX = this.x;
    r.camY = this.y;
    r.setZoom(st.zoom, true);
    r.begin(dt);
    r.drawTiled(this.assets.get('bg.stars-far'), 0.3);
    r.drawTiled(this.assets.get('bg.stars-near'), 0.6);

    const state = mountState(st.state);
    this.particles.update(dt);
    this.particles.emitThrusters(st.data.ships[st.ship], state, this.x, this.y, this.angle, dt);
    this.particles.draw(r, this.assets);
    if (st.state === 'dash') {
      // The dash trail replays every second.
      const tier = Number(/\.t(\d+)$/.exec(st.ship)?.[1] ?? 1);
      const trail = this.assets.getRecolored(tierSprite(this.assets, 'vfx.dash', tier), CONFIG.teamColors[st.team], CONFIG.teamColors);
      r.drawSprite(trail, this.x, this.y, this.angle, this.time % 1);
    }
    drawShipArt(r, this.assets, st.data, st.ship, this.x, this.y, this.angle, state, st.team, this.time);
    r.end();
    this.drawGuides();
  }

  /** The image a mount shows in this state, or (if hidden in this state) any of its images, for its outline. */
  private mountImage(m: Mount) {
    const file = m.images[mountState(this.settings.state)] ?? Object.values(m.images).find((f) => f);
    return file ? this.assets.get(fileSprite(file)) : null;
  }

  /** The four corners of a mount's image, in ship pixels. */
  private mountCorners(m: Mount) {
    const sprite = this.mountImage(m);
    const w = sprite ? sprite.frames[0].w : 8;
    const h = sprite ? sprite.frames[0].h : 8;
    const ax = sprite ? sprite.anchorX : 4;
    const ay = sprite ? sprite.anchorY : 4;
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
    const layout = st.data.ships[st.ship];
    // The ship's centre (its anchor): where mount positions are measured from.
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
    const state = mountState(st.state);
    layout.mounts.forEach((m, i) => {
      const selected = i === st.selected;
      const shown = !!m.images[state];
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
  }

  /** Mouse position in ship pixels. */
  private shipPoint(e: MouseEvent) {
    const rect = this.overlay.getBoundingClientRect();
    const w = this.renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    return worldToShipPoint(w.x, w.y, this.x, this.y, this.angle);
  }

  /** Is ship point p inside mount m's image? */
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
    const layout = st.data.ships[st.ship];
    const p = this.shipPoint(e);
    if (!layout || !st.guides) return this.events.select(null);
    // The selected mount's VFX point first (it's small and sits on top). Other
    // mounts' points can't be grabbed, so clicking a mount's middle picks the mount.
    const scale = this.renderer.worldToScreen(1, 0).x - this.renderer.worldToScreen(0, 0).x;
    const near = 6 / Math.max(scale, 0.01);
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
    else this.events.moveVfx(this.drag.index, x, y);
  };

  private onUp = () => {
    this.drag = null;
  };
}
