// ShipArt's VFX panel (purple) when an effect is selected in the Effects
// section: its frames, animation speed and looping (for all its tier versions,
// or only the one shown), and where its image comes from: another PNG in the
// art folder, or a zip of PNG frames (unpacked by the dev server).

import { useState } from 'react';
import { NumberField, SliderField } from './fields';
import { ASSET_ROOT, type Assets, type ManifestEntry } from '../engine/assets';
import { FlipbookFields } from './fields';
import { DEFAULT_GLOW, GLOW_MODES, GLOW_MODE_LABELS, type Glow } from '../engine/glow';

export function EffectPanel({
  assets,
  sprite,
  tiers,
  readOnly,
  windowsRoot,
  artFiles,
  onChangeEntries,
  onChangeGlow,
  onFilesChanged,
}: {
  assets: Assets;
  /** The sprite shown (this tier's version, e.g. "vfx.explosion.t2"). */
  sprite: string;
  /** Every tier version of this effect ("vfx.explosion", "vfx.explosion.t2"...). */
  tiers: string[];
  readOnly: boolean;
  windowsRoot: string | null;
  /** Every PNG in the art folder (for "Use another image"). */
  artFiles: string[];
  /** Change manifest entries (by sprite name). */
  onChangeEntries: (names: string[], fn: (e: ManifestEntry) => ManifestEntry) => void;
  /** Change these sprites' glow (undefined = none). Quick slider moves make one undo step. */
  onChangeGlow: (names: string[], fn: (g: Glow | undefined) => Glow | undefined) => void;
  /** New files were added to the art folder (a zip import): refresh the file list. */
  onFilesChanged: () => void;
}) {
  const [allTiers, setAllTiers] = useState(true);
  const [copied, setCopied] = useState('');
  const [pick, setPick] = useState('');
  const [pickFrames, setPickFrames] = useState(1);
  const [message, setMessage] = useState('');
  const entry = assets.entryOf(sprite);
  const s = assets.get(sprite);
  const files = assets.filesOf(sprite);
  const f0 = s.frames[0];
  const glow = entry?.glow;
  const editGlow = (fn: (g: Glow | undefined) => Glow | undefined) => onChangeGlow(allTiers ? tiers : [sprite], fn);

  /** Keep the anchor only if the frame size stays the same (a new size gets the centre). */
  const keepAnchor = (e: ManifestEntry, w: number, h: number) =>
    w === f0.w && h === f0.h ? { anchorX: e.anchorX, anchorY: e.anchorY } : {};

  /** Point this effect at another PNG with `frames` frames side by side. */
  const useImage = async () => {
    if (!pick) return;
    const img = new Image();
    img.src = ASSET_ROOT + pick;
    try {
      await img.decode();
    } catch {
      setMessage(`Couldn't load ${pick}`);
      return;
    }
    const n = Math.max(1, Math.round(pickFrames));
    const w = Math.floor(img.width / n);
    onChangeEntries([sprite], (e) => ({ file: pick, frameWidth: w, frameHeight: img.height, frames: n, fps: e.fps, loop: e.loop, glow: e.glow, ...keepAnchor(e, w, img.height) }));
    setMessage(`Now using ${pick} (${n} frame${n === 1 ? '' : 's'} of ${w}×${img.height}). Save to keep it.`);
  };

  /**
   * The dev server notices new files in the art folder on a timer, so right
   * after an import the frames may not be served yet: wait until they are.
   */
  const waitForFiles = async (list: string[]) => {
    for (let tries = 0; tries < 25; tries++) {
      const ready = await Promise.all(
        list.map((f) =>
          fetch(ASSET_ROOT + f, { cache: 'no-store' })
            .then((r) => r.ok && (r.headers.get('content-type') ?? '').startsWith('image/'))
            .catch(() => false),
        ),
      );
      if (ready.every(Boolean)) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  /** Unpack a zip of PNG frames (dev server) and point this effect at them. */
  const importZip = async (zip: File) => {
    setMessage('Importing…');
    try {
      const res = await fetch(`/__shipart/import-zip?name=${encodeURIComponent(sprite)}`, { method: 'POST', body: zip });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      await waitForFiles(out.files);
      onChangeEntries([sprite], (e) => ({ files: out.files, fps: e.fps, loop: e.loop, glow: e.glow, ...keepAnchor(e, out.width, out.height) }));
      onFilesChanged();
      setMessage(`Imported ${out.files.length} frames (${out.width}×${out.height}) into ${out.files[0].replace(/\/[^/]*$/, '/')}. Save to keep using them.`);
    } catch (e) {
      setMessage(`Not imported: ${(e as Error).message}`);
    }
  };

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

      <fieldset disabled={readOnly || !entry}>
        <div className="sa-sub">Glow{tiers.length > 1 ? (allTiers ? ' (all tiers)' : ' (this tier)') : ''}</div>
        {!glow ? (
          <div className="sa-row">
            <button onClick={() => editGlow(() => ({ ...DEFAULT_GLOW }))} title="A soft glow behind this effect, following its outline">
              + Glow
            </button>
          </div>
        ) : (
          <>
            <div className="sa-row">
              <label title="Switch the glow off without losing its settings">
                <input type="checkbox" checked={!glow.hidden} onChange={(e) => editGlow((g) => ({ ...g!, hidden: e.target.checked ? undefined : true }))} /> Show
              </label>
              <button onClick={() => editGlow(() => undefined)}>Remove glow</button>
            </div>
            <div className="sa-row">
              <span>Colour</span>
              <input type="color" value={glow.color} onChange={(e) => editGlow((g) => ({ ...g!, color: e.target.value }))} />
              <span>Mode</span>
              <select value={glow.mode} onChange={(e) => editGlow((g) => ({ ...g!, mode: e.target.value as Glow['mode'] }))}>
                {GLOW_MODES.map((m) => (
                  <option key={m} value={m}>
                    {GLOW_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <SliderField
              label="Opacity"
              value={glow.opacity}
              min={0}
              max={1}
              step={0.01}
              reset={DEFAULT_GLOW.opacity}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => editGlow((g) => ({ ...g!, opacity: v }))}
            />
            <SliderField
              label="Spread"
              value={glow.spread}
              min={0}
              max={30}
              step={0.5}
              reset={DEFAULT_GLOW.spread}
              format={(v) => `${v} px`}
              title="How far the glow stays solid around the image before it fades (game pixels; double-click to reset)"
              onChange={(v) => editGlow((g) => ({ ...g!, spread: v }))}
            />
            <SliderField
              label="Softness"
              value={glow.softness}
              min={0}
              max={60}
              step={0.5}
              reset={DEFAULT_GLOW.softness}
              format={(v) => `${v} px`}
              title="How far it fades out beyond that (game pixels; double-click to reset)"
              onChange={(v) => editGlow((g) => ({ ...g!, softness: v }))}
            />
          </>
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

      <fieldset disabled={readOnly || !entry}>
        <div className="sa-sub">Image source (this tier)</div>
        <div className="sa-row">
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Use another PNG…</option>
            {artFiles.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div className="sa-row">
          <NumberField label="Frames in it" value={pickFrames} min={1} onChange={setPickFrames} />
          <button disabled={!pick} onClick={useImage}>
            Use
          </button>
        </div>
        <label className="sa-row sa-zip" title="A zip of PNG frames, all the same size, in name order">
          <span className="sa-button-like">Import zip of PNG frames…</span>
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => {
              const zip = e.target.files?.[0];
              if (zip) importZip(zip);
              e.target.value = '';
            }}
          />
        </label>
        {message && <div className="sa-note sa-file">{message}</div>}
      </fieldset>
    </aside>
  );
}
