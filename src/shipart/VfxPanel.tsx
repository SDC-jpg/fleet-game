// ShipArt's VFX panel (purple): everything about the effects coming from the
// selected mount. Its VFX point, and its particles for each state (image,
// spawn rate, life, speed, drag), with a preview of the particle image.
// More VFX settings will be added here.

import { useEffect, useRef, useState } from 'react';
import { ASSET_ROOT, frameAt, type Assets } from '../engine/assets';
import { PARTICLE_STATES, particleSettings, type Mount, type ParticleSettings, type ParticleState } from '../game/shipLayout';
import type { PreviewState } from './Preview';
import { NumberField } from './fields';

const BACKGROUNDS = { black: '#000000', gray: '#808080', white: '#ffffff' } as const;
type Background = keyof typeof BACKGROUNDS;

/** The particle settings that can be edited, in panel order (more can be added here). */
const FIELDS: { key: Exclude<keyof ParticleSettings, 'sprite'>; label: string; step: number; min: number; max?: number; hint: string }[] = [
  { key: 'perSecond', label: 'Spawn rate', step: 1, min: 0, hint: 'particles per second' },
  { key: 'life', label: 'Life', step: 0.05, min: 0.05, hint: 'seconds' },
  { key: 'speed', label: 'Speed', step: 5, min: 0, hint: 'pixels per second' },
  { key: 'drag', label: 'Drag', step: 0.5, min: 0, hint: '0 = never slows down' },
  { key: 'angle', label: 'Angle', step: 15, min: 0, max: 360, hint: 'width of the spawn cone in degrees: 0 = a straight line, 360 = every direction' },
];

const label = (s: string) => s[0].toUpperCase() + s.slice(1);

export function VfxPanel({
  assets,
  mount,
  previewState,
  readOnly,
  windowsRoot,
  onChange,
}: {
  assets: Assets;
  mount: Mount | undefined;
  previewState: PreviewState;
  readOnly: boolean;
  /** The project folder on Windows (from the dev server), for "Copy folder path". */
  windowsRoot: string | null;
  /** Change the selected mount. */
  onChange: (fn: (m: Mount) => void) => void;
}) {
  // Which state's particles are shown: follows the preview (Dash uses Move), but can be switched here.
  const follow: ParticleState = previewState === 'boost' ? 'boost' : 'move';
  const [tab, setTab] = useState<ParticleState>(follow);
  useEffect(() => setTab(follow), [follow]);
  const [bg, setBg] = useState<Background>('black');
  const [copied, setCopied] = useState('');

  if (!mount)
    return (
      <aside className="sa-vfx">
        <h2>VFX</h2>
        <div className="sa-note">Select a mount to edit its effects.</div>
      </aside>
    );

  const settings = particleSettings(mount, tab);
  const own = mount.vfx?.[tab] ?? {};
  const shows = !!mount.images[tab];
  const particleSprites = assets.names().filter((n) => n.startsWith('vfx.particle.')).sort();
  const file = assets.fileOf(settings.sprite);

  const set = <K extends keyof ParticleSettings>(key: K, value: ParticleSettings[K]) =>
    onChange((m) => {
      m.vfx ??= {};
      m.vfx[tab] = { ...m.vfx[tab], [key]: value };
    });

  const copyFolder = () => {
    if (!file) return;
    const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    const path = windowsRoot
      ? `${windowsRoot}\\public\\assets\\${folder.split('/').join('\\')}`
      : `public/assets/${folder}`;
    navigator.clipboard?.writeText(path).then(
      () => setCopied(`Copied: ${path}`),
      () => setCopied(path),
    );
  };

  return (
    <aside className="sa-vfx">
      <fieldset disabled={readOnly}>
        <h2>VFX</h2>

        <div className="sa-sub">VFX point (from the mount's centre)</div>
        <div className="sa-row">
          <NumberField label="x" value={mount.vfxX} onChange={(v) => onChange((m) => (m.vfxX = v))} />
          <NumberField label="y" value={mount.vfxY} onChange={(v) => onChange((m) => (m.vfxY = v))} />
        </div>
        <button
          onClick={() =>
            onChange((m) => {
              m.vfxX = 0;
              m.vfxY = 0;
            })
          }
        >
          Reset VFX point to centre
        </button>

        {mount.category === 'thruster' && (
          <>
            <div className="sa-sub">Particles</div>
            <div className="sa-row">
              {PARTICLE_STATES.map((s) => (
                <button key={s} className={tab === s ? 'on' : ''} onClick={() => setTab(s)}>
                  {label(s)}
                </button>
              ))}
            </div>
            {!shows && <div className="sa-note">This mount is hidden in {label(tab)}, so it gives off no particles then.</div>}

            <label className="sa-row">
              <span>Image</span>
              <select value={settings.sprite} onChange={(e) => set('sprite', e.target.value)}>
                {particleSprites.map((n) => (
                  <option key={n} value={n}>
                    {n.replace('vfx.particle.', '')}
                  </option>
                ))}
              </select>
            </label>
            {FIELDS.map((f) => (
              <div key={f.key} className="sa-row" title={f.hint}>
                <NumberField
                  label={f.label}
                  value={settings[f.key]}
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  onChange={(v) => set(f.key, Math.min(f.max ?? Infinity, Math.max(f.min, v)))}
                />
                <span className="sa-note sa-default">{own[f.key] === undefined ? 'default' : ''}</span>
              </div>
            ))}
            <button
              disabled={!mount.vfx?.[tab]}
              onClick={() =>
                onChange((m) => {
                  if (m.vfx) delete m.vfx[tab];
                })
              }
              title={`Back to the defaults in CONFIG.particles.${tab}`}
            >
              Reset {label(tab)} particles to defaults
            </button>
          </>
        )}
      </fieldset>

      {mount.category === 'thruster' && (
        <>
          <div className="sa-sub">Particle image</div>
          <ParticleImage assets={assets} sprite={settings.sprite} background={BACKGROUNDS[bg]} />
          <div className="sa-row">
            {(Object.keys(BACKGROUNDS) as Background[]).map((b) => (
              <button key={b} className={bg === b ? 'on' : ''} onClick={() => setBg(b)}>
                {label(b)}
              </button>
            ))}
          </div>
          {file && (
            <>
              <div className="sa-note sa-file">{file}</div>
              <div className="sa-row">
                <button onClick={() => window.open(ASSET_ROOT + file, '_blank')}>Open image</button>
                <button onClick={copyFolder} title="Paste it into File Explorer's address bar">
                  Copy folder path
                </button>
              </div>
              {copied && <div className="sa-note sa-file">{copied}</div>}
            </>
          )}
        </>
      )}
    </aside>
  );
}

/** The particle's flipbook, enlarged and looping, on the chosen background. */
function ParticleImage({ assets, sprite, background }: { assets: Assets; sprite: string; background: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let handle = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const c = ref.current;
      if (c) {
        const ctx = c.getContext('2d')!;
        const s = assets.get(sprite);
        // Loop the flipbook in the top part, with a brief pause on an empty frame so the restart is visible.
        const length = s.fps > 0 ? s.frames.length / s.fps : 1;
        // (The first frame's timestamp can be a hair before `start`, so never below 0.)
        const t = (Math.max(0, now - start) / 1000) % (length + 0.12);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, c.width, c.height);
        const f0 = s.frames[0];
        const big = Math.max(1, Math.floor(Math.min(c.width / f0.w, 62 / f0.h) * 0.7));
        if (t < length) {
          const f = frameAt(s, t);
          ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, (c.width - f.w * big) / 2, (66 - f.h * big) / 2, f.w * big, f.h * big);
        }
        // Every frame side by side underneath, in order.
        const n = s.frames.length;
        const small = Math.max(1, Math.floor(Math.min((c.width - 8) / (n * (f0.w + 2)), 22 / f0.h)));
        const rowW = n * (f0.w + 2) * small;
        s.frames.forEach((f, i) => {
          const x = (c.width - rowW) / 2 + i * (f0.w + 2) * small;
          ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, x, 70, f.w * small, f.h * small);
        });
      }
      handle = requestAnimationFrame(draw);
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [assets, sprite, background]);
  return <canvas ref={ref} width={160} height={96} className="sa-particle" />;
}
