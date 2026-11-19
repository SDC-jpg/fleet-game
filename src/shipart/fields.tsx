// Small form fields shared by ShipArt's panels.

/** A small labelled number box. */
export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="sa-num">
      {label}
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

/** Flipbook settings: frames (when they can be changed), animation speed and looping. */
export function FlipbookFields({
  frames,
  fps,
  loop,
  onChange,
}: {
  /** Frame count, or undefined when it's fixed by the art (shown elsewhere). */
  frames?: number;
  fps: number;
  loop: boolean;
  onChange: (patch: { frames?: number; fps?: number; loop?: boolean }) => void;
}) {
  return (
    <>
      <div className="sa-row">
        {frames !== undefined && (
          <NumberField label="Frames" value={frames} min={1} onChange={(v) => onChange({ frames: Math.max(1, Math.round(v)) })} />
        )}
        <NumberField label="Speed (FPS)" value={fps} min={1} onChange={(v) => onChange({ fps: Math.max(1, v) })} />
      </div>
      <label className="sa-row">
        <input type="checkbox" checked={loop} onChange={(e) => onChange({ loop: e.target.checked })} /> Loop
      </label>
    </>
  );
}

/** A labelled slider with its value. Double-click puts it back to `reset` (if given). */
export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  reset,
  title,
  format = (v) => String(v),
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  reset?: number;
  title?: string;
  format?: (v: number) => string;
}) {
  return (
    <label className="sa-slider" title={title ?? (reset !== undefined ? `Double-click to reset (${format(reset)})` : undefined)}>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => reset !== undefined && onChange(reset)}
      />
      <span className="sa-slider-value">{format(value)}</span>
    </label>
  );
}
