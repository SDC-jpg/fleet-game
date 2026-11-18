// ShipArt's Hit shape section (ships only): the circles shots, missiles and beams hit (game/hitShape.ts).
// "Fit to art" places them from the image's solid pixels; they can then be dragged in the preview
// (centre = move, the gold square on the selected one's edge = resize) or typed in.

import { useState } from 'react';
import type { HitCircle } from '../game/artLayout';
import { NumberField } from './fields';

export function HitShapePanel({
  circles,
  roundRadius,
  selected,
  onSelect,
  onChange,
  onFit,
  onClear,
  onFitAll,
  shipCount,
}: {
  circles: HitCircle[];
  /** The round hit circle used when there are none. */
  roundRadius: number;
  selected: number | null;
  onSelect: (i: number | null) => void;
  onChange: (fn: (list: HitCircle[]) => void) => void;
  onFit: () => void;
  onClear: () => void;
  onFitAll: () => void;
  /** How many ship images "Fit all ships" would fit. */
  shipCount: number;
}) {
  const [confirmAll, setConfirmAll] = useState(false);
  const c = selected !== null ? circles[selected] : undefined;
  const edit = (fn: (h: HitCircle) => void) => selected !== null && onChange((list) => fn(list[selected]));
  return (
    <>
      <h2>Hit shape</h2>
      <div className="sa-note">
        What shots, missiles and beams hit (green circles).{' '}
        {circles.length ? `${circles.length} circle${circles.length > 1 ? 's' : ''}.` : `None placed: one round circle (radius ${Math.round(roundRadius)}, dashed).`}
      </div>
      <div className="sa-mounts">
        {circles.map((h, i) => (
          <button key={i} className={'sa-mount' + (selected === i ? ' on' : '')} onClick={() => onSelect(i)}>
            Circle {i + 1}
            <span className="sa-note"> r {h.r}</span>
          </button>
        ))}
      </div>
      <div className="sa-row sa-wrap">
        <button onClick={onFit} title="Place circles covering the image's solid pixels (replaces these)">
          Fit to art
        </button>
        <button
          onClick={() => {
            onChange((list) => list.push({ x: 0, y: 0, r: Math.max(2, Math.round(roundRadius / 2)) }));
            onSelect(circles.length);
          }}
        >
          + Circle
        </button>
        {circles.length > 0 && (
          <button
            onClick={() => {
              onClear();
              onSelect(null);
            }}
            title="Remove the circles: back to one round hit circle"
          >
            Use round
          </button>
        )}
      </div>
      {c && (
        <div className="sa-mount-edit">
          <h2>Circle {selected! + 1}</h2>
          <div className="sa-row">
            <NumberField label="x" value={c.x} step={0.5} onChange={(v) => edit((h) => (h.x = v))} />
            <NumberField label="y" value={c.y} step={0.5} onChange={(v) => edit((h) => (h.y = v))} />
            <NumberField label="r" value={c.r} step={0.5} min={1} onChange={(v) => edit((h) => (h.r = Math.max(1, v)))} />
          </div>
          <div className="sa-row sa-actions">
            <button
              onClick={() => {
                onChange((list) => list.push({ ...c, y: -c.y }));
                onSelect(circles.length);
              }}
              title="A copy on the other side (top ↔ bottom)"
            >
              Mirror copy
            </button>
            <button
              className="sa-danger"
              onClick={() => {
                onChange((list) => list.splice(selected!, 1));
                onSelect(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
      <div className="sa-row sa-wrap">
        {confirmAll ? (
          <>
            <span className="sa-note">Replace the hit shapes of all {shipCount} ship images?</span>
            <button
              onClick={() => {
                onFitAll();
                setConfirmAll(false);
              }}
            >
              Yes, fit all
            </button>
            <button onClick={() => setConfirmAll(false)}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setConfirmAll(true)} title="Fit every ship image (all designs and tiers) to its art">
            Fit all ships…
          </button>
        )}
      </div>
    </>
  );
}
