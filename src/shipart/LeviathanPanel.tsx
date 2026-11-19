// ShipArt's Leviathan panel (Bosses → Leviathan): how the body is put together. Body settings
// and hit circles go to art.json (`bosses.leviathan`); each piece's pivot (the point it turns
// around, which sits on the path) is its image's anchor in manifest.json. Both are saved with Save.

import type { Assets } from '../engine/assets';
import { useEffect, useRef } from 'react';
import { DEFAULT_FIN_IMAGE, fileSprite, type LeviathanBulge, type LeviathanFin, type LeviathanLayout, type LeviathanPieceKind } from '../game/artLayout';
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

/** A fin image, enlarged, with its root marked: click it to move the root (where the fin attaches). */
function FinRootPicker({ assets, file, root, onPick }: { assets: Assets; file: string; root: { x: number; y: number }; onPick: (x: number, y: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const name = fileSprite(file);
  const frame = assets.has(name) ? assets.get(name).frames[0] : null;
  const k = frame ? Math.max(1, Math.floor(220 / Math.max(frame.w, frame.h / 0.5))) : 1;
  useEffect(() => {
    const c = ref.current;
    if (!c || !frame) return;
    c.width = frame.w * k;
    c.height = frame.h * k;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(frame.image, frame.sx, frame.sy, frame.w, frame.h, 0, 0, c.width, c.height);
    // The root: a gold cross, and a line along the fin's length (it points right).
    const x = root.x * k;
    const y = root.y * k;
    ctx.strokeStyle = '#ffd34a';
    ctx.beginPath();
    ctx.moveTo(x - 6, y);
    ctx.lineTo(x + 6, y);
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x, y + 6);
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,211,74,0.5)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(c.width, y);
    ctx.stroke();
  }, [frame, k, root.x, root.y]);
  if (!frame) return <div className="sa-note">Image not found: {file}</div>;
  return (
    <canvas
      ref={ref}
      className="sa-fin-root"
      title="Click where the fin attaches to the body (its root)"
      onClick={(e) => {
        const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
        onPick(Math.round((e.clientX - r.left) / k), Math.round((e.clientY - r.top) / k));
      }}
    />
  );
}

/** A fin copied to the other side of its piece, mirrored. */
export const mirrorFin = (f: LeviathanFin): LeviathanFin => ({ ...f, y: -f.y, angle: -f.angle, flip: !f.flip });

/** Which hit circle a piece uses (both heads share one). */
export const bossPieceKind = (p: BossPiece): LeviathanPieceKind => (p === 'head-side' ? 'head' : p);

export function LeviathanPanel({
  assets,
  layout,
  selected,
  pickedIndex,
  selectedFin,
  onSelectFin,
  finFiles,
  onSelect,
  onChange,
  onPivot,
  onReset,
}: {
  assets: Assets;
  layout: LeviathanLayout;
  selected: BossPiece | null;
  /** The piece clicked in the preview, counted from the head (for a new bulge or fin), or null. */
  pickedIndex: number | null;
  /** The picked fin, or null. */
  selectedFin: number | null;
  onSelectFin: (i: number | null) => void;
  /** Images a fin can use (art files with "fin" in their name in bosses/). */
  finFiles: string[];
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
  /** Change the fins (a copy of the list). */
  const editFins = (fn: (list: LeviathanFin[]) => void) =>
    onChange((l) => {
      const list = layout.fins.map((f) => ({ ...f }));
      fn(list);
      l.fins = list;
    });
  const fin = selectedFin !== null ? layout.fins[selectedFin] : undefined;
  const editFin = (fn: (f: LeviathanFin) => void) => selectedFin !== null && editFins((list) => fn(list[selectedFin]));
  const finFile = fin?.image ?? DEFAULT_FIN_IMAGE;
  const finRootAt = layout.finImages[finFile] ?? (assets.has(fileSprite(finFile)) ? { x: 0, y: Math.round(assets.get(fileSprite(finFile)).frames[0].h / 2) } : { x: 0, y: 0 });
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

      <h2>Fins</h2>
      <div className="sa-note">
        Just for looks (no collision). Each sits on one piece and bends at its joints as the body swims (stiffness and sway in the
        game's settings). Click a fin's green joints in the preview to pick it; drag it to move it, drag the gold square at its tip
        to turn and size it.
      </div>
      <div className="sa-mounts">
        {layout.fins.map((f, i) => (
          <button key={i} className={'sa-mount' + (selectedFin === i ? ' on' : '')} onClick={() => onSelectFin(selectedFin === i ? null : i)}>
            Fin {i + 1}
            <span className="sa-note">
              {' '}
              #{f.piece} {pieceName(layout, f.piece)} · {f.y < 0 ? 'left' : f.y > 0 ? 'right' : 'middle'}
            </span>
          </button>
        ))}
        {layout.fins.length === 0 && <div className="sa-note">No fins.</div>}
      </div>
      <div className="sa-row sa-wrap">
        <button
          onClick={() => {
            editFins((list) => list.push({ piece: addAt, x: 0, y: 28, angle: 150, scale: 1, flip: false, front: false }));
            onSelectFin(layout.fins.length);
          }}
          title={pickedIndex === null ? 'Click a piece in the preview first to choose where (otherwise the middle one)' : undefined}
        >
          + Fin on #{addAt} {pieceName(layout, addAt)}
        </button>
      </div>
      {fin && selectedFin !== null && (
        <div className="sa-mount-edit">
          <h2>Fin {selectedFin + 1}</h2>
          <div className="sa-row">
            <NumberField label="Piece #" value={fin.piece} min={0} max={count - 1} onChange={(v) => editFin((f) => (f.piece = Math.max(0, Math.min(count - 1, Math.round(v)))))} />
          </div>
          <div className="sa-row">
            <NumberField label="x" value={fin.x} onChange={(v) => editFin((f) => (f.x = v))} />
            <NumberField label="y" value={fin.y} onChange={(v) => editFin((f) => (f.y = v))} />
          </div>
          <div className="sa-note">x forward, y out to the right (negative = left side), from the piece's pivot.</div>
          <div className="sa-row">
            <NumberField label="Angle" value={fin.angle} step={5} onChange={(v) => editFin((f) => (f.angle = v))} />
            <NumberField label="Size" value={fin.scale} step={0.05} min={0.1} onChange={(v) => editFin((f) => (f.scale = Math.max(0.1, v)))} />
          </div>
          <div className="sa-note">Angle: 0 = forward, 90 = right, 180 = backward, −90 = left.</div>
          <div className="sa-row">
            <label>
              <input type="checkbox" checked={fin.flip} onChange={(e) => editFin((f) => (f.flip = e.target.checked))} /> Mirror ↕
            </label>
            <label title="Drawn over its piece (otherwise under it)">
              <input type="checkbox" checked={fin.front} onChange={(e) => editFin((f) => (f.front = e.target.checked))} /> In front of its piece
            </label>
          </div>
          <div className="sa-sub">Image</div>
          <select
            value={finFile}
            onChange={(e) =>
              editFin((f) => {
                if (e.target.value === DEFAULT_FIN_IMAGE) delete f.image;
                else f.image = e.target.value;
              })
            }
          >
            {[...new Set([DEFAULT_FIN_IMAGE, ...finFiles, finFile])].map((file) => (
              <option key={file} value={file}>
                {file.replace(/^.*\//, '')}
              </option>
            ))}
          </select>
          <div className="sa-note">Add images to public/assets/bosses/ with "fin" in their name; any size works.</div>
          <div className="sa-sub">Attachment point (for every fin with this image)</div>
          <FinRootPicker
            assets={assets}
            file={finFile}
            root={finRootAt}
            onPick={(x, y) => onChange((l) => (l.finImages = { ...layout.finImages, ...l.finImages, [finFile]: { x, y } }))}
          />
          <div className="sa-row">
            <NumberField label="x" value={finRootAt.x} onChange={(v) => onChange((l) => (l.finImages = { ...layout.finImages, [finFile]: { ...finRootAt, x: Math.round(v) } }))} />
            <NumberField label="y" value={finRootAt.y} onChange={(v) => onChange((l) => (l.finImages = { ...layout.finImages, [finFile]: { ...finRootAt, y: Math.round(v) } }))} />
          </div>
          <div className="sa-row sa-actions">
            <button
              onClick={() => {
                editFins((list) => list.push({ ...fin, y: fin.y + 6 }));
                onSelectFin(layout.fins.length);
              }}
            >
              Duplicate
            </button>
            <button
              title="A copy on the other side of the piece, mirrored"
              onClick={() => {
                editFins((list) => list.push(mirrorFin(fin)));
                onSelectFin(layout.fins.length);
              }}
            >
              Mirror copy
            </button>
            <button
              className="sa-danger"
              onClick={() => {
                editFins((list) => list.splice(selectedFin, 1));
                onSelectFin(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

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
