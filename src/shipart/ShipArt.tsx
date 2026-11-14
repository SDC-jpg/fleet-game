// ShipArt: a tool for dressing up ships and other objects (missiles...)
// without editing files by hand. Pick something in the rollout menu on the
// left, preview it in any of its states in the middle, and place mounts on it:
// images (thrusters, flames...) and particle emitters, each with an image and
// particles per state, position, rotation, mirroring, size, draw order, and a
// VFX point where particles come from. Objects also have named points (like
// a missile's impact point). Save writes public/assets/art.json, which the
// game reads.
//
// Locally (npm run dev) it can edit and save. The published copy is view-only.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Assets, type ManifestEntry } from '../engine/assets';
import { ROTATION_LABELS, ROTATION_MODES, type RotationMode } from '../engine/renderer';
import { ROTATION_SETTING, loadSetting, saveSetting } from '../engine/settings';
import {
  emptyLayout,
  fetchArtFileList,
  isFrameFolder,
  loadArtLayouts,
  loadLayoutImage,
  partImages,
  type ArtLayout,
  type ArtLayoutsFile,
  type Mount,
} from '../game/artLayout';
import { OBJECT_KINDS, SHIP_KIND, kindOf, tierOf, type ArtKind } from '../game/artKinds';
import { tierSprite } from '../game/render';
import type { Team } from '../game/world';
import { Preview } from './Preview';
import { NumberField } from './fields';
import { VfxPanel } from './VfxPanel';
import { EffectPanel } from './EffectPanel';

/** Editing and saving only work with the dev server (npm run dev). */
const READ_ONLY = !import.meta.env.DEV;
const ZOOMS = [1, 2, 3, 4, 6, 8];

/** The view, remembered in this browser so a reload comes back to the same place. */
interface SavedView {
  subject: string;
  states: Record<string, string>;
  zoom: number;
  spin: boolean;
  fly: boolean;
  team: Team;
  guides: boolean;
  effectBase: string | null;
  effectTier: number;
  selected: number | null;
  open: Record<string, boolean>;
}
const VIEW_SETTING = 'shipart.view';
const savedView: Partial<SavedView> = (() => {
  try {
    return JSON.parse(loadSetting(VIEW_SETTING) ?? '{}') ?? {};
  } catch {
    return {};
  }
})();
/** The mount category for particle-only mounts (no image). */
const EMITTER = 'emitter';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
/** Manifest entries changed in ShipArt but not saved yet, by sprite name. */
type Patch = Record<string, ManifestEntry>;
/** One undo step: the layouts and the unsaved manifest changes as they were. */
type Snapshot = { data: ArtLayoutsFile; patch: Patch };
/** "vfx.explosion.t3" → "vfx.explosion". */
const effectBaseOf = (name: string) => name.replace(/\.t\d+$/, '');
/** "parts/thruster-boost-1.png" → "thruster-boost-1" (a frame folder "parts/thruster-boost-3/" → "thruster-boost-3"). */
const baseName = (file: string) => file.replace(/\/$/, '').replace(/^.*\//, '').replace(/\.png$/i, '');
/** "parts/thruster-boost-1.png" → "thruster". */
const categoryOf = (file: string) => baseName(file).split('-')[0];
const label = (s: string) => s[0].toUpperCase() + s.slice(1);
/**
 * How a sprite is listed: ships by name ("fighter.t2"); objects, which sit
 * under their kind's heading, by tier ("Tier 3"; wrecks also by ship: "fighter tier 2").
 */
const shortName = (sprite: string) => {
  const k = kindOf(sprite);
  if (!k || k.section === 'ships') return sprite.replace(/^ship\./, '');
  return (k.id === 'wreck' ? `${sprite.split('.')[1]} tier ` : 'Tier ') + tierOf(sprite);
};

/**
 * Load every image in the art folder (the list comes from the dev server, or
 * from the published build). Each folder of frames in parts/ loads as one
 * animated image instead of its separate frames.
 */
async function loadArtFiles(assets: Assets, data: ArtLayoutsFile): Promise<string[]> {
  const files = await fetchArtFileList();
  const images = [...files.filter((f) => !f.startsWith('parts/')), ...partImages(files)];
  await Promise.all(images.map((f) => loadLayoutImage(assets, f, data.images[f], files)));
  return files;
}

export function ShipArt() {
  const [assets, setAssets] = useState<Assets | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [data, setData] = useState<ArtLayoutsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The sprite being edited ("ship.fighter", "projectile.missile.t2"...). */
  const [subject, setSubject] = useState(savedView.subject ?? 'ship.fighter');
  const kind: ArtKind = kindOf(subject) ?? SHIP_KIND;
  /** The preview state, remembered per kind (so switching between ships keeps Move, say). */
  const [states, setStates] = useState<Record<string, string>>(savedView.states ?? {});
  const state = states[kind.id] ?? kind.states[0].id;
  const setState = (s: string) => setStates((all) => ({ ...all, [kind.id]: s }));
  const [zoom, setZoom] = useState(ZOOMS.includes(savedView.zoom ?? 0) ? savedView.zoom! : 4);
  const [spin, setSpin] = useState(savedView.spin ?? false);
  const [fly, setFly] = useState(savedView.fly ?? true);
  const [team, setTeam] = useState<Team>(savedView.team ?? 'player');
  const [guides, setGuides] = useState(savedView.guides ?? true);
  // Stars on or off, remembered in this browser.
  const [stars, setStars] = useState(() => loadSetting('shipart.stars') !== 'off');
  // How rotated ships are drawn; shared with the game (same browser setting).
  const [rotation, setRotation] = useState<RotationMode>(() => {
    const r = loadSetting(ROTATION_SETTING) as RotationMode | null;
    return r && ROTATION_MODES.includes(r) ? r : 'grid';
  });
  const [selected, setSelected] = useState<number | null>(savedView.selected ?? null);
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  /** Manifest entries changed here (effect speed, loop...), saved to manifest.json with Save. */
  const [patch, setPatch] = useState<Patch>({});
  const patchRef = useRef(patch);
  patchRef.current = patch;
  /** Each changed entry as it was when last saved (for undo). */
  const baselineRef = useRef<Patch>({});
  /** The effect being shown (Effects section), by its base name, and which tier version. */
  const [effectBase, setEffectBase] = useState<string | null>(savedView.effectBase ?? null);
  const [effectTier, setEffectTier] = useState(savedView.effectTier ?? 1);
  /** Bumped when reloaded art has finished loading, so panels showing its size and frames update. */
  const [, setArtVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('');
  /** What the arrow keys move: the selected mount, or its VFX point. */
  const [nudge, setNudge] = useState<'mount' | 'vfx'>('mount');
  /** Rollout sections that are open, and the filter text. */
  const [open, setOpen] = useState<Record<string, boolean>>(savedView.open ?? { ships: true, objects: true });
  const [filter, setFilter] = useState('');
  /** The project folder on Windows, from the dev server (for "Copy folder path"). */
  const [windowsRoot, setWindowsRoot] = useState<string | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fetch('/__shipart/info')
      .then((r) => r.json())
      .then((info) => setWindowsRoot(info.windowsRoot ?? null))
      .catch(() => {});
  }, []);

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
      const d = await loadArtLayouts(a);
      const f = await loadArtFiles(a, d);
      // The remembered view may name art or a mount that is gone since.
      setSubject((sub) => {
        if (a.has(sub)) return sub;
        setSelected(null);
        return 'ship.fighter';
      });
      setEffectBase((e) => (e && (a.has(e) || a.has(`${e}.t2`)) ? e : null));
      setSelected((i) => {
        const sub = a.has(savedView.subject ?? '') ? savedView.subject! : 'ship.fighter';
        const k = kindOf(sub);
        return i !== null && k && i < (d[k.section][sub]?.mounts.length ?? 0) ? i : null;
      });
      setAssets(a);
      setData(d);
      setFiles(f);
    })().catch((e: Error) => setError(e.message));
  }, []);

  // Remember the view (once the art has loaded, so a startup fallback isn't saved over it too early).
  useEffect(() => {
    if (!assets) return;
    const view: SavedView = { subject, states, zoom, spin, fly, team, guides, effectBase, effectTier, selected, open };
    saveSetting(VIEW_SETTING, JSON.stringify(view));
  }, [assets, subject, states, zoom, spin, fly, team, guides, effectBase, effectTier, selected, open]);

  // Mouse wheel over the preview: zoom in (up) or out (down), one step at a time.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => {
        const i = ZOOMS.indexOf(z);
        return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (e.deltaY < 0 ? 1 : -1)))];
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [assets]);

  /** Every sprite of a kind (one per tier), in tier order. */
  const spritesOf = useCallback(
    (k: ArtKind) => (assets ? assets.names().filter(k.matches).sort((a, b) => tierOf(a) - tierOf(b) || a.localeCompare(b, 'en', { numeric: true })) : []),
    [assets],
  );
  const matchesFilter = (s: string) => !filter || s.toLowerCase().includes(filter.toLowerCase());
  const section = kind.section;
  const layout: ArtLayout = data?.[section][subject] ?? emptyLayout();
  const mount = selected !== null ? layout.mounts[selected] : undefined;
  /** Images mounts can use (a folder of frames counts as one). */
  const parts = useMemo(() => partImages(files), [files]);
  const categories = useMemo(() => [...new Set(parts.map(categoryOf))], [parts]);
  const baseFiles = files.filter((f) => f.startsWith(kind.baseFolder));
  const mountState = kind.states.find((s) => s.id === state)?.uses ?? state;

  /** Change the data (saving an undo step first unless `noUndo`). The current subject always has a layout to change. */
  const change = useCallback(
    (fn: (d: ArtLayoutsFile) => void, noUndo = false) => {
      const current = dataRef.current;
      if (!current || READ_ONLY) return;
      const next = clone(current);
      next[section][subject] ??= emptyLayout();
      fn(next);
      if (!noUndo) setHistory((h) => [...h.slice(-99), { data: current, patch: patchRef.current }]);
      setData(next);
      setDirty(true);
    },
    [section, subject],
  );

  /** Change manifest entries (effects): applied to the art right away, saved to manifest.json with Save. */
  const changeEntries = (names: string[], fn: (e: ManifestEntry) => ManifestEntry) => {
    const current = dataRef.current;
    if (!assets || !current || READ_ONLY) return;
    setHistory((h) => [...h.slice(-99), { data: current, patch: patchRef.current }]);
    const next = { ...patchRef.current };
    const loads: Promise<void>[] = [];
    for (const name of names) {
      const entry = next[name] ?? assets.entryOf(name);
      if (!entry) continue;
      baselineRef.current[name] ??= assets.entryOf(name)!;
      next[name] = fn({ ...entry });
      loads.push(assets.setEntry(name, next[name]));
    }
    Promise.all(loads).then(() => setArtVersion((v) => v + 1));
    setPatch(next);
    setDirty(true);
  };
  const changeMount = (fn: (m: Mount) => void, noUndo = false) =>
    selected !== null && change((d) => fn(d[section][subject].mounts[selected]), noUndo);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const back = h[h.length - 1];
      // Put back any effect entries this undoes.
      for (const name of new Set([...Object.keys(patchRef.current), ...Object.keys(back.patch)])) {
        const entry = back.patch[name] ?? baselineRef.current[name];
        if (entry && entry !== patchRef.current[name]) assets?.setEntry(name, entry).then(() => setArtVersion((v) => v + 1));
      }
      setData(back.data);
      setPatch(back.patch);
      setDirty(true);
      return h.slice(0, -1);
    });
  }, [assets]);

  const save = useCallback(async () => {
    const current = dataRef.current;
    if (!current || READ_ONLY) return;
    setStatus('Saving…');
    try {
      const res = await fetch('/__shipart/save', { method: 'POST', body: JSON.stringify(current) });
      if (!res.ok) throw new Error(await res.text());
      // Effect changes go into manifest.json.
      const changed = patchRef.current;
      if (Object.keys(changed).length) {
        const m = await fetch('/__shipart/manifest', { method: 'POST', body: JSON.stringify({ sprites: changed }) });
        if (!m.ok) throw new Error(await m.text());
        Object.assign(baselineRef.current, changed);
        setPatch({});
      }
      setDirty(false);
      setStatus(`Saved ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setStatus(`Not saved: ${(e as Error).message}`);
    }
  }, []);

  /** Every effect (each "vfx.*" sprite, tier versions grouped under one name). */
  const effects = useMemo(() => (assets ? [...new Set(assets.names().filter((n) => n.startsWith('vfx.')).map(effectBaseOf))].sort() : []), [assets]);
  /** The tier versions of the effect shown, and the one being shown. */
  const effectTiers = effectBase && assets ? [effectBase, ...[2, 3, 4, 5, 6].map((t) => `${effectBase}.t${t}`)].filter((n) => assets.has(n)) : [];
  const effect = effectBase && assets ? tierSprite(assets, effectBase, effectTier) : null;

  const previewSettings = () =>
    data && { data, subject, kind, state, effect, zoom, spin, fly, team, guides, stars, rotation, selected, selectedPoint, readOnly: READ_ONLY };

  // Start the preview once everything has loaded.
  useEffect(() => {
    const settings = previewSettings();
    if (!assets || !settings || !canvasRef.current || !overlayRef.current || previewRef.current) return;
    const edit = (fn: (l: ArtLayout) => void) => {
      const s = previewRef.current!.settings;
      setData((d) => {
        if (!d) return d;
        const next = clone(d);
        next[s.kind.section][s.subject] ??= emptyLayout();
        fn(next[s.kind.section][s.subject]);
        return next;
      });
      setDirty(true);
    };
    previewRef.current = new Preview(canvasRef.current, overlayRef.current, assets, settings, {
      select: (i) => {
        setSelected(i);
        setSelectedPoint(null);
      },
      selectPoint: (id) => {
        setSelectedPoint(id);
        setSelected(null);
      },
      dragStart: () => {
        const current = dataRef.current;
        if (current) setHistory((h) => [...h.slice(-99), { data: current, patch: patchRef.current }]);
      },
      moveMount: (i, x, y) => {
        setNudge('mount');
        edit((l) => Object.assign(l.mounts[i], { x, y }));
      },
      moveVfx: (i, x, y) => {
        setNudge('vfx');
        edit((l) => Object.assign(l.mounts[i], { vfxX: x, vfxY: y }));
      },
      movePoint: (id, x, y) =>
        edit((l) => {
          l.points ??= {};
          l.points[id] = { x, y };
        }),
      hover: setHover,
    });
    return () => {
      previewRef.current?.destroy();
      previewRef.current = null;
    };
    // The preview is created once; settings are passed in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, data !== null]);

  // Keep the preview's settings up to date.
  useEffect(() => {
    const settings = previewSettings();
    if (previewRef.current && settings) previewRef.current.settings = settings;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, subject, state, effect, zoom, spin, fly, team, guides, stars, rotation, selected, selectedPoint, patch]);

  // Switching subjects, or turning spin/fly off, puts it back in the middle facing right.
  useEffect(() => previewRef.current?.resetPosition(), [subject, effect, spin, fly]);
  // A new subject starts with nothing selected (not at startup, where the remembered selection is kept).
  const shownSubject = useRef(subject);
  useEffect(() => {
    if (shownSubject.current === subject) return;
    shownSubject.current = subject;
    setSelected(null);
    setSelectedPoint(null);
  }, [subject]);

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
      if (READ_ONLY) return;
      const step = e.shiftKey ? 5 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d && selectedPoint) {
        e.preventDefault();
        change((data) => {
          const l = data[section][subject];
          l.points ??= {};
          const p = l.points[selectedPoint] ?? { x: 0, y: 0 };
          l.points[selectedPoint] = { x: p.x + d[0], y: p.y + d[1] };
        });
        return;
      }
      if (selected === null) return;
      if (d) {
        e.preventDefault();
        change((data) => {
          const m = data[section][subject].mounts[selected];
          if (nudge === 'vfx') {
            m.vfxX += d[0];
            m.vfxY += d[1];
          } else {
            m.x += d[0];
            m.y += d[1];
          }
        });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        change((data) => data[section][subject].mounts.splice(selected, 1));
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, selectedPoint, section, subject, nudge, change, undo, save]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  /** Images a mount of this category can use, the ones named for `state` first ("thruster-boost-…" for boost). */
  const imagesFor = (category: string, state: string) =>
    parts
      .filter((f) => categoryOf(f) === category)
      .sort((a, b) => Number(baseName(b).includes(`-${state}`)) - Number(baseName(a).includes(`-${state}`)) || a.localeCompare(b));

  const addMount = (category: string) => {
    const m: Mount = { category, x: 0, y: 0, angle: 0, flipX: false, flipY: false, scale: 1, behind: true, vfxX: 0, vfxY: 0, images: {} };
    // Start in the state being previewed (from Idle, a thruster starts in Move).
    const s = mountState === 'idle' && category === 'thruster' ? 'move' : mountState;
    if (category === EMITTER) m.emit = { [s]: {} };
    else {
      const img = imagesFor(category, s)[0];
      if (img) m.images[s] = img;
      // Thrusters give off particles wherever they show (they can be turned off in the VFX panel).
      if (category === 'thruster') m.emit = { [s]: {} };
    }
    change((d) => d[section][subject].mounts.push(m));
    setSelected(layout.mounts.length);
    setSelectedPoint(null);
    setNudge('mount');
  };

  /** Copy another tier's layout onto this one, with positions scaled by how much bigger this image is. */
  const copyFrom = (from: string) => {
    if (!assets || !data?.[section][from]) return;
    const k = assets.get(subject).frames[0].w / assets.get(from).frames[0].w;
    change((d) => {
      const copy = clone(d[section][from]);
      for (const m of copy.mounts) {
        m.x = Math.round(m.x * k);
        m.y = Math.round(m.y * k);
        m.vfxX = Math.round(m.vfxX * k);
        m.vfxY = Math.round(m.vfxY * k);
      }
      for (const p of Object.values(copy.points ?? {})) {
        p.x = Math.round(p.x * k);
        p.y = Math.round(p.y * k);
      }
      d[section][subject] = copy;
    });
    setSelected(null);
  };

  if (error) return <div className="shipart-message">Couldn't start ShipArt: {error}</div>;

  // The image shown for the selected mount in the current state (its flipbook settings can be edited).
  const shownImage = mount?.images[mountState];
  const setImageSettings = (p: { frames?: number; fps?: number; loop?: boolean }) => {
    if (!shownImage || !assets) return;
    const next = { ...(data?.images[shownImage] ?? {}), ...p };
    change((d) => (d.images[shownImage] = next));
    loadLayoutImage(assets, shownImage, next, files);
  };
  const point = selectedPoint ? (layout.points?.[selectedPoint] ?? { x: 0, y: 0 }) : null;
  const pickSubject = (s: string) => {
    setSubject(s);
    setEffectBase(null);
  };
  const stateLabel = (s: string) => kind.states.find((k) => k.id === s)?.label ?? label(s);

  /** One list of sprites in the rollout menu. */
  const subjectList = (list: string[]) =>
    list.filter(matchesFilter).map((s) => (
      <button key={s} className={'sa-ship' + (!effect && subject === s ? ' on' : '')} onClick={() => pickSubject(s)}>
        {shortName(s)}
      </button>
    ));

  return (
    <div className="shipart">
      <header className="sa-top">
        <h1>ShipArt</h1>
        <div className="sa-group">
          {effect
            ? effectTiers.map((n, i) => (
                <button key={n} className={effect === n ? 'on' : ''} onClick={() => setEffectTier(i + 1)} title={n}>
                  Tier {i + 1}
                </button>
              ))
            : kind.states.map((s) => (
                <button key={s.id} className={state === s.id ? 'on' : ''} onClick={() => setState(s.id)}>
                  {s.label}
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
          <button
            className={stars ? 'on' : ''}
            onClick={() => {
              setStars(!stars);
              saveSetting('shipart.stars', stars ? 'off' : 'on');
            }}
            title="Starry background, or plain black"
          >
            Stars
          </button>
          <button className={guides ? 'on' : ''} onClick={() => setGuides(!guides)} title="Outlines, VFX points and points">
            Guides
          </button>
        </div>
        <div className="sa-group" title="How rotated ships are drawn (the game uses the same choice)">
          Rotation
          {ROTATION_MODES.map((m) => (
            <button
              key={m}
              className={rotation === m ? 'on' : ''}
              onClick={() => {
                setRotation(m);
                saveSetting(ROTATION_SETTING, m);
              }}
            >
              {ROTATION_LABELS[m]}
            </button>
          ))}
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
        <input className="sa-filter" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="sa-rollout" onClick={() => setOpen({ ...open, ships: !open.ships })}>
          {open.ships ? '▾' : '▸'} Ships
        </button>
        {open.ships && <div className="sa-rollout-body">{subjectList(spritesOf(SHIP_KIND))}</div>}
        <button className="sa-rollout" onClick={() => setOpen({ ...open, objects: !open.objects })}>
          {open.objects ? '▾' : '▸'} Objects
        </button>
        {open.objects && (
          <div className="sa-rollout-body">
            {OBJECT_KINDS.map((k) => (
              <div key={k.id}>
                <div className="sa-rollout-group">{k.label}</div>
                {subjectList(spritesOf(k))}
              </div>
            ))}
          </div>
        )}

        <button className="sa-rollout" onClick={() => setOpen({ ...open, effects: !open.effects })}>
          {open.effects ? '▾' : '▸'} Effects
        </button>
        {open.effects && (
          <div className="sa-rollout-body">
            {effects.filter(matchesFilter).map((e) => (
              <button
                key={e}
                className={'sa-ship' + (effectBase === e ? ' on' : '')}
                onClick={() => {
                  setEffectBase(e);
                  setEffectTier(1);
                }}
              >
                {e.replace(/^vfx\./, '')}
              </button>
            ))}
          </div>
        )}

        {data && !effect && (
          <fieldset disabled={READ_ONLY}>
            <h2>Base image</h2>
            {kind.mountStates.map((s) => (
              <label key={s} className="sa-row">
                <span>{stateLabel(s)}</span>
                <select
                  value={layout.base[s] ?? ''}
                  onChange={(e) =>
                    change((d) => {
                      if (e.target.value) d[section][subject].base[s] = e.target.value;
                      else delete d[section][subject].base[s];
                    })
                  }
                >
                  <option value="">{s === kind.mountStates[0] ? 'Normal image' : 'Same as first'}</option>
                  {baseFiles.map((f) => (
                    <option key={f} value={f}>
                      {baseName(f)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <h2>Copy layout from</h2>
            <select value="" onChange={(e) => e.target.value && copyFrom(e.target.value)}>
              <option value="">Choose…</option>
              {spritesOf(kind)
                .filter((s) => s !== subject && data[section][s]?.mounts.length)
                .map((s) => (
                  <option key={s} value={s}>
                    {shortName(s)} (positions scaled)
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
          {effect
            ? 'Looping effects play on and on; play-once effects replay after a short pause'
            : `${hover ? `x ${hover.x}, y ${hover.y} · ` : ''}Drag a mount, its pink VFX point, or a yellow point · Arrows nudge (Shift = 5 px) · Delete removes`}
        </div>
      </main>

      {assets && effect && (
        <EffectPanel
          assets={assets}
          sprite={effect}
          tiers={effectTiers}
          readOnly={READ_ONLY}
          windowsRoot={windowsRoot}
          artFiles={files}
          onChangeEntries={changeEntries}
          onFilesChanged={() =>
            fetch('/__shipart/files', { cache: 'no-store' })
              .then((r) => r.json())
              .then((r) => setFiles(r.files))
              .catch(() => {})
          }
        />
      )}
      {assets && data && !effect && (
        <VfxPanel
          assets={assets}
          data={data}
          kind={kind}
          mount={mount}
          mountState={mountState}
          readOnly={READ_ONLY}
          windowsRoot={windowsRoot}
          onChange={(fn) => changeMount(fn)}
          onChangeData={(fn) => change(fn)}
          flipbook={
            shownImage
              ? { file: shownImage, settings: data.images[shownImage] ?? {}, onChange: setImageSettings }
              : undefined
          }
        />
      )}

      <aside className="sa-right">
        {effect && <div className="sa-note sa-effect-note">Effects have no mounts. Their flipbook and image are in the purple panel.</div>}
        <fieldset disabled={READ_ONLY} hidden={!!effect}>
          {kind.points.length > 0 && (
            <>
              <h2>Points</h2>
              {kind.points.map((p) => (
                <button
                  key={p.id}
                  className={'sa-mount' + (selectedPoint === p.id ? ' on' : '')}
                  onClick={() => {
                    setSelectedPoint(p.id);
                    setSelected(null);
                  }}
                >
                  {p.label} <span className="sa-note">shows {p.effect}</span>
                </button>
              ))}
              {point && selectedPoint && (
                <div className="sa-row">
                  <NumberField
                    label="x"
                    value={point.x}
                    onChange={(v) => change((d) => ((d[section][subject].points ??= {})[selectedPoint] = { ...point, x: v }))}
                  />
                  <NumberField
                    label="y"
                    value={point.y}
                    onChange={(v) => change((d) => ((d[section][subject].points ??= {})[selectedPoint] = { ...point, y: v }))}
                  />
                </div>
              )}
            </>
          )}

          <h2>Mounts</h2>
          <div className="sa-mounts">
            {layout.mounts.map((m, i) => (
              <button
                key={i}
                className={'sa-mount' + (selected === i ? ' on' : '')}
                onClick={() => {
                  setSelected(i);
                  setSelectedPoint(null);
                }}
              >
                {label(m.category)} {i + 1}
                <span className="sa-note">
                  {' '}
                  {kind.mountStates
                    .filter((s) => m.images[s] || m.emit?.[s])
                    .map(stateLabel)
                    .join(', ') || 'hidden'}
                </span>
              </button>
            ))}
            {layout.mounts.length === 0 && <div className="sa-note">No mounts here yet.</div>}
          </div>
          <div className="sa-row sa-wrap">
            <span>Add</span>
            {categories.map((c) => (
              <button key={c} onClick={() => addMount(c)}>
                + {label(c)}
              </button>
            ))}
            <button onClick={() => addMount(EMITTER)} title="Particles only, no image">
              + Emitter
            </button>
          </div>

          {mount && (
            <div className="sa-mount-edit">
              <h2>
                {label(mount.category)} {selected! + 1}
              </h2>
              {mount.category === EMITTER ? (
                <div className="sa-note">Particles only: set when and how in the VFX panel.</div>
              ) : (
                <>
                  <div className="sa-sub">Shows in</div>
                  {kind.mountStates.map((s) => {
                    const options = imagesFor(mount.category, s);
                    return (
                      <label key={s} className="sa-row">
                        <input
                          type="checkbox"
                          checked={!!mount.images[s]}
                          onChange={(e) =>
                            changeMount((m) => {
                              if (e.target.checked) {
                                m.images[s] = options[0];
                                // Thrusters give off particles wherever they show.
                                if (m.category === 'thruster') (m.emit ??= {})[s] ??= {};
                              } else {
                                delete m.images[s];
                                if (m.category === 'thruster' && m.emit) delete m.emit[s];
                              }
                            })
                          }
                        />
                        <span>{stateLabel(s)}</span>
                        <select
                          value={mount.images[s] ?? ''}
                          disabled={!mount.images[s]}
                          onChange={(e) => changeMount((m) => (m.images[s] = e.target.value))}
                        >
                          {!mount.images[s] && <option value="">Hidden</option>}
                          {options.map((f) => (
                            <option key={f} value={f}>
                              {baseName(f) + (isFrameFolder(f) ? ' (folder)' : '')}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </>
              )}

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
                <input type="checkbox" checked={mount.behind} onChange={(e) => changeMount((m) => (m.behind = e.target.checked))} /> Behind
              </label>

              <div className="sa-row sa-actions">
                <button
                  onClick={() => {
                    change((d) => d[section][subject].mounts.push({ ...clone(mount), x: mount.x, y: mount.y + 4 }));
                    setSelected(layout.mounts.length);
                  }}
                >
                  Duplicate
                </button>
                <button
                  title="A copy on the other side (top ↔ bottom), mirrored"
                  onClick={() => {
                    change((d) => d[section][subject].mounts.push({ ...clone(mount), y: -mount.y, vfxY: -mount.vfxY, flipY: !mount.flipY }));
                    setSelected(layout.mounts.length);
                  }}
                >
                  Mirror copy
                </button>
                <button
                  className="sa-danger"
                  onClick={() => {
                    change((d) => d[section][subject].mounts.splice(selected!, 1));
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
