// ShipArt: the Leviathan's colour gradients (Bosses → Leviathan → Gradients). Like a Photoshop
// gradient overlay: a bar with colour stops under it (click the bar to add one, drag a stop to
// move it, drag it down off the bar to remove it), a blend mode and an opacity. Several stack,
// top of the list first. The colouring itself is in src/game/gradientTint.ts.

import { useRef, useState } from "react";
import type { BossGradient, GradientStop } from "../game/artLayout";
import {
  BLEND_MODES,
  newGradient,
  rgbToHex,
  sampleStops,
} from "../game/gradientTint";
import { NumberField, SliderField } from "./fields";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The bar's CSS: the stops' colours and opacities, left to right. */
function barCss(stops: GradientStop[]) {
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  const rgba = (s: GradientStop) => {
    const n = parseInt(s.color.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${s.opacity})`;
  };
  if (sorted.length === 1) return rgba(sorted[0]);
  return `linear-gradient(to right, ${sorted.map((s) => `${rgba(s)} ${(s.at * 100).toFixed(1)}%`).join(", ")})`;
}

/** The gradient bar and its stops. */
function StopBar({
  g,
  selected,
  onSelect,
  onEdit,
}: {
  g: BossGradient;
  selected: number;
  onSelect: (i: number) => void;
  /** Change the stops; noUndo for the moves of a drag after its first. */
  onEdit: (
    fn: (stops: GradientStop[]) => number | void,
    noUndo?: boolean,
  ) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const atX = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const drag = (e: React.PointerEvent, i: number) => {
    e.preventDefault();
    onSelect(i);
    const startY = e.clientY;
    let moved = false;
    let removed = false;
    const move = (ev: PointerEvent) => {
      // Pulled well below the bar: remove it (if two stay), like in Photoshop.
      const away = ev.clientY - startY > 40 && g.stops.length > 2;
      if (away !== removed) {
        removed = away;
        if (ref.current)
          ref.current.parentElement!.classList.toggle("removing", away);
      }
      onEdit((stops) => void (stops[i].at = atX(ev.clientX)), moved);
      moved = true;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      ref.current?.parentElement!.classList.remove("removing");
      if (removed) {
        onEdit((stops) => void stops.splice(i, 1), true);
        onSelect(0);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="sa-grad">
      <div
        ref={ref}
        className="sa-grad-bar"
        title="Click to add a colour stop"
        onPointerDown={(e) => {
          const at = atX(e.clientX);
          const here = sampleStops(g.stops, at);
          onEdit(
            (stops) =>
              stops.push({
                at,
                color: rgbToHex(here.rgb),
                opacity: Math.round(here.opacity * 100) / 100,
              }) - 1,
          );
          onSelect(g.stops.length);
        }}
      >
        <div style={{ background: barCss(g.stops) }} />
      </div>
      <div className="sa-grad-stops">
        {g.stops.map((s, i) => (
          <div
            key={i}
            className={"sa-grad-stop" + (i === selected ? " on" : "")}
            style={{ left: `${s.at * 100}%`, ["--c" as string]: s.color }}
            title="Drag to move · drag down off the bar to remove"
            onPointerDown={(e) => drag(e, i)}
          />
        ))}
      </div>
    </div>
  );
}

/** One gradient's settings. */
function GradientEditor({
  g,
  index,
  count,
  onEdit,
  onMove,
  onRemove,
}: {
  g: BossGradient;
  index: number;
  count: number;
  onEdit: (fn: (g: BossGradient) => void, noUndo?: boolean) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const [sel, setSel] = useState(0);
  const i = Math.min(sel, g.stops.length - 1);
  const stop = g.stops[i];
  const editStops = (
    fn: (stops: GradientStop[]) => number | void,
    noUndo?: boolean,
  ) => onEdit((x) => void fn(x.stops), noUndo);
  return (
    <div className={"sa-bulge sa-gradient" + (g.hidden ? " off" : "")}>
      <div className="sa-bulge-head">
        <label title="Show or hide this gradient">
          <input
            type="checkbox"
            checked={!g.hidden}
            onChange={(e) =>
              onEdit((x) => (x.hidden = !e.target.checked || undefined))
            }
          />
          <b>Gradient {index + 1}</b>
        </label>
        <span className="sa-grad-buttons">
          <button
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
            title="Move up (applied earlier, under the ones below)"
          >
            ▲
          </button>
          <button
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
            title="Move down (applied later, over the ones above)"
          >
            ▼
          </button>
          <button
            className="sa-danger"
            onClick={onRemove}
            title="Remove this gradient"
          >
            ✕
          </button>
        </span>
      </div>
      <div className="sa-row">
        <label className="sa-num">
          Mode
          <select
            value={g.mode}
            onChange={(e) =>
              onEdit((x) => (x.mode = e.target.value as BossGradient["mode"]))
            }
          >
            {BLEND_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SliderField
        label="Opacity"
        value={g.opacity}
        min={0}
        max={1}
        step={0.01}
        reset={1}
        format={pct}
        onChange={(v) => onEdit((x) => (x.opacity = v))}
      />
      <StopBar g={g} selected={i} onSelect={setSel} onEdit={editStops} />
      <div className="sa-grad-ends">
        <span>{g.start === 0 ? 'Head' : pct(g.start)}</span>
        <span>{g.end === 1 ? 'Tail' : pct(g.end)}</span>
      </div>
      {stop && (
        <div className="sa-row sa-wrap sa-grad-stop-edit">
          <label className="sa-num" title="This stop's colour">
            Colour
            <input
              type="color"
              value={stop.color}
              onChange={(e) =>
                editStops((s) => void (s[i].color = e.target.value))
              }
            />
          </label>
          <NumberField
            label="Opacity %"
            value={Math.round(stop.opacity * 100)}
            min={0}
            max={100}
            onChange={(v) =>
              editStops(
                (s) =>
                  void (s[i].opacity = Math.max(0, Math.min(100, v)) / 100),
              )
            }
          />
          <NumberField
            label="Location %"
            value={Math.round(stop.at * 100)}
            min={0}
            max={100}
            onChange={(v) =>
              editStops(
                (s) => void (s[i].at = Math.max(0, Math.min(100, v)) / 100),
              )
            }
          />
          <button
            className="sa-danger"
            disabled={g.stops.length <= 2}
            title="Remove this stop (a gradient keeps at least two)"
            onClick={() => {
              editStops((s) => void s.splice(i, 1));
              setSel(0);
            }}
          >
            Delete stop
          </button>
        </div>
      )}
      <SliderField
        label="Starts at"
        value={g.start}
        min={-1}
        max={2}
        step={0.01}
        reset={0}
        format={pct}
        title="Where the gradient's left end falls along the body: 0% = tip of the head, 100% = end of the tail; it can sit past either end (double-click: 0%)"
        onChange={(v) => onEdit((x) => (x.start = v))}
      />
      <SliderField
        label="Ends at"
        value={g.end}
        min={-1}
        max={2}
        step={0.01}
        reset={1}
        format={pct}
        title="Where the gradient's right end falls along the body (double-click: 100%)"
        onChange={(v) => onEdit((x) => (x.end = v))}
      />
      <div className="sa-row">
        <button
          onClick={() =>
            onEdit((x) => x.stops.forEach((s) => (s.at = 1 - s.at)))
          }
          title="Flip the gradient end to end"
        >
          Reverse
        </button>
      </div>
    </div>
  );
}

/** The list of gradients, top first (applied in that order). */
export function GradientList({
  list,
  onChange,
}: {
  list: BossGradient[];
  onChange: (fn: (list: BossGradient[]) => void, noUndo?: boolean) => void;
}) {
  return (
    <>
      <div className="sa-note">
        Colour the body from head to tail, like a gradient overlay in Photoshop.
        They stack: each one mixes into the result of the ones above it. Fins
        take the colour where they attach.
      </div>
      {list.map((g, i) => (
        <GradientEditor
          key={i}
          g={g}
          index={i}
          count={list.length}
          onEdit={(fn, noUndo) => onChange((l) => fn(l[i]), noUndo)}
          onMove={(to) => onChange((l) => l.splice(to, 0, ...l.splice(i, 1)))}
          onRemove={() => onChange((l) => void l.splice(i, 1))}
        />
      ))}
      <div className="sa-row">
        <button onClick={() => onChange((l) => void l.push(newGradient()))}>
          + Gradient
        </button>
      </div>
    </>
  );
}
