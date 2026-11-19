// ShipArt's Leviathan preview (Bosses → Leviathan): the creature swims a figure eight around
// the middle of the view, so it turns both ways and goes straight in between (both head views
// show), using the game's own body and drawing code. With Fly off it holds still; "Lay straight"
// stretches it out facing right. Guides: each piece's pivot (cross), the picked piece's image
// outline (gold), and the hit circles (green; the picked piece's gold, with a square to size it).

import type { Assets } from '../engine/assets';
import type { PixelRenderer } from '../engine/renderer';
import { CONFIG } from '../game/config';
import type { ArtLayoutsFile, LeviathanLayout } from '../game/artLayout';
import { followHead, leviathanLayout, makeLeviathanBody, relayLeviathan, swimLeviathan, type LeviathanBody, type LeviathanPiece } from '../game/leviathan';
import { drawLeviathan, leviathanPieceArt } from '../game/render';
import { bossPieceKind, type BossPiece } from './LeviathanPanel';

/** Which head the preview shows: as the turns pick it, or held on one view. */
export type BossHead = 'auto' | 'top' | 'right' | 'left';

export interface BossSettings {
  data: ArtLayoutsFile;
  fly: boolean;
  head: BossHead;
  piece: BossPiece | null;
  /** Bumped by "Lay straight". */
  straight: number;
}

/** Half the width of the figure eight it swims (pixels). */
const LOOP = 230;

export class LeviathanPreview {
  body: LeviathanBody;
  /** The head. */
  x = 0;
  y = 0;
  angle = 0;
  vx = 0;
  vy = 0;
  /** How far along the figure eight (radians). */
  private t = 0;
  private layoutKey = '';
  private straight = -1;

  constructor() {
    this.body = makeLeviathanBody(0, 0, 0);
  }

  /** The figure eight: a point and its direction of travel at t. */
  private loop(t: number) {
    const x = LOOP * Math.sin(t);
    const y = LOOP * Math.sin(t) * Math.cos(t);
    const dx = LOOP * Math.cos(t);
    const dy = LOOP * Math.cos(2 * t);
    return { x, y, dx, dy };
  }

  update(dt: number, s: BossSettings) {
    const L = leviathanLayout(s.data);
    if (s.straight !== this.straight) {
      // Stretched out facing right, the whole creature centred on the view.
      this.straight = s.straight;
      const length = this.length(L);
      this.x = length / 2 - L.headGap / 2;
      this.y = 0;
      this.angle = this.vx = this.vy = 0;
      this.body = makeLeviathanBody(this.x, this.y, 0, L);
      this.layoutKey = JSON.stringify(L);
      this.t = -1; // start the figure eight afresh when it flies again
    }
    // Body settings changed (ShipArt edits): put it together again on the same path.
    const key = JSON.stringify(L);
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      relayLeviathan(this.body, L, this.x, this.y, this.angle);
    }
    if (s.fly) {
      if (this.t < 0) {
        // Join the figure eight where it crosses the middle, heading the way the body points.
        this.t = 0;
        const p = this.loop(0);
        this.x = p.x;
        this.y = p.y;
        this.angle = Math.atan2(p.dy, p.dx);
        this.body = makeLeviathanBody(this.x, this.y, this.angle, L);
      }
      // Along the figure eight at the game's cruising speed.
      const speed = CONFIG.leviathan.speed;
      const now = this.loop(this.t);
      this.t += (speed * dt) / Math.max(1, Math.hypot(now.dx, now.dy));
      const p = this.loop(this.t);
      const want = Math.atan2(p.dy, p.dx);
      this.x = p.x;
      this.y = p.y;
      // Turn exactly onto the path (so it never strays from it); this also picks the head's view.
      swimLeviathan(this.body, this, want, speed, Math.PI * 4, dt);
      followHead(this.body, this.x, this.y, this.angle);
    }
    if (s.head !== 'auto') this.body.view = s.head === 'top' ? 0 : s.head === 'right' ? 1 : -1;
  }

  /** Head to tail along the path. */
  private length(L: LeviathanLayout) {
    return L.headGap + L.spacing * (Math.max(0, L.segments) + 1) + L.tailGap;
  }

  draw(r: PixelRenderer, assets: Assets, time: number) {
    drawLeviathan(r, assets, this.body, this.x, this.y, this.angle, time);
  }

  /** Where a piece is and how it's turned (the head: where it flies). */
  pose(p: LeviathanPiece) {
    return p.kind === 'head' ? { x: this.x, y: this.y, angle: this.angle } : { x: p.x, y: p.y, angle: p.angle };
  }

  /** Which piece a pick in the panel means for this body piece (the head: the view showing). */
  pieceId(p: LeviathanPiece): BossPiece {
    return p.kind === 'head' && this.body.view !== 0 ? 'head-side' : p.kind;
  }

  /** An image pixel (u, v) of a piece, in the world. */
  imageToWorld(assets: Assets, p: LeviathanPiece, u: number, v: number) {
    const { sprite, mirror } = leviathanPieceArt(assets, this.body, p.kind);
    const { x, y, angle } = this.pose(p);
    const a = angle + Math.PI / 2;
    const lx = (u - sprite.anchorX) * (mirror ? -1 : 1) * p.scale;
    const ly = (v - sprite.anchorY) * p.scale;
    return { x: x + lx * Math.cos(a) - ly * Math.sin(a), y: y + lx * Math.sin(a) + ly * Math.cos(a) };
  }

  /** A world movement (dx, dy) as a movement in a piece's image pixels. */
  worldToImageDelta(assets: Assets, p: LeviathanPiece, dx: number, dy: number) {
    const { mirror } = leviathanPieceArt(assets, this.body, p.kind);
    const a = this.pose(p).angle + Math.PI / 2;
    const lx = (dx * Math.cos(a) + dy * Math.sin(a)) / p.scale;
    const ly = (-dx * Math.sin(a) + dy * Math.cos(a)) / p.scale;
    return { u: mirror ? -lx : lx, v: ly };
  }

  /** The four corners of a piece's image, in the world. */
  corners(assets: Assets, p: LeviathanPiece) {
    const { sprite } = leviathanPieceArt(assets, this.body, p.kind);
    const { w, h } = sprite.frames[0];
    return [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ].map(([u, v]) => this.imageToWorld(assets, p, u, v));
  }

  /** The topmost piece whose image covers this world point (the tail end is drawn on top). */
  pieceAt(assets: Assets, x: number, y: number): LeviathanPiece | null {
    const pieces = this.body.pieces;
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      const c = this.corners(assets, p);
      let sign = 0;
      let inside = true;
      for (let k = 0; k < 4; k++) {
        const a = c[k];
        const b = c[(k + 1) % 4];
        const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
        if (cross === 0) continue;
        if (!sign) sign = Math.sign(cross);
        else if (Math.sign(cross) !== sign) {
          inside = false;
          break;
        }
      }
      if (inside) return p;
    }
    return null;
  }

  /** The piece shown for a pick: the one clicked (`index`, counted from the head) if it's that kind, else the first of that kind. */
  shownPiece(piece: BossPiece | null, index: number | null = null) {
    if (!piece) return null;
    const at = index !== null ? this.body.pieces[index] : undefined;
    if (at && this.pieceId(at) === piece) return at;
    return this.body.pieces.find((p) => this.pieceId(p) === piece) ?? null;
  }

  /** The resize handle of a piece's hit circle: on its edge, sideways from where the piece faces. */
  hitEdge(p: LeviathanPiece) {
    const { x, y, angle } = this.pose(p);
    const r = this.body.layout.hitRadius[bossPieceKind(this.pieceId(p))] * p.scale;
    return { x: x + Math.cos(angle + Math.PI / 2) * r, y: y + Math.sin(angle + Math.PI / 2) * r };
  }

  drawGuides(ctx: CanvasRenderingContext2D, assets: Assets, toScreen: (x: number, y: number) => { x: number; y: number }, scale: number, piece: BossPiece | null, index: number | null) {
    const R = this.body.layout.hitRadius;
    // Only one of the repeating segments is outlined (they all share the picked image): the one clicked.
    const first = this.shownPiece(piece, index);
    const bulged = new Set(this.body.layout.bulges.map((b) => b.piece));
    this.body.pieces.forEach((p, i) => {
      // A bulge's own piece: a purple ring with its number.
      if (bulged.has(i)) {
        const { x, y } = this.pose(p);
        const c = toScreen(x, y);
        ctx.strokeStyle = '#c58bff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    for (const p of this.body.pieces) {
      const picked = p === first;
      const { x, y } = this.pose(p);
      const c = toScreen(x, y);
      // Hit circle.
      ctx.strokeStyle = picked ? '#ffd34a' : 'rgba(95,224,138,0.55)';
      ctx.lineWidth = picked ? 2 : 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, R[p.kind] * p.scale * scale, 0, Math.PI * 2);
      ctx.stroke();
      // Pivot.
      ctx.strokeStyle = picked ? '#ffd34a' : 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(c.x - 4, c.y);
      ctx.lineTo(c.x + 4, c.y);
      ctx.moveTo(c.x, c.y - 4);
      ctx.lineTo(c.x, c.y + 4);
      ctx.stroke();
      if (!picked) continue;
      // The picked piece's image outline and its circle's size handle.
      const pts = this.corners(assets, p).map((q) => toScreen(q.x, q.y));
      ctx.lineWidth = 1;
      ctx.beginPath();
      pts.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.stroke();
      const e = toScreen(this.hitEdge(p).x, this.hitEdge(p).y);
      ctx.fillStyle = '#ffd34a';
      ctx.fillRect(e.x - 3, e.y - 3, 6, 6);
      // Its number along the body (what a bulge's "Piece" means).
      ctx.font = '11px monospace';
      ctx.fillText(`#${this.body.pieces.indexOf(p)}`, c.x + 6, c.y - 6);
    }
  }
}
