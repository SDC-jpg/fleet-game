// ShipArt's VFX panel (purple) when an effect is selected in the Effects
// section: its frames, animation speed and looping (for all its tier versions,
// or only the one shown), and where its image comes from.

import { useState } from 'react';
import { ASSET_ROOT, type Assets, type ManifestEntry } from '../engine/assets';
import { FlipbookFields } from './fields';

export function EffectPanel({
  assets,
  sprite,
  tiers,
  readOnly,
  windowsRoot,
  onChangeEntries,
}: {
  assets: Assets;
  /** The sprite shown (this tier's version, e.g. "vfx.explosion.t2"). */
  sprite: string;
  /** Every tier version of this effect ("vfx.explosion", "vfx.explosion.t2"...). */
  tiers: string[];
  readOnly: boolean;
  windowsRoot: string | null;
  /** Change manifest entries (by sprite name). */
  onChangeEntries: (names: string[], fn: (e: ManifestEntry) => ManifestEntry) => void;
}) {
  const [allTiers, setAllTiers] = useState(true);
  const [copied, setCopied] = useState('');
  const entry = assets.entryOf(sprite);
  const s = assets.get(sprite);
  const files = assets.filesOf(sprite);
  const f0 = s.frames[0];

  const copyFolder = () => {
    const file = files[0];
    if (!file) return;
    const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    const path = windowsRoot ? `${windowsRoot}\\public\\assets\\${folder.split('/').join('\\')}` : `public/assets/${folder}`;
    navigator.clipboard?.writeText(path).then(
      () => setCopied(`Copied: ${path}`),
      () => setCopied(path),
    );
  };

  return (
    <aside className="sa-vfx">
      <h2>VFX</h2>
      <div className="sa-sub">{sprite}</div>
      <div className="sa-note">
        {s.frames.length} frame{s.frames.length === 1 ? '' : 's'}, {f0.w}×{f0.h} px
      </div>
      <fieldset disabled={readOnly || !entry}>
        <div className="sa-sub">Flipbook</div>
        <FlipbookFields
          fps={entry?.fps ?? 12}
          loop={entry?.loop ?? true}
          onChange={(patch) => onChangeEntries(allTiers ? tiers : [sprite], (e) => ({ ...e, ...patch }))}
        />
        {tiers.length > 1 && (
          <div className="sa-row sa-wrap">
            Apply to
            <button className={allTiers ? 'on' : ''} onClick={() => setAllTiers(true)}>
              All {tiers.length} tiers
            </button>
            <button className={!allTiers ? 'on' : ''} onClick={() => setAllTiers(false)}>
              Only this tier
            </button>
          </div>
        )}
      </fieldset>

      <div className="sa-sub">Image</div>
      {files.slice(0, 3).map((f) => (
        <div key={f} className="sa-note sa-file">
          {f}
        </div>
      ))}
      {files.length > 3 && <div className="sa-note">… and {files.length - 3} more frames</div>}
      {files[0] && (
        <div className="sa-row">
          <button onClick={() => window.open(ASSET_ROOT + files[0], '_blank')}>Open image</button>
          <button onClick={copyFolder} title="Paste it into File Explorer's address bar">
            Copy folder path
          </button>
        </div>
      )}
      {copied && <div className="sa-note sa-file">{copied}</div>}
    </aside>
  );
}
