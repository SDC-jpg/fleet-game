// The ShipArt preview: draws one ship or object with the game's own drawing
// code (so it looks exactly like the game), plays one of its states with
// particles and effects, and lets you drag mounts, their VFX points and named
// points (like a missile's impact point) with the mouse. Guides (outlines and
// handles) are drawn on a second canvas on top.

import { CrtFilter, type CrtParams } from '../engine/crt';
import { screenEffect } from '../game/screenEffect';
import type { Assets, Sprite } from '../engine/assets';
import { PixelRenderer, type RotationMode } from '../engine/renderer';
import { CONFIG, SHIP_TYPES } from '../game/config';
import { Particles } from '../game/particles';
import { drawBeam, drawLayoutArt, finGeometry, setDetailSteps, tierArt, tierSprite } from '../game/render';
import { fileSprite, shipPointToWorld, worldToShipPoint, type ArtLayout, type ArtLayoutsFile, type Mount } from '../game/artLayout';
import { tierOf, type ArtKind } from '../game/artKinds';
import { layoutGunsOrDefault } from '../game/guns';
import type { Team } from '../game/world';
import { LeviathanPreview, type BossHead } from './bossPreview';
import { bossPieceSprite, type BossPiece } from './LeviathanPanel';
import type { SoundScene } from './soundInfo';
import { drawDamage, type Damageable } from '../game/shipDamage';

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
  /** Detail steps to preview (0 = normal): drawn as the game does with that many (docs/DETAIL-STEPS.md). */
  detail: number;
  spin: boolean;
  fly: boolean;
  team: Team;
  guides: boolean;
  /** false = plain black background instead of stars. */
  stars: boolean;
  /** The game's screen effect (CRT) over the preview (its look comes from game/screenEffect.ts). */
  crt: boolean;
  /** How rotated sprites are drawn (see renderer.ts). */
  rotation: RotationMode;
  /** The selected mount (index), or point (name). */
  selected: number | null;
  selectedPoint: string | null;
  /** The selected gun (ships only). */
  selectedGun: number | null;
  /** The selected circle of the ship's hit shape, or null. */
  selectedHit: number | null;
  /** A boss to show instead of the subject (Bosses → Leviathan), its head view, picked piece, and "Lay straight" count. */
  boss: 'leviathan' | null;
  bossHead: BossHead;
  bossPiece: BossPiece | null;
  /** Which one of the body's pieces was picked (counted from the head; for bulges), or null. */
  bossIndex: number | null;
  /** The picked fin (its number in the layout's list), or null. */
  bossFin: number | null;
  bossStraight: number;
  /** Bumped by the Beam button. */
  bossBeam: number;
  /** Ships: the 3D tilt prototype (engine/tilt.ts): bank and pitch in degrees, light stepped to the palette, and Swing (rocks between ± those angles). */
  bank: number;
  pitch: number;
  tiltLight: boolean;
  swing: boolean;
  readOnly: boolean;
  /** Ships: damage marks (docs/SHIP-DAMAGE.md): its health (0–1), and Hit presses (bumped; `damageStrength` = that hit's damage ÷ max health). */
  damageHp: number;
  damageHit: number;
  damageStrength: number;
  /** A sound's scene to show instead (ShipArt → Sounds): `play` is bumped to play it once; `cue` starts the sound, `loop` sets a looping sound's level. */
  sound: SoundPreview | null;
}

/** A sound's scene in the preview (see PreviewSettings.sound). */
export interface SoundPreview {
  scene: SoundScene;
  tier: number;
  play: number;
  cue: () => void;
  loop: (level: number) => void;
}

/** What the mouse is dragging. */
type Drag = {
  kind: 'mount' | 'vfx' | 'point' | 'gun' | 'hit' | 'hitSize' | 'bossPivot' | 'bossHit' | 'finMove' | 'finTip';
  index: number;
  point?: string;
  grabX: number;
  grabY: number;
  /** Boss pivot drags: the piece, and its image's anchor when the drag started. */
  piece?: BossPiece;
  anchorX?: number;
  anchorY?: number;
};

export interface PreviewEvents {
  /** A mount was clicked (null = empty space). */
  select: (index: number | null) => void;
  /** A point was clicked. */
  selectPoint: (id: string) => void;
  /** A gun was clicked. */
  selectGun: (index: number) => void;
  /** A gun moved to (x, y), in the ship's pixels. */
  moveGun: (index: number, x: number, y: number) => void;
  /** A hit shape circle was clicked. */
  selectHit: (index: number) => void;
  /** A hit shape circle moved to (x, y), or was resized to radius r, in the ship's pixels. */
  moveHit: (index: number, x: number, y: number) => void;
  resizeHit: (index: number, r: number) => void;
  /** A drag is starting (save an undo step). */
  dragStart: () => void;
  /** A mount moved to (x, y), its VFX point to offset (x, y), or a point to (x, y), in the subject's pixels. */
  moveMount: (index: number, x: number, y: number) => void;
  moveVfx: (index: number, x: number, y: number) => void;
  movePoint: (id: string, x: number, y: number) => void;
  /** Mouse position on the subject, in its pixels (null = off the canvas). */
  hover: (p: { x: number; y: number } | null) => void;
  /** Boss: a piece was clicked (null = empty space), its pivot moved (its image's anchor), or its hit circle resized. */
  selectBossPiece: (p: BossPiece | null, index: number | null) => void;
  moveBossPivot: (p: BossPiece, x: number, y: number) => void;
  resizeBossHit: (p: BossPiece, r: number) => void;
  /** A fin was clicked (null = none), or dragged: moved to (x, y) on its piece, or turned / sized from its tip. */
  selectFin: (i: number | null) => void;
  moveFin: (i: number, x: number, y: number) => void;
  aimFin: (i: number, angle: number, scale: number) => void;
}

/** Missile Sequence preview timing (seconds): fire up, reach top speed, burst, start over. */
const SEQ = { ignite: 0.25, impact: 1.25, restart: 2.1 };

export class Preview {
  private renderer: PixelRenderer;
  private crt: CrtFilter;
  private unwatchCrt: () => void;
  private crtParams: () => CrtParams;
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
  private boss = new LeviathanPreview();
  /** The sound scene: which play it's showing, seconds into it, and whether its sound has started. */
  private soundPlay = 0;
  private soundT = Infinity;
  private soundCued = true;
  /** A pretend ship that carries the damage marks shown, and the last Hit press seen. */
  private dummy: Damageable = { hp: 1, stats: { maxHp: 1 }, hits: [] };
  private lastHit = 0;
  private assets: Assets;
  private events: PreviewEvents;
  settings: PreviewSettings;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, assets: Assets, settings: PreviewSettings, events: PreviewEvents) {
    this.assets = assets;
    this.events = events;
    this.renderer = new PixelRenderer(canvas, true);
    this.overlay = overlay;
    this.settings = settings;
    // The game's screen effect over the preview (toolbar: CRT). Here it always draws its own
    // stripes and dark corners, since there's no game HUD to cover.
    const mask = assets.get('ui.crt-mask').frames[0].image as HTMLImageElement;
    this.crt = new CrtFilter(canvas, mask);
    // On/off is ShipArt's own toolbar switch (settings.crt), not the game's.
    const params = () => ({ ...screenEffect.params, enabled: this.settings.crt, hud: false });
    this.renderer.crt = { filter: this.crt, params: params() };
    this.crtParams = params;
    this.unwatchCrt = screenEffect.subscribe(() => (this.renderer.crt!.params = params()));
    screenEffect.setDrawInfo(this.crt.supported, { url: '', width: this.crt.stripeWidth });
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
    this.unwatchCrt();
    this.crt.destroy();
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
    if (st.kind.id === 'shot') return st.fly && st.state === 'flying' ? SHIP_TYPES.fighter.bulletSpeed : 0;
    if (st.kind.id === 'wreck') return st.fly ? 15 : 0;
    if (st.kind.section === 'objects') return 0;
    const t = SHIP_TYPES.fighter;
    if (!st.fly || st.state === 'idle') return 0;
    if (st.state === 'boost') return t.maxSpeed * t.boostMultiplier;
    if (st.state === 'dash') return t.maxSpeed * 3;
    return t.maxSpeed;
  }

  private frame(dt: number) {
    const st = this.settings;
    const r = this.renderer;
    r.crt!.params = this.crtParams(); // the toolbar's CRT switch may have changed
    this.time += dt;
    if (st.state !== this.lastState) {
      this.lastState = st.state;
      this.stateTime = 0;
    }
    this.stateTime += dt;
    if (st.boss) return this.frameBoss(dt);
    if (st.sound) return this.frameSound(dt, st.sound);
    if (this.soundT !== Infinity) this.stopSound();
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
    // Detail steps: the subject drawn smaller with crisp smaller art, exactly as in the game.
    r.detailStep = CONFIG.tiers.sizePerTier;
    r.setDetail(CONFIG.tiers.sizePerTier ** -st.detail, true);
    setDetailSteps(st.detail);
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
    // Ships and wrecks are drawn in their own colours; other objects in the chosen team's.
    const team = st.kind.teamColored === false ? null : st.team;
    const hidden = sequence && this.stateTime >= SEQ.impact;
    // A state that shows a point's effect (Impact, Blast, Hit): the object faint, no particles.
    const pointId = st.kind.states.find((s) => s.id === st.state)?.point ?? (hidden ? 'impact' : undefined);
    this.particles.update(dt);
    if (!pointId) this.particles.emitMounts(st.data, this.layout, state, this.x, this.y, this.angle, dt, Math.cos(this.angle) * v, Math.sin(this.angle) * v);
    this.particles.draw(r, this.assets);
    // Wrecks sit on their marker ring, like in the game.
    if (st.kind.id === 'wreck') r.drawSprite(this.assets.get(tierSprite(this.assets, 'ui.wreck-marker', tier)), this.x, this.y, 0, this.time, 1, true);
    if (st.state === 'dash') {
      // The dash trail replays every second.
      const trail = this.assets.getRecolored(tierSprite(this.assets, 'vfx.dash', tier), CONFIG.teamColors[st.team], CONFIG.teamColors);
      r.drawSprite(trail, this.x, this.y, this.angle, this.time % 1);
    }
    // The point's effect, replaying (or once, at the end of the missile sequence).
    const def = pointId ? st.kind.points.find((p) => p.id === pointId) : undefined;
    if (def) {
      const p = this.layout?.points?.[def.id] ?? { x: 0, y: 0 };
      const w = shipPointToWorld(p.x, p.y, this.x, this.y, this.angle);
      const sprite = this.assets.get(tierSprite(this.assets, def.effect, tier));
      const length = sprite.fps > 0 ? sprite.frames.length / sprite.fps : 1;
      const age = hidden ? this.stateTime - SEQ.impact : this.time % (length + 0.4);
      if (age < length) r.drawSprite(sprite, w.x, w.y, 0, age);
    }
    if (st.kind.id === 'laser') this.drawLaser(state, tier, st.team);
    else if (!hidden) drawLayoutArt(r, this.assets, this.layout, st.subject, this.x, this.y, this.angle, state, team, this.time, pointId ? 0.35 : 1, true, 1, this.tilt(), this.damageDecor());
    // Gun images (turrets) on top, at rest.
    for (const g of this.guns())
      if (g.image && this.assets.has(fileSprite(g.image)))
        r.drawAttached(this.assets.get(fileSprite(g.image)), this.x, this.y, this.angle, g.x, g.y, (g.angle * Math.PI) / 180, this.time);
    r.end();
    this.drawGuides();
  }

  /** A boss swimming its figure eight (held still while a handle is dragged), centred in the view. */
  private frameBoss(dt: number) {
    const st = this.settings;
    const r = this.renderer;
    // While a handle is dragged it holds still (but still shows the edit).
    this.boss.update(dt, { data: st.data, fly: st.fly && !this.drag, head: st.bossHead, piece: st.bossPiece, straight: st.bossStraight, beam: st.bossBeam });
    r.camX = r.camY = 0;
    r.setZoom(st.zoom, true);
    r.detailStep = CONFIG.tiers.sizePerTier;
    r.setDetail(1, true);
    setDetailSteps(0);
    r.rotation = st.rotation;
    r.begin(dt);
    if (st.stars) {
      r.drawTiled(this.assets.get('bg.stars-far'), 0.3);
      r.drawTiled(this.assets.get('bg.stars-near'), 0.6);
    }
    this.boss.draw(r, this.assets, this.time);
    r.end();
    this.drawGuides();
  }

  /** A sound's scene (ShipArt → Sounds): played once per press of Play, otherwise held at its start. */
  private frameSound(dt: number, snd: SoundPreview) {
    const st = this.settings;
    const r = this.renderer;
    const { scene, tier } = snd;
    if (snd.play !== this.soundPlay) {
      this.soundPlay = snd.play;
      this.soundT = 0;
      this.soundCued = false;
      this.particles.clear();
    } else if (this.soundT !== Infinity) this.soundT += dt;
    const playing = this.soundT < scene.length;
    const T = playing ? this.soundT : 0;
    if (playing && !this.soundCued && T >= scene.cue) {
      this.soundCued = true;
      snd.cue();
    }
    snd.loop(playing && scene.loopUntil !== undefined && T >= scene.cue && T < scene.loopUntil ? 1 : 0);
    if (!playing) this.soundT = Infinity;
    r.camX = r.camY = 0;
    r.setZoom(st.zoom, true);
    r.detailStep = CONFIG.tiers.sizePerTier;
    r.setDetail(1, true);
    setDetailSteps(0);
    r.rotation = st.rotation;
    r.begin(dt);
    if (st.stars) {
      r.drawTiled(this.assets.get('bg.stars-far'), 0.3);
      r.drawTiled(this.assets.get('bg.stars-near'), 0.6);
    }
    const suffix = tier > 1 ? `.t${tier}` : '';
    const art = (name: string, enemy = false) => {
      const a = tierArt(this.assets, name.replace('{t}', ''), tier, '', false);
      if (!this.assets.has(a.name)) return null;
      // Ships and the Leviathan in their own colours; shots and effects in the team's.
      const own = /^(ship|boss)\./.test(a.name) || a.name.startsWith('ui.loot');
      const team = CONFIG.teamColors[enemy ? 'enemy' : 'player'];
      return { sprite: own ? this.assets.get(a.name) : this.assets.getRecolored(a.name, team, CONFIG.teamColors), scale: a.scale };
    };
    this.particles.update(playing ? dt : 0);
    this.particles.draw(r, this.assets);
    for (const it of scene.items) {
      if ('ship' in it) {
        const from = it.from ?? 0;
        if (T < from || (it.until !== undefined && T >= it.until)) continue;
        const name = it.ship.replace('{t}', suffix);
        if (!this.assets.has(name)) continue;
        const age = T - from;
        const x = it.x + (it.vx ?? 0) * age;
        const y = it.y + (it.vy ?? 0) * age;
        const angle = it.angle ?? 0;
        const state = it.state ?? 'idle';
        const layout = st.data.ships[name];
        if (playing) this.particles.emitMounts(st.data, layout, state, x, y, angle, dt, it.vx ?? 0, it.vy ?? 0);
        drawLayoutArt(r, this.assets, layout, name, x, y, angle, state, null, this.time, it.alpha ?? 1);
      } else if ('fx' in it) {
        const age = T - it.at;
        const a = art(it.fx);
        if (age < 0 || !a) continue;
        const length = a.sprite.fps > 0 && !a.sprite.loop ? a.sprite.frames.length / a.sprite.fps : 1;
        if (it.until !== undefined ? T >= it.until : age >= length) continue;
        r.drawSprite(a.sprite, it.x + (it.vx ?? 0) * age, it.y + (it.vy ?? 0) * age, it.angle ?? 0, age, 1, false, a.scale * (it.scale ?? 1));
      } else if ('shot' in it) {
        const age = T - it.at;
        const a = art(it.shot, it.enemy);
        if (age < 0 || T >= it.until || !a) continue;
        r.drawSprite(a.sprite, it.x + Math.cos(it.angle) * it.speed * age, it.y + Math.sin(it.angle) * it.speed * age, it.angle, age, 1, false, a.scale);
      } else {
        const age = T - it.at;
        const a = art(it.beam);
        if (age < 0 || T >= it.until || !a) continue;
        drawBeam(r, a.sprite, it.x, it.y, it.angle, it.length, (it.width ?? 1) * a.scale, age);
      }
    }
    r.end();
    this.overlay.getContext('2d')!.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  /** Leaving the sound scenes: its looping sound stops. */
  private stopSound() {
    this.soundT = Infinity;
    this.soundCued = true;
  }

  /** Ships: their damage marks (toolbar Damage: Health slider, Hit), drawn over the hull like in the game. */
  private damageDecor() {
    const st = this.settings;
    if (st.kind.section !== 'ships') return undefined;
    const d = this.dummy;
    d.hp = st.damageHp;
    if (st.damageHit !== this.lastHit) {
      this.lastHit = st.damageHit;
      // A gun hit somewhere on it (the hull is found from there).
      const size = this.assets.get(st.subject).frames[0];
      d.hits!.push({ x: (Math.random() - 0.5) * size.w, y: (Math.random() - 0.5) * size.h, kind: 'gun', strength: st.damageStrength });
    }
    return (hull: Sprite, spot: (x: number, y: number) => { x: number; y: number }, k: number) =>
      drawDamage(this.renderer, this.assets, d, tierOf(st.subject), hull, spot, this.x, this.y, this.angle, k, 1);
  }

  /** Ships: the 3D tilt now (Swing rocks it: bank and pitch on different rhythms), or none. */
  private tilt() {
    const st = this.settings;
    if (st.kind.section !== 'ships' || (!st.bank && !st.pitch)) return undefined;
    const rad = Math.PI / 180;
    const k = st.swing ? Math.sin(this.time * 1.3) : 1;
    const kp = st.swing ? Math.sin(this.time * 0.8 + 1) : 1;
    return { bank: st.bank * rad * k, pitch: st.pitch * rad * kp, light: st.tiltLight };
  }

  /** Mouse position in the world (boss preview). */
  private worldPoint(e: MouseEvent) {
    const rect = this.overlay.getBoundingClientRect();
    return this.renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  /**
   * The laser from its muzzle (the subject's centre): the aim line looping in
   * Warning, the beam firing about once a second in Beam; then its mounts.
   */
  private drawLaser(state: string, tier: number, team: Team) {
    const st = this.settings;
    const seg = this.assets.getRecolored(tierSprite(this.assets, state === 'warning' ? 'vfx.laser-warning' : 'vfx.laser', tier), CONFIG.teamColors[team], CONFIG.teamColors);
    const length = seg.fps > 0 ? seg.frames.length / seg.fps : 0.3;
    const t = state === 'warning' ? this.time : this.time % 1;
    if (state === 'warning' || t < length) drawBeam(this.renderer, seg, this.x, this.y, this.angle, CONFIG.laser.length, 1, t);
    drawLayoutArt(this.renderer, this.assets, this.layout, st.subject, this.x, this.y, this.angle, state, team, t, 1, false);
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
    if (st.boss) {
      const scale = this.renderer.worldToScreen(1, 0).x - this.renderer.worldToScreen(0, 0).x;
      this.boss.drawGuides(ctx, this.assets, (x, y) => this.renderer.worldToScreen(x, y), scale, st.bossPiece, st.bossIndex, st.bossFin);
      return;
    }
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
    // Hit shape (ships): green circles (the selected one gold, with a dot to drag its edge); none = the round hit circle, dashed.
    if (st.kind.section === 'ships' && !st.effect) {
      const scale = this.renderer.worldToScreen(1, 0).x - this.renderer.worldToScreen(0, 0).x;
      const circles = layout.hitShape ?? [];
      if (!circles.length) {
        const c = this.toScreen({ x: 0, y: 0 });
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(95,224,138,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(c.x, c.y, this.roundHitRadius() * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      circles.forEach((h, i) => {
        const selected = st.selectedHit === i;
        const c = this.toScreen(h);
        ctx.strokeStyle = selected ? '#ffd34a' : 'rgba(95,224,138,0.8)';
        ctx.lineWidth = selected ? 2 : 1;
        ctx.beginPath();
        ctx.arc(c.x, c.y, h.r * scale, 0, Math.PI * 2);
        ctx.moveTo(c.x + 2, c.y);
        ctx.arc(c.x, c.y, 2, 0, Math.PI * 2);
        ctx.stroke();
        if (selected) {
          const e = this.toScreen(this.hitEdge(h));
          ctx.fillStyle = '#ffd34a';
          ctx.fillRect(e.x - 3, e.y - 3, 6, 6);
        }
      });
    }
    // Guns: an orange ring with a line where it points; a turret also shows its arc (dashed).
    this.guns().forEach((g, i) => {
      const selected = st.selectedGun === i;
      const p = this.toScreen(g);
      const a = this.angle + (g.angle * Math.PI) / 180;
      ctx.strokeStyle = selected ? '#ffd34a' : 'rgba(255,150,60,0.75)';
      ctx.lineWidth = selected ? 2 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.moveTo(p.x + Math.cos(a) * 4, p.y + Math.sin(a) * 4);
      ctx.lineTo(p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 16);
      ctx.stroke();
      if (g.turret) {
        const arc = (CONFIG.guns.turretArc * Math.PI) / 180;
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        // A wedge from one end of its arc, round through where it points, to the other.
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.arc(p.x, p.y, 12, a - arc, a + arc);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '10px monospace';
      ctx.fillText(String(i + 1), p.x + 6, p.y + 12);
    });
  }

  /** The round hit circle a ship without a hit shape uses (its tier's hit radius). */
  private roundHitRadius() {
    const tier = Number(/\.t(\d+)$/.exec(this.settings.subject)?.[1] ?? 1);
    return SHIP_TYPES.fighter.radius * CONFIG.tiers.sizePerTier ** (tier - 1);
  }

  /** A hit circle's resize handle: on its edge, to the right of its centre (in the ship's pixels). */
  private hitEdge(h: { x: number; y: number; r: number }) {
    return { x: h.x + h.r, y: h.y };
  }

  /** The shown ship's guns (the standard ones if none are placed); none for objects. */
  private guns() {
    const st = this.settings;
    if (st.effect || st.kind.section !== 'ships') return [];
    return layoutGunsOrDefault(this.layout, st.subject);
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
    if (st.boss) return this.onDownBoss(e);
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
    // Then guns (ships only).
    const guns = this.guns();
    for (let i = guns.length - 1; i >= 0; i--) {
      const g = guns[i];
      if (Math.hypot(p.x - g.x, p.y - g.y) <= near) {
        this.events.selectGun(i);
        if (!st.readOnly) this.startDrag({ kind: 'gun', index: i, grabX: p.x - g.x, grabY: p.y - g.y });
        return;
      }
    }
    if (!layout) return this.events.select(null);
    // Then the hit shape (ships): the selected circle's edge handle, then any circle's centre.
    if (st.kind.section === 'ships' && layout?.hitShape?.length) {
      const circles = layout.hitShape;
      const sel = st.selectedHit !== null ? circles[st.selectedHit] : undefined;
      if (sel) {
        const e = this.hitEdge(sel);
        if (Math.hypot(p.x - e.x, p.y - e.y) <= near) {
          if (!st.readOnly) this.startDrag({ kind: 'hitSize', index: st.selectedHit!, grabX: sel.x, grabY: sel.y });
          return;
        }
      }
      for (let i = circles.length - 1; i >= 0; i--) {
        const h = circles[i];
        if (Math.hypot(p.x - h.x, p.y - h.y) <= Math.max(near, Math.min(h.r * 0.4, near * 2))) {
          this.events.selectHit(i);
          if (!st.readOnly) this.startDrag({ kind: 'hit', index: i, grabX: p.x - h.x, grabY: p.y - h.y });
          return;
        }
      }
    }
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

  /** Boss: the picked piece's size handle, else the piece under the mouse (picked, and its image dragged around its pivot). */
  private onDownBoss(e: MouseEvent) {
    const st = this.settings;
    const w = this.worldPoint(e);
    if (!st.guides) return this.events.selectBossPiece(null, null);
    const scale = this.renderer.worldToScreen(1, 0).x - this.renderer.worldToScreen(0, 0).x;
    const near = 6 / Math.max(scale, 0.01);
    // Fins first: the picked fin's tip and root handles, then any fin's joints.
    if (st.bossFin !== null) {
      const h = this.boss.finHandles(this.assets, st.bossFin);
      if (h && Math.hypot(w.x - h.tip.x, w.y - h.tip.y) <= near) {
        if (!st.readOnly) this.startDrag({ kind: 'finTip', index: st.bossFin, grabX: 0, grabY: 0 });
        return;
      }
    }
    const fin = this.boss.finAt(this.assets, w.x, w.y, near, st.bossFin);
    if (fin !== null) {
      this.events.selectFin(fin);
      const h = this.boss.finHandles(this.assets, fin)!;
      if (!st.readOnly) this.startDrag({ kind: 'finMove', index: fin, grabX: w.x - h.root.x, grabY: w.y - h.root.y });
      return;
    }
    const shown = this.boss.shownPiece(st.bossPiece, st.bossIndex);
    if (shown && st.bossPiece) {
      const h = this.boss.hitEdge(shown);
      if (Math.hypot(w.x - h.x, w.y - h.y) <= near) {
        if (!st.readOnly) this.startDrag({ kind: 'bossHit', index: this.boss.body.pieces.indexOf(shown), piece: st.bossPiece, grabX: w.x, grabY: w.y });
        return;
      }
    }
    const p = this.boss.pieceAt(this.assets, w.x, w.y);
    this.events.selectFin(null);
    if (!p) return this.events.selectBossPiece(null, null);
    const id = this.boss.pieceId(p);
    this.events.selectBossPiece(id, this.boss.body.pieces.indexOf(p));
    if (!st.readOnly) {
      const art = this.assets.get(bossPieceSprite(id));
      this.startDrag({ kind: 'bossPivot', index: this.boss.body.pieces.indexOf(p), piece: id, grabX: w.x, grabY: w.y, anchorX: art.anchorX, anchorY: art.anchorY });
    }
  }

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
    const d = this.drag;
    if (d.kind === 'finMove' || d.kind === 'finTip') {
      const w = this.worldPoint(e);
      if (d.kind === 'finMove') {
        const at = this.boss.toPieceFrame(d.index, w.x - d.grabX, w.y - d.grabY);
        this.events.moveFin(d.index, Math.round(at.x), Math.round(at.y));
      } else {
        const g = finGeometry(this.assets, this.boss.body, d.index);
        if (!g) return;
        const at = this.boss.toPieceFrame(d.index, w.x, w.y);
        const root = this.boss.finHandles(this.assets, d.index)!.root;
        // The way from its root to the mouse, in the piece's frame (0 = forward); its size from how far.
        let angle = Math.round(((Math.atan2(w.y - root.y, w.x - root.x) - at.angle) * 180) / Math.PI);
        angle = ((((angle + 180) % 360) + 360) % 360) - 180;
        const full = (g.length / g.scale) * at.scale;
        const scale = Math.max(0.1, Math.round((Math.hypot(w.x - root.x, w.y - root.y) / full) * 20) / 20);
        this.events.aimFin(d.index, angle, scale);
      }
      return;
    }
    if (d.kind === 'bossPivot' || d.kind === 'bossHit') {
      const w = this.worldPoint(e);
      const piece = this.boss.body.pieces[d.index];
      if (!piece) return;
      if (d.kind === 'bossHit') {
        // The circle's radius before this piece's bulge.
        const c = this.boss.pose(piece);
        this.events.resizeBossHit(d.piece!, Math.max(1, Math.round((Math.hypot(w.x - c.x, w.y - c.y) / piece.scale) * 2) / 2));
      } else {
        // The image follows the mouse; its pivot stays on the path, so the anchor moves the other way.
        const m = this.boss.worldToImageDelta(this.assets, piece, w.x - d.grabX, w.y - d.grabY);
        this.events.moveBossPivot(d.piece!, Math.round(d.anchorX! - m.u), Math.round(d.anchorY! - m.v));
      }
      return;
    }
    // Resizing a hit circle: its radius is the distance from its centre (half pixels).
    if (this.drag.kind === 'hitSize') {
      this.events.resizeHit(this.drag.index, Math.max(1, Math.round(Math.hypot(p.x - this.drag.grabX, p.y - this.drag.grabY) * 2) / 2));
      return;
    }
    // Whole pixels only, so pixel art lines up.
    const x = Math.round(p.x - this.drag.grabX);
    const y = Math.round(p.y - this.drag.grabY);
    if (this.drag.kind === 'gun') this.events.moveGun(this.drag.index, x, y);
    else if (this.drag.kind === 'hit') this.events.moveHit(this.drag.index, x, y);
    else if (this.drag.kind === 'mount') this.events.moveMount(this.drag.index, x, y);
    else if (this.drag.kind === 'vfx') this.events.moveVfx(this.drag.index, x, y);
    else this.events.movePoint(this.drag.point!, x, y);
  };

  private onUp = () => {
    this.drag = null;
  };
}
