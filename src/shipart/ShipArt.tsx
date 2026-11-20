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
import { layoutGunsOrDefault } from '../game/guns';
import type { Gun, HitCircle, LeviathanFin, LeviathanLayout } from '../game/artLayout';
import { CONFIG, SHIP_TYPES } from '../game/config';
import { GunsPanel } from './GunsPanel';
import { tierSprite } from '../game/render';
import type { Team } from '../game/world';
import { Preview } from './Preview';
import { NumberField } from './fields';
import { VfxPanel } from './VfxPanel';
import { EffectPanel } from './EffectPanel';
import { ScreenEffectWindow } from './ScreenEffectWindow';
import { HitShapePanel } from './HitShapePanel';
import { fitShip, shipArtFingerprint } from './hitArt';
import { screenEffect } from '../game/screenEffect';
import { leviathanLayout } from '../game/leviathan';
import { LeviathanPanel, bossPieceKind, bossPieceSprite, type BossPiece } from './LeviathanPanel';
import type { BossHead } from './bossPreview';
import type { Glow } from '../engine/glow';
import { VolumePanel } from './VolumePanel';
import { SoundPanel, soundForTier, soundList, useSoundLab } from './SoundPanel';
import { SOUND_INFO } from './soundInfo';

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
  boss?: 'leviathan' | null;
  /** The sound shown (Sounds section), by its base name. */
  sound?: string | null;
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
/** Boss effects listed under Effects too (the Leviathan's beam attack), so they can get a glow and flipbook settings. */
const BOSS_EFFECTS = [
  'boss.leviathan.charge-ball',
  'boss.leviathan.beam-start',
  'boss.leviathan.beam',
  'boss.leviathan.beam-impact',
  'boss.leviathan.beam-warning',
  'boss.leviathan.bump',
  'boss.leviathan.orb',
  'boss.leviathan.orb-pulse',
  'boss.leviathan.blood',
  'boss.leviathan.blood-hit',
  'boss.leviathan.lightning',
  'boss.leviathan.rift',
  'boss.leviathan.explosion',
  'boss.leviathan.shockwave',
];
/** "vfx.explosion.t3" → "vfx.explosion". */
const effectBaseOf = (name: string) => name.replace(/\.t\d+$/, '');
/** "parts/thruster-boost-1.png" → "thruster-boost-1" (a frame folder "parts/thruster-boost-3/" → "thruster-boost-3"). */
const baseName = (file: string) => file.replace(/\/$/, '').replace(/^.*\//, '').replace(/\.png$/i, '');
/** "parts/thruster-boost-1.png" → "thruster". */
const categoryOf = (file: string) => baseName(file).split('-')[0];
/** Which group a ship sprite is listed under: Player, Enemy, or an enemy variant ("ship.enemy-energy.t2" → "Enemy energy"). */
const shipGroup = (sprite: string) => {
  const m = /^ship\.enemy(?:-([a-z]+))?(\.t\d+)?$/.exec(sprite);
  return !m ? 'Player' : m[1] ? `Enemy ${m[1]}` : 'Enemy';
};
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
  /** Detail steps previewed (0 = normal; not remembered). */
  const [detail, setDetail] = useState(0);
  const [spin, setSpin] = useState(savedView.spin ?? false);
  const [fly, setFly] = useState(savedView.fly ?? true);
  const [team, setTeam] = useState<Team>(savedView.team ?? 'player');
  const [guides, setGuides] = useState(savedView.guides ?? true);
  // Stars on or off, remembered in this browser.
  const [stars, setStars] = useState(() => loadSetting('shipart.stars') !== 'off');
  // The game's screen effect over the preview (own switch), and its settings window.
  const [crt, setCrt] = useState(() => loadSetting('shipart.crt') === 'on');
  const [fxOpen, setFxOpen] = useState(false);
  // How rotated ships are drawn; shared with the game (same browser setting).
  /** 3D volume prototype (engine/tilt.ts): bank and pitch (degrees), light, swing. Preview only. */
  const [bank, setBank] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [tiltLight, setTiltLight] = useState(true);
  const [swing, setSwing] = useState(false);
  const [rotation, setRotation] = useState<RotationMode>(() => {
    const r = loadSetting(ROTATION_SETTING) as RotationMode | null;
    return r && ROTATION_MODES.includes(r) ? r : 'grid';
  });
  const [selected, setSelected] = useState<number | null>(savedView.selected ?? null);
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  /** The selected gun (ships only). */
  const [selectedGun, setSelectedGun] = useState<number | null>(null);
  const [selectedHit, setSelectedHit] = useState<number | null>(null);
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
  /** A boss being shown (Bosses section) instead of a ship, object or effect; its head view, picked piece, and "Lay straight" count. */
  const [boss, setBoss] = useState<'leviathan' | null>(savedView.boss ?? null);
  const [bossHead, setBossHead] = useState<BossHead>('auto');
  const [bossPiece, setBossPiece] = useState<BossPiece | null>(null);
  /** Which one of the body's pieces was clicked in the preview (counted from the head), for bulges. */
  const [bossIndex, setBossIndex] = useState<number | null>(null);
  /** The picked fin (its number in the Leviathan's fin list), or null. */
  const [bossFin, setBossFin] = useState<number | null>(null);
  const [bossStraight, setBossStraight] = useState(0);
  /** Bumped by the Beam button (charge and fire once). */
  const [bossBeam, setBossBeam] = useState(0);
  /** The sound shown (Sounds section) instead of art, by its base name ("sfx.explosion"), the tier it's played for, and Play presses. */
  const [soundBase, setSoundBase] = useState<string | null>(savedView.sound ?? null);
  const [soundTier, setSoundTier] = useState(1);
  const [soundPlay, setSoundPlay] = useState(0);
  /** Bumped when reloaded art has finished loading, so panels showing its size and frames update. */
  const [artVersion, setArtVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('');
  /** What the arrow keys move: the selected mount, or its VFX point. */
  const [nudge, setNudge] = useState<'mount' | 'vfx'>('mount');
  /** Rollout sections that are open, and the filter text. */
  const [open, setOpen] = useState<Record<string, boolean>>(savedView.open ?? { ships: true, objects: true });
  const [filter, setFilter] = useState('');
  // The sounds load once the Sounds section is opened (or a sound was shown last time).
  const lab = useSoundLab(!!open.sounds || soundBase !== null);
  const soundInfo = soundBase ? SOUND_INFO[soundBase] : undefined;
  /** Its preview zoom by tier, so the scene fits. */
  const pickSoundTier = (t: number) => {
    setSoundTier(t);
    setZoom([4, 3, 2, 1][t - 1] ?? 1);
  };
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
      const [a] = await Promise.all([Assets.load(), screenEffect.loadLive()]);
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
    const view: SavedView = { subject, states, zoom, spin, fly, team, guides, effectBase, effectTier, selected, open, boss, sound: soundBase };
    saveSetting(VIEW_SETTING, JSON.stringify(view));
  }, [assets, subject, states, zoom, spin, fly, team, guides, effectBase, effectTier, selected, open, boss, soundBase]);

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
  // The shown ship's outline now, and whether it changed since its hit shape was fitted.
  const artPrint = useMemo(
    () => (assets && section === 'ships' ? shipArtFingerprint(assets, subject) : null),
    // artVersion: images reloaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, section, subject, artVersion],
  );
  const artPrintRef = useRef(artPrint);
  artPrintRef.current = artPrint;
  const artChanged = !!layout.hitShape?.length && !!artPrint && layout.hitShapeArt !== artPrint;
  const mount = selected !== null ? layout.mounts[selected] : undefined;
  /** Images mounts can use (a folder of frames counts as one). */
  const parts = useMemo(() => partImages(files), [files]);
  // Gun images (parts/gun-….png) go on guns, not mounts.
  const categories = useMemo(() => [...new Set(parts.map(categoryOf))].filter((c) => c !== 'gun'), [parts]);
  const gunImages = useMemo(() => parts.filter((f) => categoryOf(f) === 'gun'), [parts]);
  const baseFiles = files.filter((f) => f.startsWith(kind.baseFolder));
  const mountState = kind.states.find((s) => s.id === state)?.uses ?? state;

  /**
   * Change the data (saving an undo step first unless `noUndo`). The current subject always has a layout
   * to change, unless `noLayout` (boss edits, which don't touch the subject).
   */
  const change = useCallback(
    (fn: (d: ArtLayoutsFile) => void, noUndo = false, noLayout = false) => {
      const current = dataRef.current;
      if (!current || READ_ONLY) return;
      const next = clone(current);
      if (!noLayout) next[section][subject] ??= emptyLayout();
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
  /** When the volume sliders last changed (quick changes = one undo step). */
  const lastVolumeEdit = useRef(0);
  /** When the glow was last changed: changes in quick succession (a slider drag) make one undo step. */
  const lastGlowEdit = useRef(0);
  /** Change effects' glow (manifest "glow"): shown at once without reloading the images, saved with Save. */
  const changeGlow = (names: string[], fn: (g: Glow | undefined) => Glow | undefined) => {
    const current = dataRef.current;
    if (!assets || !current || READ_ONLY) return;
    const now = performance.now();
    if (now - lastGlowEdit.current > 600) setHistory((h) => [...h.slice(-99), { data: current, patch: patchRef.current }]);
    lastGlowEdit.current = now;
    const next = { ...patchRef.current };
    for (const name of names) {
      const entry = next[name] ?? assets.entryOf(name);
      if (!entry) continue;
      baselineRef.current[name] ??= assets.entryOf(name)!;
      const e = { ...entry };
      const glow = fn(entry.glow ? { ...entry.glow } : undefined);
      if (glow) e.glow = glow;
      else delete e.glow;
      next[name] = e;
      assets.setGlow(name, e);
    }
    patchRef.current = next;
    setPatch(next);
    setDirty(true);
    setArtVersion((v) => v + 1);
  };
  /** Change the Leviathan's body settings (art.json `bosses.leviathan`). */
  const changeBoss = (fn: (l: Partial<LeviathanLayout>) => void, noUndo = false) =>
    change((d) => fn(((d.bosses ??= {}).leviathan ??= {})), noUndo, true);

  /**
   * Move a boss piece's pivot: its image's anchor in the manifest (saved to manifest.json with Save).
   * Shown at once (no reload of the image), so dragging is smooth.
   */
  const setPivot = useCallback(
    (piece: BossPiece, x: number, y: number, noUndo = false) => {
      const current = dataRef.current;
      if (!assets || !current || READ_ONLY) return;
      const name = bossPieceSprite(piece);
      const entry = patchRef.current[name] ?? assets.entryOf(name);
      if (!entry) return;
      if (!noUndo) setHistory((h) => [...h.slice(-99), { data: current, patch: patchRef.current }]);
      baselineRef.current[name] ??= assets.entryOf(name)!;
      const sprite = assets.get(name);
      sprite.anchorX = x;
      sprite.anchorY = y;
      const next = { ...patchRef.current, [name]: { ...entry, anchorX: x, anchorY: y } };
      patchRef.current = next;
      setPatch(next);
      setDirty(true);
    },
    [assets],
  );
  const setPivotRef = useRef(setPivot);
  setPivotRef.current = setPivot;

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
  // (The Leviathan's effects and the Bosses section are only on the dev copy for now: the teammate's
  // view-only ShipArt doesn't show them, so they meet it by surprise in the game; the user, 2026-11-20.)
  const effects = useMemo(
    () => (assets ? [...new Set(assets.names().filter((n) => n.startsWith('vfx.') || (!READ_ONLY && BOSS_EFFECTS.includes(n))).map(effectBaseOf))].sort() : []),
    [assets],
  );
  /** The tier versions of the effect shown, and the one being shown. */
  const effectTiers = effectBase && assets ? [effectBase, ...[2, 3, 4, 5, 6].map((t) => `${effectBase}.t${t}`)].filter((n) => assets.has(n)) : [];
  const effect = effectBase && assets && !soundBase ? tierSprite(assets, effectBase, effectTier) : null;
  /** The sound's scene for the preview (Sounds section): its sound starts on the scene's cue; looping sounds run while it says. */
  const soundPreview = () => {
    if (!soundBase || !lab) return null;
    const tier = soundInfo?.tiered === false ? 1 : soundTier;
    const play = soundForTier(lab.sounds, soundBase, tier);
    return {
      scene: soundInfo?.scene?.(tier) ?? { items: [], cue: 0.2, length: Math.max(1.2, lab.sounds.duration(play.name) + 0.4) },
      tier,
      play: soundPlay,
      cue: () => {
        if (!soundInfo?.loop) lab.sounds.play(play.name, { pitch: play.pitch, always: true });
      },
      loop: (level: number) => {
        if (soundInfo?.loop) lab.sounds.setLoop(play.name, level, play.pitch);
      },
    };
  };
  // A looping sound stops when another sound (or tier) is shown, or the Sounds section is left.
  useEffect(() => {
    if (!soundBase || !lab || !soundInfo?.loop) return;
    const sounds = lab.sounds;
    const names = [soundBase, ...[2, 3, 4].map((t) => `${soundBase}.t${t}`)];
    return () => names.forEach((n) => sounds.setLoop(n, 0));
  }, [soundBase, soundTier, lab, soundInfo]);

  const previewSettings = () =>
    data && {
      data,
      subject,
      kind,
      state,
      effect,
      zoom,
      detail,
      spin,
      fly,
      team,
      guides,
      stars,
      crt,
      rotation,
      selected,
      selectedPoint,
      selectedGun,
      selectedHit,
      boss: effect ? null : boss,
      bossHead,
      bossPiece,
      bossIndex,
      bossFin,
      bossStraight,
      bossBeam,
      bank,
      pitch,
      tiltLight,
      swing,
      readOnly: READ_ONLY,
      sound: soundPreview(),
    };

  /** Change one Leviathan fin without an undo step (preview drags save one when they start). */
  const editFinNoUndo = (i: number, fn: (f: LeviathanFin) => void) => {
    setData((d) => {
      if (!d) return d;
      const next = clone(d);
      const l = ((next.bosses ??= {}).leviathan ??= {});
      const list = leviathanLayout(d).fins.map((f) => ({ ...f }));
      if (!list[i]) return d;
      fn(list[i]);
      l.fins = list;
      return next;
    });
    setDirty(true);
  };

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
        setSelectedGun(null);
        setSelectedHit(null);
      },
      selectPoint: (id) => {
        setSelectedPoint(id);
        setSelected(null);
        setSelectedGun(null);
        setSelectedHit(null);
      },
      selectGun: (i) => {
        setSelectedGun(i);
        setSelected(null);
        setSelectedPoint(null);
        setSelectedHit(null);
      },
      selectHit: (i) => {
        setSelectedHit(i);
        setSelected(null);
        setSelectedPoint(null);
        setSelectedGun(null);
      },
      moveHit: (i, x, y) =>
        edit((l) => {
          if (!l.hitShape?.[i]) return;
          Object.assign(l.hitShape[i], { x, y });
          l.hitShapeArt = artPrintRef.current ?? undefined;
        }),
      resizeHit: (i, r) =>
        edit((l) => {
          if (!l.hitShape?.[i]) return;
          l.hitShape[i].r = r;
          l.hitShapeArt = artPrintRef.current ?? undefined;
        }),
      moveGun: (i, x, y) =>
        edit((l) => {
          // Moving a standard gun places a copy of the standard guns first.
          l.guns = layoutGunsOrDefault(l, previewRef.current!.settings.subject).map((g) => ({ ...g }));
          Object.assign(l.guns[i], { x, y });
        }),
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
      selectBossPiece: (p, i) => {
        setBossPiece(p);
        setBossIndex(i);
      },
      selectFin: (i) => {
        setBossFin(i);
        if (i !== null) setBossPiece(null);
      },
      // Drags save one undo step at their start (dragStart), not one per mouse move.
      moveFin: (i, x, y) => editFinNoUndo(i, (f) => Object.assign(f, { x, y })),
      aimFin: (i, angle, scale) => editFinNoUndo(i, (f) => Object.assign(f, { angle, scale })),
      // Drags save one undo step at their start (dragStart), not one per mouse move.
      moveBossPivot: (p, x, y) => setPivotRef.current(p, x, y, true),
      resizeBossHit: (p, r) => {
        const kind = bossPieceKind(p);
        setData((d) => {
          if (!d) return d;
          const next = clone(d);
          const l = ((next.bosses ??= {}).leviathan ??= {});
          l.hitRadius = { ...leviathanLayout(d).hitRadius, [kind]: r };
          return next;
        });
        setDirty(true);
      },
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
  }, [data, subject, state, effect, zoom, detail, spin, fly, team, guides, stars, crt, rotation, selected, selectedPoint, selectedGun, selectedHit, boss, bossHead, bossPiece, bossIndex, bossFin, bossStraight, bossBeam, patch, bank, pitch, tiltLight, swing, soundBase, soundTier, soundPlay, lab]);

  // Switching subjects, or turning spin/fly off, puts it back in the middle facing right.
  useEffect(() => previewRef.current?.resetPosition(), [subject, effect, spin, fly]);
  // A new subject starts with nothing selected (not at startup, where the remembered selection is kept).
  const shownSubject = useRef(subject);
  useEffect(() => {
    if (shownSubject.current === subject) return;
    shownSubject.current = subject;
    setSelected(null);
    setSelectedPoint(null);
    setSelectedGun(null);
    setSelectedHit(null);
  }, [subject]);

  /** Change the shown ship's guns (placing a copy of the standard guns first if it has none). */
  const changeGuns = useCallback(
    (fn: (guns: Gun[]) => void) =>
      change((d) => {
        const l = d[section][subject];
        l.guns = layoutGunsOrDefault(l, subject).map((g) => ({ ...g }));
        fn(l.guns);
      }),
    [change, section, subject],
  );

  /** Change the shown ship's hit shape circles (remembering which outline they were made for). */
  const changeHit = useCallback(
    (fn: (list: HitCircle[]) => void) =>
      change((d) => {
        const l = d[section][subject];
        l.hitShape = (l.hitShape ?? []).map((h) => ({ ...h }));
        fn(l.hitShape);
        if (l.hitShape.length) l.hitShapeArt = artPrintRef.current ?? undefined;
        else {
          delete l.hitShape;
          delete l.hitShapeArt;
        }
      }),
    [change, section, subject],
  );
  /** Fit these ship images' hit shapes to their art (one undo step). */
  const fitHit = useCallback(
    (names: string[]) => {
      if (!assets) return;
      change((d) => {
        for (const name of names) {
          const fit = fitShip(assets, name);
          if (!fit || !fit.circles.length) continue;
          d.ships[name] ??= emptyLayout();
          d.ships[name].hitShape = fit.circles;
          d.ships[name].hitShapeArt = fit.art;
        }
      });
      setSelectedHit(null);
    },
    [assets, change],
  );

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
      if (READ_ONLY || boss) return;
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
      if (selectedHit !== null && section === 'ships') {
        if (d) {
          e.preventDefault();
          changeHit((list) => {
            if (!list[selectedHit]) return;
            list[selectedHit].x += d[0];
            list[selectedHit].y += d[1];
          });
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          changeHit((list) => list.splice(selectedHit, 1));
          setSelectedHit(null);
        }
        return;
      }
      if (selectedGun !== null && section === 'ships') {
        if (d) {
          e.preventDefault();
          changeGuns((guns) => {
            guns[selectedGun].x += d[0];
            guns[selectedGun].y += d[1];
          });
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          changeGuns((guns) => guns.splice(selectedGun, 1));
          setSelectedGun(null);
        }
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
  }, [selected, selectedPoint, selectedGun, selectedHit, section, subject, nudge, change, changeGuns, changeHit, undo, save, boss]);

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
    setBoss(null);
    setSoundBase(null);
  };
  /** The boss shown (not while an effect or a sound is). */
  const shownBoss = effect || soundBase ? null : boss;
  /** Something other than the subject is shown (an effect, a boss or a sound). */
  const other = !!effect || !!shownBoss || !!soundBase;
  const stateLabel = (s: string) => kind.states.find((k) => k.id === s)?.label ?? label(s);

  /** One list of sprites in the rollout menu. */
  const subjectList = (list: string[]) =>
    list.filter(matchesFilter).map((s) => (
      <button key={s} className={'sa-ship' + (!other && subject === s ? ' on' : '')} onClick={() => pickSubject(s)}>
        {shortName(s)}
      </button>
    ));

  return (
    <div className="shipart">
      <header className="sa-top">
        <h1>ShipArt</h1>
        <div className="sa-group">
          {soundBase ? (
            <span className="sa-note">Sound: {soundBase}</span>
          ) : shownBoss ? (
            <>
              Head
              {(
                [
                  ['auto', 'Auto', 'As the turns pick it'],
                  ['top', 'Top', 'Always the top view'],
                  ['half-right', 'Half →', 'Always the half-side view, as for a gentle right turn'],
                  ['half-left', 'Half ←', 'Always the half-side view, as for a gentle left turn'],
                  ['right', 'Side →', 'Always the side view, as for a right turn'],
                  ['left', 'Side ←', 'Always the side view, as for a left turn'],
                ] as [BossHead, string, string][]
              ).map(([id, text, tip]) => (
                <button key={id} className={bossHead === id ? 'on' : ''} onClick={() => setBossHead(id)} title={tip}>
                  {text}
                </button>
              ))}
              <button
                onClick={() => {
                  setBossStraight((n) => n + 1);
                  setFly(false);
                }}
                title="Stretch it out straight, facing right, and hold it still (Fly swims again)"
              >
                Lay straight
              </button>
              <button onClick={() => setBossBeam((n) => n + 1)} title="Charge and fire its beam once (to the right, or to the left while a left head view is held)">
                Beam
              </button>
            </>
          ) : effect
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
        <div
          className="sa-group"
          title={
            'Detail steps: how it looks drawn smaller for very big fleets (1 = one tier smaller...). ' +
            'Automatic shrunk copy, or your own small version if the manifest has one: ' +
            `"${subject}.d${detail || 1}" for ${detail || 1} step${detail > 1 ? 's' : ''} smaller.`
          }
        >
          Detail
          {[0, 1, 2, 3].map((d) => (
            <button key={d} className={detail === d ? 'on' : ''} onClick={() => setDetail(d)}>
              {d === 0 ? 'Full' : `−${d}`}
            </button>
          ))}
          {detail > 0 && assets && <span className="sa-note">{assets.has(`${subject}.d${detail}`) ? ' hand-drawn' : ' automatic'}</span>}
        </div>
        <div className="sa-group">
          <button className={fly ? 'on' : ''} onClick={() => setFly(!fly)} title="Fly forward, so particles trail like in the game">
            Fly
          </button>
          <button className={spin ? 'on' : ''} onClick={() => setSpin(!spin)} title="Turn slowly, to check every angle">
            Spin
          </button>
          <button onClick={() => setTeam(team === 'player' ? 'enemy' : 'player')} title="Team colours of shots and effects (ships have their own art)">
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
        {kind.section === 'ships' && !other && (
          <div className="sa-group sa-tilt" title="3D volume prototype: the ship banked (along its length) and pitched (along its width) as a 3D hull">
            3D
            <label title="Bank: roll along its length (right side down for +). Double-click: 0">
              Bank
              <input type="range" min={-35} max={35} step={1} value={bank} onChange={(e) => setBank(Number(e.target.value))} onDoubleClick={() => setBank(0)} />
              <span className="sa-slider-value">{bank}°</span>
            </label>
            <label title="Pitch: nose up (+) or down. Double-click: 0">
              Pitch
              <input type="range" min={-15} max={15} step={1} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} onDoubleClick={() => setPitch(0)} />
              <span className="sa-slider-value">{pitch}°</span>
            </label>
            <button className={swing ? 'on' : ''} onClick={() => setSwing(!swing)} title="Rock back and forth between ± the bank and pitch">
              Swing
            </button>
            <button className={tiltLight ? 'on' : ''} onClick={() => setTiltLight(!tiltLight)} title="Light from the top left: the side tilting toward it steps to lighter colours of its own palette, the other side darker">
              Light
            </button>
          </div>
        )}
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
        <div className="sa-group" title="The game's screen effect (old CRT screen) over the preview">
          <button
            className={crt ? 'on' : ''}
            onClick={() => {
              setCrt(!crt);
              saveSetting('shipart.crt', crt ? 'off' : 'on');
            }}
            title="Show the preview through the game's screen effect (only here: the game has its own switch)"
          >
            CRT
          </button>
          <button className={fxOpen ? 'on' : ''} onClick={() => setFxOpen(!fxOpen)} title="The screen effect's settings and presets">
            Screen effect…
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
        <input className="sa-filter" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="sa-rollout" onClick={() => setOpen({ ...open, ships: !open.ships })}>
          {open.ships ? '▾' : '▸'} Ships
        </button>
        {open.ships && (
          <div className="sa-rollout-body">
            {/* Player ships, enemy ships and each enemy variant have their own art (none are recoloured). */}
            {[...new Set(spritesOf(SHIP_KIND).map(shipGroup))].sort((a, b) => (a === 'Player' ? -1 : b === 'Player' ? 1 : a.localeCompare(b))).map((g) => (
              <div key={g}>
                <div className="sa-rollout-group">{g}</div>
                {subjectList(spritesOf(SHIP_KIND).filter((s) => shipGroup(s) === g))}
              </div>
            ))}
          </div>
        )}
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
                  setBoss(null);
                  setSoundBase(null);
                }}
              >
                {e.replace(/^(vfx|boss)\./, '')}
              </button>
            ))}
          </div>
        )}

        {!READ_ONLY && (
        <button className="sa-rollout" onClick={() => setOpen({ ...open, bosses: !open.bosses })}>
          {open.bosses ? '▾' : '▸'} Bosses
        </button>
        )}
        {!READ_ONLY && open.bosses && (
          <div className="sa-rollout-body">
            {'leviathan'.includes(filter.toLowerCase()) && (
              <button
                className={'sa-ship' + (shownBoss === 'leviathan' ? ' on' : '')}
                onClick={() => {
                  setBoss('leviathan');
                  setEffectBase(null);
                  setSoundBase(null);
                  // It's big: at 1× the whole figure eight fits.
                  setZoom(1);
                }}
              >
                Leviathan
              </button>
            )}
          </div>
        )}

        <button className="sa-rollout" onClick={() => setOpen({ ...open, sounds: !open.sounds })}>
          {open.sounds ? '▾' : '▸'} Sounds
        </button>
        {open.sounds && (
          <div className="sa-rollout-body">
            {!lab && <div className="sa-note">Loading sounds…</div>}
            {/* The Leviathan's sounds only on the dev copy, like the rest of it (a surprise for the teammate). */}
            {lab &&
              soundList(lab.entries, !READ_ONLY).map(({ group, sounds }) => {
                const shown = sounds.filter((n) => matchesFilter(n) || matchesFilter(group));
                return (
                  shown.length > 0 && (
                    <div key={group}>
                      <div className="sa-rollout-group">{group}</div>
                      {shown.map((n) => (
                        <button
                          key={n}
                          className={'sa-ship' + (soundBase === n ? ' on' : '')}
                          onClick={() => {
                            setSoundBase(n);
                            setEffectBase(null);
                            setBoss(null);
                            pickSoundTier(1);
                            setSoundPlay((p) => p + 1);
                          }}
                        >
                          {n.replace(/^sfx\./, '')}
                          {lab.replacements.some((r) => r.name === n || r.name.startsWith(n + '.t')) && ' ●'}
                        </button>
                      ))}
                    </div>
                  )
                );
              })}
          </div>
        )}

        {data && !other && (
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
        {artChanged && !READ_ONLY && (
          <div className="sa-hit-prompt">
            This ship's image changed since its hit shape was fitted. Autofit collision to the new art?
            <button onClick={() => fitHit([subject])}>Autofit</button>
            <button onClick={() => change((d) => (d[section][subject].hitShapeArt = artPrint ?? undefined))} title="Keep the circles as they are">
              Keep shape
            </button>
          </div>
        )}
        {soundBase && soundInfo?.label && <div className="sa-sound-label">{soundInfo.label}</div>}
        <div className="sa-hint">
          {soundBase
            ? 'Play replays the moment the sound belongs to (in the game\'s own art) · Tier buttons: as played for bigger ships'
            : shownBoss
            ? 'Click a piece to pick it · Drag its image to move it around its pivot (the cross on its path) · Drag the gold square to size its hit circle · Fly off or Lay straight to hold it still'
            : effect
            ? 'Looping effects play on and on; play-once effects replay after a short pause'
            : `${hover ? `x ${hover.x}, y ${hover.y} · ` : ''}Drag a mount, its pink VFX point, a yellow point or an orange gun · Arrows nudge (Shift = 5 px) · Delete removes`}
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
          onChangeGlow={changeGlow}
          onFilesChanged={() =>
            fetch('/__shipart/files', { cache: 'no-store' })
              .then((r) => r.json())
              .then((r) => setFiles(r.files))
              .catch(() => {})
          }
        />
      )}
      {soundBase && lab && (
        <SoundPanel lab={lab} base={soundBase} tier={soundTier} onTier={pickSoundTier} onPlay={() => setSoundPlay((p) => p + 1)} canWrite={!READ_ONLY} />
      )}
      {assets && data && !other && (
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
        {soundBase && <div className="sa-note sa-effect-note">Sounds: everything is in the green panel. Drop audio files on it to try them out.</div>}
        {shownBoss && assets && data && (
          <fieldset disabled={READ_ONLY}>
            <LeviathanPanel
              assets={assets}
              layout={leviathanLayout(data)}
              selected={bossPiece}
              pickedIndex={bossIndex}
              selectedFin={bossFin}
              onSelectFin={(i) => {
                setBossFin(i);
                if (i !== null) setBossPiece(null);
              }}
              finFiles={files.filter((f) => f.startsWith('bosses/') && /fin[^/]*\.png$/i.test(f))}
              onSelect={(p) => {
                setBossPiece(p);
                setBossIndex(null);
                if (p) setBossFin(null);
              }}
              onChange={(fn, noUndo) => changeBoss(fn, noUndo)}
              onPivot={(p, x, y) => setPivot(p, x, y)}
              open={open}
              onOpen={(key, on) => setOpen((o) => ({ ...o, [key]: on }))}
              onReset={() =>
                change((d) => {
                  if (d.bosses) d.bosses.leviathan = {};
                }, false, true)
              }
            />
          </fieldset>
        )}
        <fieldset disabled={READ_ONLY} hidden={other}>
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

          {section === 'ships' && (
            <GunsPanel
              guns={layoutGunsOrDefault(layout, subject)}
              placed={!!layout.guns?.length}
              tier={tierOf(subject)}
              images={gunImages}
              selected={selectedGun}
              onSelect={(i) => {
                setSelectedGun(i);
                setSelected(null);
                setSelectedPoint(null);
              }}
              onChange={changeGuns}
              onReset={() => change((d) => delete d[section][subject].guns)}
            />
          )}
          {section === 'ships' && (
            <VolumePanel
              shape={layout.volume}
              onChange={(v) => {
                // Slider drags in quick succession make one undo step.
                const now = performance.now();
                const quick = now - lastVolumeEdit.current < 600;
                lastVolumeEdit.current = now;
                change((d) => {
                  const l = d[section][subject];
                  if (v) l.volume = v;
                  else delete l.volume;
                }, quick);
              }}
            />
          )}
          {section === 'ships' && (
            <HitShapePanel
              circles={layout.hitShape ?? []}
              roundRadius={SHIP_TYPES.fighter.radius * CONFIG.tiers.sizePerTier ** (tierOf(subject) - 1)}
              selected={selectedHit}
              onSelect={(i) => {
                setSelectedHit(i);
                setSelected(null);
                setSelectedPoint(null);
                setSelectedGun(null);
              }}
              onChange={changeHit}
              onFit={() => fitHit([subject])}
              onClear={() => changeHit((list) => list.splice(0))}
              onFitAll={() => fitHit(spritesOf(SHIP_KIND))}
              shipCount={spritesOf(SHIP_KIND).length}
            />
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
                  setSelectedGun(null);
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
      {fxOpen && <ScreenEffectWindow onClose={() => setFxOpen(false)} />}
    </div>
  );
}
