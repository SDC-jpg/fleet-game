// ShipArt's Leviathan panel (Bosses → Leviathan): how the body is put together. Body settings
// and hit circles go to art.json (`bosses.leviathan`); each piece's pivot (the point it turns
// around, which sits on the path) is its image's anchor in manifest.json. Both are saved with Save.

import type { Assets } from '../engine/assets';
import type { LeviathanBulge, LeviathanLayout, LeviathanPieceKind } from '../game/artLayout';
import { LEVIATHAN_DEFAULTS, PIECE_SPRITES, SIDE_HEAD_SPRITE, falloffWeight } from '../game/leviathan';
import { NumberField, SliderField } from './fields';

/** A piece you can pick: the five body pieces plus the side-view head (its own image and pivot). */
export type BossPiece = LeviathanPieceKind | 'head-side';

export const BOSS_PIECES: { id: BossPiece; label: string }[] = [
  { id: 'head', label: 'Head (top view)' },
  { id: 'head-side', label: 'Head (side view)' },
  { id: 'segment', label: 'Repeating segment' },
  { id: 'antepenultimate', label: 'Antepenultimate segment' },
  { id: 'penultimate', label: 'Penultimate segment' },
  { id: 'tail', label: 'Tail' },
];

/** The image of a piece (manifest name). */
export const bossPieceSprite = (p: BossPiece) => (p === 'head-side' ? SIDE_HEAD_SPRITE : PIECE_SPRITES[p]);
/** How many pieces the body has (head to tail). */
export const pieceCount = (L: LeviathanLayout) => Math.max(0, Math.round(L.segments)) + 4;

/** A piece's name by its number from the head: "Head", "Segment 3", "Tail"... */
export function pieceName(L: LeviathanLayout, i: number) {
  const n = pieceCount(L);
  if (i <= 0) return 'Head';
  if (i >= n - 1) return 'Tail';
  if (i === n - 2) return 'Penultimate';
  if (i === n - 3) return 'Antepenultimate';
  return `Segment ${i}`;
}

/** The fade of a bulge over its falloff, as a small graph: full at the left (its own piece), nothing at the right. */
function FalloffGraph({ curve }: { curve: number }) {
  const w = 120;
  const h = 36;
  const pts = Array.from({ length: 41 }, (_, k) => {
    const t = k / 40;
    return `${(t * w).toFixed(1)},${(h - falloffWeight(t, curve) * h).toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="sa-falloff-graph" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <line x1={0} y1={0} x2={w} y2={h} />
      <polyline points={pts} />
    </svg>
  );
}

/** Which hit circle a piece uses (both heads share one). */
export const bossPieceKind = (p: BossPiece): LeviathanPieceKind => (p === 'head-side' ? 'head' : p);

export function LeviathanPanel({
  assets,
  layout,
  selected,
  pickedIndex,
  onSelect,
  onChange,
  onPivot,
  onReset,
}: {
  assets: Assets;
  layout: LeviathanLayout;
  selected: BossPiece | null;
  /** The piece clicked in the preview, counted from the head (for a new bulge), or null. */
  pickedIndex: number | null;
  onSelect: (p: BossPiece | null) => void;
  /** Change the body settings (art.json). */
  onChange: (fn: (l: Partial<LeviathanLayout>) => void) => void;
  /** Move a piece's pivot (its image's anchor), in image pixels. */
  onPivot: (p: BossPiece, x: number, y: number) => void;
  /** Back to the default body settings (pivots unchanged). */
  onReset: () => void;
}) {
  const set = <K extends keyof LeviathanLayout>(key: K, v: LeviathanLayout[K]) => onChange((l) => (l[key] = v));
  const sprite = selected ? assets.get(bossPieceSprite(selected)) : null;
  const kind = selected ? bossPieceKind(selected) : null;
  const count = pieceCount(layout);
  /** Change one bulge (a copy of the list, so the other settings stay as they are). */
  const editBulges = (fn: (list: LeviathanBulge[]) => void) =>
    onChange((l) => {
      const list = layout.bulges.map((b) => ({ ...b }));
      fn(list);
      l.bulges = list;
    });
  const addAt = pickedIndex ?? Math.floor(count / 2);
  return (
    <>
      <h2>Body</h2>
      <div className="sa-note">
        Every piece follows the head's path. Distances are measured along the path, between the pieces' pivots (the crosses in
        the preview).
      </div>
      <div className="sa-row">
        <NumberField label="Segments" value={layout.segments} min={0} onChange={(v) => set('segments', Math.max(0, Math.round(v)))} />
      </div>
      <div className="sa-row">
        <NumberField label="Head gap" value={layout.headGap} onChange={(v) => set('headGap', v)} />
        <NumberField label="Spacing" value={layout.spacing} min={1} onChange={(v) => set('spacing', Math.max(1, v))} />
      </div>
      <div className="sa-row">
        <NumberField label="Tail gap" value={layout.tailGap} onChange={(v) => set('tailGap', v)} />
      </div>
      <label className="sa-row" title="Which way the side-view head image is drawn; it's mirrored for turns the other way">
        <input type="checkbox" checked={layout.sideViewForRightTurns} onChange={(e) => set('sideViewForRightTurns', e.target.checked)} /> Side-view head
        is drawn for right turns
      </label>
      <div className="sa-row">
        <button onClick={onReset} title={`Segments ${LEVIATHAN_DEFAULTS.segments}, gaps ${LEVIATHAN_DEFAULTS.headGap} / ${LEVIATHAN_DEFAULTS.spacing} / ${LEVIATHAN_DEFAULTS.tailGap}, default hit circles (pivots stay)`}>
          Default body settings
        </button>
      </div>

      <h2>Bulges</h2>
      <div className="sa-note">
        Make a piece bigger or smaller; its falloff spreads that to the pieces on each side, fading along the curve. Several
        bulges multiply. Hit circles follow. Purple rings in the preview mark them.
      </div>
      {layout.bulges.map((b, i) => (
        <div key={i} className="sa-bulge">
          <div className="sa-bulge-head">
            <b>Bulge {i + 1}</b>
            <span className="sa-note">
              #{b.piece} {pieceName(layout, b.piece)}
            </span>
            <button className="sa-danger" onClick={() => editBulges((list) => list.splice(i, 1))} title="Remove this bulge">
              ✕
            </button>
          </div>
          <div className="sa-row">
            <NumberField
              label="Piece #"
              value={b.piece}
              min={0}
              max={count - 1}
              onChange={(v) => editBulges((list) => (list[i].piece = Math.max(0, Math.min(count - 1, Math.round(v)))))}
            />
          </div>
          <SliderField
            label="Bulge"
            value={b.scale}
            min={0.3}
            max={2.5}
            step={0.05}
            reset={1}
            format={(v) => `×${v.toFixed(2)}`}
            title="Its size: 1 = normal (double-click to reset)"
            onChange={(v) => editBulges((list) => (list[i].scale = v))}
          />
          <SliderField
            label="Falloff"
            value={b.falloff}
            min={0}
            max={12}
            step={0.5}
            reset={0}
            format={(v) => `${v} piece${v === 1 ? '' : 's'}`}
            title="How many pieces on each side also get some of it (double-click: only this piece)"
            onChange={(v) => editBulges((list) => (list[i].falloff = v))}
          />
          <SliderField
            label="Curve"
            value={b.curve}
            min={-1}
            max={1}
            step={0.05}
            reset={0}
            format={(v) => (v === 0 ? 'even' : v.toFixed(2))}
            title="Shape of the fade (a Bezier curve): 0 = even, right = stays big then drops, left = drops fast then trails (double-click: even)"
            onChange={(v) => editBulges((list) => (list[i].curve = v))}
          />
          <FalloffGraph curve={b.curve} />
        </div>
      ))}
      <div className="sa-row">
        <button
          onClick={() => editBulges((list) => list.push({ piece: addAt, scale: 1.3, falloff: 3, curve: 0 }))}
          title={pickedIndex === null ? 'Click a piece in the preview first to choose where (otherwise the middle one)' : undefined}
        >
          + Bulge on #{addAt} {pieceName(layout, addAt)}
        </button>
      </div>

      <h2>Pieces</h2>
      <div className="sa-note">Pick a piece, or click it in the preview. Drag its image to move it around its pivot; drag the gold square to size its hit circle.</div>
      <div className="sa-mounts">
        {BOSS_PIECES.map((p) => (
          <button key={p.id} className={'sa-mount' + (selected === p.id ? ' on' : '')} onClick={() => onSelect(selected === p.id ? null : p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {selected && sprite && kind && (
        <div className="sa-mount-edit">
          <h2>{BOSS_PIECES.find((p) => p.id === selected)!.label}</h2>
          <div className="sa-note">
            {bossPieceSprite(selected)} · {sprite.frames[0].w}×{sprite.frames[0].h} px
          </div>
          <div className="sa-sub">Pivot (pixel in the image, from its top left)</div>
          <div className="sa-row">
            <NumberField label="x" value={sprite.anchorX} onChange={(v) => onPivot(selected, Math.round(v), sprite.anchorY)} />
            <NumberField label="y" value={sprite.anchorY} onChange={(v) => onPivot(selected, sprite.anchorX, Math.round(v))} />
          </div>
          <div className="sa-sub">Hit circle{kind === 'head' ? ' (both heads share it)' : ''}</div>
          <div className="sa-row">
            <NumberField
              label="Radius"
              value={layout.hitRadius[kind]}
              min={1}
              onChange={(v) => onChange((l) => (l.hitRadius = { ...layout.hitRadius, ...l.hitRadius, [kind]: Math.max(1, v) }))}
            />
          </div>
        </div>
      )}
    </>
  );
}
