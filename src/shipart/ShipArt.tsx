// ShipArt: a tool for dressing up ship art without editing files by hand.
// Pick a ship tier on the left, preview it in any state in the middle, and
// place mounts (thrusters...) on it. Each mount has an image per state (or
// none: hidden in that state), position, rotation, mirroring, size, draw
// order, and a VFX point where its particles come from. Save writes
// public/assets/ships.json, which the game reads.
//
// Locally (npm run dev) it can edit and save. The published copy is view-only.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ASSET_ROOT, Assets } from '../engine/assets';
import {
  SHIP_STATES,
  fileSprite,
  loadShipLayouts,
  type Mount,
  type ShipLayout,
  type ShipLayoutsFile,
  type ShipState,
} from '../game/shipLayout';
import type { Team } from '../game/world';
import { Preview, mountState, type PreviewState } from './Preview';

/** Editing and saving only work with the dev server (npm run dev). */
const READ_ONLY = !import.meta.env.DEV;
const PREVIEW_STATES: PreviewState[] = ['idle', 'move', 'boost', 'dash'];
const ZOOMS = [1, 2, 3, 4, 6, 8];

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const emptyLayout = (): ShipLayout => ({ base: {}, mounts: [] });
/** "parts/thruster-boost-1.png" → "thruster-boost-1". */
const baseName = (file: string) => file.replace(/^.*\//, '').replace(/\.png$/i, '');
/** "parts/thruster-boost-1.png" → "thruster". */
const categoryOf = (file: string) => baseName(file).split('-')[0];
const label = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Load every image in the art folder (the list comes from the dev server, or from the published build). */
async function loadArtFiles(assets: Assets, data: ShipLayoutsFile): Promise<string[]> {
  const url = import.meta.env.DEV ? '/__shipart/files' : ASSET_ROOT + 'art-files.json';
  const files: string[] = (await (await fetch(url, { cache: 'no-store' })).json()).files;
  await Promise.all(files.map((f) => assets.loadFile(fileSprite(f), f, data.images[f])));
  return files;
}

export function ShipArt() {
  const [assets, setAssets] = useState<Assets | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [data, setData] = useState<ShipLayoutsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ship, setShip] = useState('ship.fighter');
  const [state, setState] = useState<PreviewState>('idle');
  const [zoom, setZoom] = useState(4);
  const [spin, setSpin] = useState(false);
  const [fly, setFly] = useState(true);
  const [team, setTeam] = useState<Team>('player');
  const [guides, setGuides] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [history, setHistory] = useState<ShipLayoutsFile[]>([]);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('');
  /** What the arrow keys move: the selected mount, or its VFX point. */
  const [nudge, setNudge] = useState<'mount' | 'vfx'>('mount');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<Preview | null>(null);
  // The latest data, for the preview's mouse events (which outlive renders).
  const dataRef = useRef(data);
  dataRef.current = data;

  // Load the art, the layouts and the list of art files.
  useEffect(() => {
    (async () => {
      const a = await Assets.load();
      const d = await loadShipLayouts(a);
      const f = await loadArtFiles(a, d);
      setAssets(a);
      setData(d);
      setFiles(f);
    })().catch((e: Error) => setError(e.message));
  }, []);

  /** Ships to choose from: every ship sprite in the manifest ("ship.fighter", "ship.fighter.t2"...). */
  const ships = useMemo(
    () => (assets ? assets.names().filter((n) => /^ship\.[a-z]+(\.t\d+)?$/.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })) : []),
    [assets],
  );
  const layout = data?.ships[ship] ?? emptyLayout();
  const mount = selected !== null ? layout.mounts[selected] : undefined;
  const categories = useMemo(() => [...new Set(files.filter((f) => f.startsWith('parts/')).map(categoryOf))], [files]);
  const shipFiles = files.filter((f) => f.startsWith('ships/'));

  /** Change the data (saving an undo step first unless `noUndo`). */
  const change = useCallback((fn: (d: ShipLayoutsFile) => void, noUndo = false) => {
    const current = dataRef.current;
    if (!current || READ_ONLY) return;
    const next = clone(current);
    next.ships[ship] ??= emptyLayout();
    fn(next);
    if (!noUndo) setHistory((h) => [...h.slice(-99), current]);
    setData(next);
    setDirty(true);
  }, [ship]);
  const changeMount = (fn: (m: Mount) => void, noUndo = false) =>
    selected !== null && change((d) => fn(d.ships[ship].mounts[selected]), noUndo);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      setData(h[h.length - 1]);
      setDirty(true);
      return h.slice(0, -1);
    });
  }, []);

  const save = useCallback(async () => {
    const current = dataRef.current;
    if (!current || READ_ONLY) return;
    setStatus('Saving…');
    try {
      const res = await fetch('/__shipart/save', { method: 'POST', body: JSON.stringify(current) });
      if (!res.ok) throw new Error(await res.text());
      setDirty(false);
      setStatus(`Saved ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setStatus(`Not saved: ${(e as Error).message}`);
    }
  }, []);

  // Start the preview once everything has loaded.
  useEffect(() => {
    if (!assets || !data || !canvasRef.current || !overlayRef.current || previewRef.current) return;
    previewRef.current = new Preview(
      canvasRef.current,
      overlayRef.current,
      assets,
      { data, ship, state, zoom, spin, fly, team, guides, selected, readOnly: READ_ONLY },
      {
        select: (i) => setSelected(i),
        dragStart: () => {
          const current = dataRef.current;
          if (current) setHistory((h) => [...h.slice(-99), current]);
        },
        moveMount: (i, x, y) => {
          setNudge('mount');
          setData((d) => {
            if (!d) return d;
            const next = clone(d);
            const m = next.ships[previewRef.current!.settings.ship].mounts[i];
            m.x = x;
            m.y = y;
            return next;
          });
          setDirty(true);
        },
        moveVfx: (i, x, y) => {
          setNudge('vfx');
          setData((d) => {
            if (!d) return d;
            const next = clone(d);
            const m = next.ships[previewRef.current!.settings.ship].mounts[i];
            m.vfxX = x;
            m.vfxY = y;
            return next;
          });
          setDirty(true);
        },
        hover: setHover,
      },
    );
    return () => {
      previewRef.current?.destroy();
      previewRef.current = null;
    };
    // The preview is created once; settings are passed in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, data !== null]);

  // Keep the preview's settings up to date.
  useEffect(() => {
    if (previewRef.current && data)
      previewRef.current.settings = { data, ship, state, zoom, spin, fly, team, guides, selected, readOnly: READ_ONLY };
  }, [data, ship, state, zoom, spin, fly, team, guides, selected]);

  // Switching ships, or turning spin/fly off, puts the ship back in the middle facing right.
  useEffect(() => previewRef.current?.resetPosition(), [ship, spin, fly]);
  useEffect(() => setSelected(null), [ship]);

  // Keyboard: arrows nudge (Shift = 5 px), Delete removes, Ctrl+Z undoes, Ctrl+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
        return;
      }
      if (selected === null || READ_ONLY) return;
      const step = e.shiftKey ? 5 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) {
        e.preventDefault();
        change((data) => {
          const m = data.ships[ship].mounts[selected];
          if (nudge === 'vfx') {
            m.vfxX += d[0];
            m.vfxY += d[1];
          } else {
            m.x += d[0];
            m.y += d[1];
          }
        });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        change((data) => data.ships[ship].mounts.splice(selected, 1));
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, ship, nudge, change, undo, save]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  /** Images a mount of this category can use, the ones named for `state` first ("thruster-boost-…" for boost). */
  const imagesFor = (category: string, state: ShipState) =>
    files
      .filter((f) => f.startsWith('parts/') && categoryOf(f) === category)
      .sort((a, b) => Number(baseName(b).includes(`-${state}`)) - Number(baseName(a).includes(`-${state}`)) || a.localeCompare(b));

  const addMount = (category: string) => {
    const m: Mount = {
      category,
      x: 0,
      y: 0,
      angle: 0,
      flipX: false,
      flipY: false,
      scale: 1,
      behind: true,
      vfxX: 0,
      vfxY: 0,
      images: {},
    };
    // Start with an image for the state being previewed (or move, from idle), named for that state if there is one.
    const s: ShipState = mountState(state) === 'idle' && category === 'thruster' ? 'move' : mountState(state);
    const img = imagesFor(category, s)[0];
    if (img) m.images[s] = img;
    change((d) => d.ships[ship].mounts.push(m));
    setSelected(layout.mounts.length);
    setNudge('mount');
  };

  /** Copy another ship's layout onto this one, with positions scaled by how much bigger this ship's image is. */
  const copyFrom = (from: string) => {
    if (!assets || !data?.ships[from]) return;
    const k = assets.get(ship).frames[0].w / assets.get(from).frames[0].w;
    change((d) => {
      const copy = clone(d.ships[from]);
      for (const m of copy.mounts) {
        m.x = Math.round(m.x * k);
        m.y = Math.round(m.y * k);
        m.vfxX = Math.round(m.vfxX * k);
        m.vfxY = Math.round(m.vfxY * k);
      }
      d.ships[ship] = copy;
    });
    setSelected(null);
  };

  if (error) return <div className="shipart-message">Couldn't start ShipArt: {error}</div>;

  // The image shown for the selected mount in the current state (its animation settings can be edited).
  const shownImage = mount?.images[mountState(state)];
  const shownSettings = shownImage ? (data?.images[shownImage] ?? {}) : null;
  const setImageSettings = (patch: { frames?: number; fps?: number }) => {
    if (!shownImage || !assets) return;
    const next = { ...(data?.images[shownImage] ?? {}), ...patch };
    change((d) => (d.images[shownImage] = next));
    assets.loadFile(fileSprite(shownImage), shownImage, next);
  };

  return (
    <div className="shipart">
      <header className="sa-top">
        <h1>ShipArt</h1>
        <div className="sa-group">
          {PREVIEW_STATES.map((s) => (
            <button key={s} className={state === s ? 'on' : ''} onClick={() => setState(s)}>
              {label(s)}
            </button>
          ))}
        </div>
        <div className="sa-group">
          Zoom
          {ZOOMS.map((z) => (
            <button key={z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>
              {z}×
            </button>
          ))}
        </div>
        <div className="sa-group">
          <button className={fly ? 'on' : ''} onClick={() => setFly(!fly)} title="Fly forward, so particles trail like in the game">
            Fly
          </button>
          <button className={spin ? 'on' : ''} onClick={() => setSpin(!spin)} title="Turn slowly, to check every angle">
            Spin
          </button>
          <button onClick={() => setTeam(team === 'player' ? 'enemy' : 'player')} title="Team colours">
            {team === 'player' ? 'Player' : 'Enemy'}
          </button>
          <button className={guides ? 'on' : ''} onClick={() => setGuides(!guides)} title="Outlines and VFX points">
            Guides
          </button>
        </div>
        <div className="sa-spacer" />
        {READ_ONLY ? (
          <span className="sa-note">View only. Editing works in the local copy (npm run dev).</span>
        ) : (
          <>
            <span className="sa-note">{dirty ? 'Unsaved changes' : status}</span>
            <button onClick={undo} disabled={!history.length} title="Ctrl+Z">
              Undo
            </button>
            <button className="sa-save" onClick={save} disabled={!dirty} title="Ctrl+S">
              Save
            </button>
          </>
        )}
      </header>

      <aside className="sa-left">
        <h2>Ships</h2>
        {ships.map((s) => (
          <button key={s} className={'sa-ship' + (ship === s ? ' on' : '')} onClick={() => setShip(s)}>
            {s.replace(/^ship\./, '')}
          </button>
        ))}
        {data && (
          <fieldset disabled={READ_ONLY}>
            <h2>Base image</h2>
            {SHIP_STATES.map((s) => (
              <label key={s} className="sa-row">
                <span>{label(s)}</span>
                <select
                  value={layout.base[s] ?? ''}
                  onChange={(e) =>
                    change((d) => {
                      if (e.target.value) d.ships[ship].base[s] = e.target.value;
                      else delete d.ships[ship].base[s];
                    })
                  }
                >
                  <option value="">{s === 'idle' ? 'Normal image' : 'Same as idle'}</option>
                  {shipFiles.map((f) => (
                    <option key={f} value={f}>
                      {baseName(f)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <h2>Copy layout from</h2>
            <select value="" onChange={(e) => e.target.value && copyFrom(e.target.value)}>
              <option value="">Choose a ship…</option>
              {ships
                .filter((s) => s !== ship && data.ships[s]?.mounts.length)
                .map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/^ship\./, '')} (positions scaled)
                  </option>
                ))}
            </select>
          </fieldset>
        )}
      </aside>

      <main className="sa-view">
        <canvas ref={canvasRef} />
        <canvas ref={overlayRef} className="sa-overlay" />
        {!assets && <div className="shipart-message">Loading…</div>}
        <div className="sa-hint">
          {hover ? `x ${hover.x}, y ${hover.y}` : ''} · Drag a mount or its pink VFX point · Arrows nudge (Shift = 5 px) · Delete removes
        </div>
      </main>

      <aside className="sa-right">
        <fieldset disabled={READ_ONLY}>
          <h2>Mounts</h2>
          <div className="sa-mounts">
            {layout.mounts.map((m, i) => (
              <button key={i} className={'sa-mount' + (selected === i ? ' on' : '')} onClick={() => setSelected(i)}>
                {label(m.category)} {i + 1}
                <span className="sa-note">
                  {' '}
                  {SHIP_STATES.filter((s) => m.images[s]).join(', ') || 'hidden'}
                </span>
              </button>
            ))}
            {layout.mounts.length === 0 && <div className="sa-note">No mounts on this ship yet.</div>}
          </div>
          <div className="sa-row">
            <span>Add</span>
            {categories.map((c) => (
              <button key={c} onClick={() => addMount(c)}>
                + {label(c)}
              </button>
            ))}
          </div>

          {mount && (
            <div className="sa-mount-edit">
              <h2>
                {label(mount.category)} {selected! + 1}
              </h2>
              <div className="sa-sub">Shows in</div>
              {SHIP_STATES.map((s) => {
                const options = imagesFor(mount.category, s);
                return (
                  <label key={s} className="sa-row">
                    <input
                      type="checkbox"
                      checked={!!mount.images[s]}
                      onChange={(e) =>
                        changeMount((m) => {
                          if (e.target.checked) m.images[s] = options[0];
                          else delete m.images[s];
                        })
                      }
                    />
                    <span>{label(s)}</span>
                    <select
                      value={mount.images[s] ?? ''}
                      disabled={!mount.images[s]}
                      onChange={(e) => changeMount((m) => (m.images[s] = e.target.value))}
                    >
                      {!mount.images[s] && <option value="">Hidden</option>}
                      {options.map((f) => (
                        <option key={f} value={f}>
                          {baseName(f)}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}

              <div className="sa-sub">Placement</div>
              <div className="sa-row">
                <NumberField label="x" value={mount.x} onChange={(v) => changeMount((m) => (m.x = v))} />
                <NumberField label="y" value={mount.y} onChange={(v) => changeMount((m) => (m.y = v))} />
              </div>
              <div className="sa-row">
                <NumberField label="Angle" value={mount.angle} step={15} onChange={(v) => changeMount((m) => (m.angle = v))} />
                <NumberField label="Size" value={mount.scale} step={0.5} min={0.5} onChange={(v) => changeMount((m) => (m.scale = v))} />
              </div>
              <div className="sa-row">
                <label>
                  <input type="checkbox" checked={mount.flipX} onChange={(e) => changeMount((m) => (m.flipX = e.target.checked))} /> Mirror ↔
                </label>
                <label>
                  <input type="checkbox" checked={mount.flipY} onChange={(e) => changeMount((m) => (m.flipY = e.target.checked))} /> Mirror ↕
                </label>
              </div>
              <label className="sa-row">
                <input type="checkbox" checked={mount.behind} onChange={(e) => changeMount((m) => (m.behind = e.target.checked))} /> Behind the ship
              </label>

              <div className="sa-sub">VFX point (from the mount's centre)</div>
              <div className="sa-row">
                <NumberField label="x" value={mount.vfxX} onChange={(v) => changeMount((m) => (m.vfxX = v))} />
                <NumberField label="y" value={mount.vfxY} onChange={(v) => changeMount((m) => (m.vfxY = v))} />
              </div>
              <button
                onClick={() =>
                  changeMount((m) => {
                    m.vfxX = 0;
                    m.vfxY = 0;
                  })
                }
              >
                Reset VFX point to centre
              </button>

              {shownImage && shownSettings && (
                <>
                  <div className="sa-sub">Animation of {baseName(shownImage)}</div>
                  <div className="sa-row">
                    <NumberField label="Frames" value={shownSettings.frames ?? 1} min={1} onChange={(v) => setImageSettings({ frames: Math.max(1, Math.round(v)) })} />
                    <NumberField label="FPS" value={shownSettings.fps ?? 12} min={1} onChange={(v) => setImageSettings({ fps: v })} />
                  </div>
                </>
              )}

              <div className="sa-row sa-actions">
                <button
                  onClick={() => {
                    change((d) => d.ships[ship].mounts.push({ ...clone(mount), x: mount.x, y: mount.y + 4 }));
                    setSelected(layout.mounts.length);
                  }}
                >
                  Duplicate
                </button>
                <button
                  title="A copy on the other side (top ↔ bottom), mirrored"
                  onClick={() => {
                    change((d) => d.ships[ship].mounts.push({ ...clone(mount), y: -mount.y, vfxY: -mount.vfxY, flipY: !mount.flipY }));
                    setSelected(layout.mounts.length);
                  }}
                >
                  Mirror copy
                </button>
                <button
                  className="sa-danger"
                  onClick={() => {
                    change((d) => d.ships[ship].mounts.splice(selected!, 1));
                    setSelected(null);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </fieldset>
      </aside>
    </div>
  );
}

/** A small labelled number box. */
function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="sa-num">
      {label}
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}
