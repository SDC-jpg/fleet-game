// ShipArt's Volume section (ships only): the guessed 3D shape the ship banks and pitches with
// (engine/tilt.ts), saved per ship in art.json `volume`. Try it with the toolbar's 3D sliders.

import { DEFAULT_VOLUME, type VolumeShape } from '../engine/tilt';
import { SliderField } from './fields';

export function VolumePanel({ shape, onChange }: { shape: VolumeShape | undefined; onChange: (v: VolumeShape | undefined) => void }) {
  const v = shape ?? DEFAULT_VOLUME;
  const set = (patch: Partial<VolumeShape>) => onChange({ ...v, ...patch });
  return (
    <>
      <h2>Volume (3D)</h2>
      <div className="sa-note">
        The 3D shape guessed from the outline, for banking and pitching (toolbar: 3D). {shape ? 'Own settings.' : 'Default settings.'}
      </div>
      <SliderField
        label="Height"
        value={v.height}
        min={0}
        max={2}
        step={0.05}
        reset={DEFAULT_VOLUME.height}
        format={(x) => x.toFixed(2)}
        title="How tall the hull is: 1 = as tall as half its thickest width (double-click: default)"
        onChange={(height) => set({ height })}
      />
      <SliderField
        label="Round"
        value={v.round}
        min={0}
        max={1}
        step={0.05}
        reset={DEFAULT_VOLUME.round}
        format={(x) => `${Math.round(x * 100)}%`}
        title="Cross-section: 0% = a wedge with straight slopes, 100% = round (double-click: default)"
        onChange={(round) => set({ round })}
      />
      <SliderField
        label="Spine"
        value={v.spine}
        min={0.3}
        max={3}
        step={0.05}
        reset={DEFAULT_VOLUME.spine}
        format={(x) => x.toFixed(2)}
        title="Above 1: flatter wings and edges, the spine stands out; below 1: fuller, like a pillow (double-click: default)"
        onChange={(spine) => set({ spine })}
      />
      {shape && (
        <div className="sa-row">
          <button onClick={() => onChange(undefined)}>Use default</button>
        </div>
      )}
    </>
  );
}
