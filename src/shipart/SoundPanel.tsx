// ShipArt → Sounds (docs/SOUND-TOOL.md): where each sound is used, its settings, play buttons
// with a scene in the preview, and trying out replacement files (kept in this browser, handed
// over as a zip, written into the game files on the dev copy).

import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '../game/config';
import { ASSET_ROOT } from '../engine/assets';
import { Sounds } from '../engine/sound';
import { deleteReplacement, listReplacements, putReplacement, replacementsInGame, setReplacementsInGame, type Replacement } from '../engine/soundReplacements';
import { SOUND_GROUPS, SOUND_INFO, soundBaseOf, type SoundInfo } from './soundInfo';
import { makeZip, readZip } from './zip';

/** A sound's manifest entry (engine/sound.ts SoundEntry). */
export interface SoundEntry {
  file: string;
  volume?: number;
  pitchVariation?: number;
  maxVoices?: number;
  minGap?: number;
  pitchPerTier?: number;
}

/** Tiers offered for sounds played deeper for bigger ships. */
export const SOUND_TIERS = [1, 2, 3, 4];

/** Everything the Sounds section shares: the loaded sounds, the manifest entries, and this browser's replacements. */
export interface SoundLab {
  sounds: Sounds;
  entries: Record<string, SoundEntry>;
  replacements: Replacement[];
  /** Read the manifest and the replacements again. */
  refresh: () => Promise<void>;
}

/** Load the sounds (with this browser's replacements, always used in ShipArt) and the manifest's entries. */
export function useSoundLab(active: boolean): SoundLab | null {
  const [lab, setLab] = useState<SoundLab | null>(null);
  const loading = useRef(false);
  useEffect(() => {
    if (!active || loading.current) return;
    loading.current = true;
    (async () => {
      const sounds = await Sounds.load(CONFIG.audio.masterVolume);
      // ShipArt always plays (the game's mute switch is its own).
      sounds.setEnabled(true);
      const read = async () => {
        const manifest = await fetch(ASSET_ROOT + 'manifest.json', { cache: 'no-store' }).then((r) => r.json());
        return { entries: (manifest.sounds ?? {}) as Record<string, SoundEntry>, replacements: await listReplacements() };
      };
      const first = await read();
      for (const r of first.replacements) if (!sounds.isReplaced(r.name)) await sounds.replace(r.name, r.data);
      const refresh = async () => {
        const next = await read();
        setLab((l) => l && { ...l, ...next });
      };
      setLab({ sounds, ...first, refresh });
    })();
  }, [active]);
  return lab;
}

/** The sounds to list, by group: tier versions under their base; the Leviathan's only when `secret` is shown. */
export function soundList(entries: Record<string, SoundEntry>, showSecret: boolean) {
  const bases = [...new Set(Object.keys(entries).map(soundBaseOf))];
  const groups: { group: string; sounds: string[] }[] = [];
  for (const g of [...SOUND_GROUPS, 'Not described yet']) {
    if (g === 'Leviathan' && !showSecret) continue;
    const sounds = bases.filter((b) => (SOUND_INFO[b]?.group ?? 'Not described yet') === g).sort();
    if (sounds.length) groups.push({ group: g, sounds });
  }
  return groups;
}

/** Which file plays for `base` at `tier`, and at what pitch (as the game does it: Game.playSound). */
export function soundForTier(sounds: Sounds, base: string, tier: number) {
  for (let t = tier; t >= 1; t--) {
    const name = t === 1 ? base : `${base}.t${t}`;
    if (t > 1 && !sounds.has(name)) continue;
    const perTier = sounds.pitchPerTier(name) ?? CONFIG.audio.pitchPerTier;
    return { name, own: t === tier, from: t, pitch: perTier ** (tier - t) };
  }
  return { name: base, own: tier === 1, from: 1, pitch: 1 };
}

const extOf = (fileName: string) => /\.([a-z0-9]+)$/i.exec(fileName)?.[1].toLowerCase() ?? 'wav';
const describeSetting = (e: SoundEntry) =>
  [
    `volume ${e.volume ?? 1}`,
    `up to ${e.maxVoices ?? 4} at once`,
    e.minGap !== undefined && `at least ${e.minGap} s apart`,
    `pitch varies ±${Math.round((e.pitchVariation ?? 0.05) * 100)}%`,
    e.pitchPerTier !== undefined && `pitch per tier ${e.pitchPerTier}`,
  ]
    .filter(Boolean)
    .join(' · ');

interface Props {
  lab: SoundLab;
  base: string;
  tier: number;
  onTier: (t: number) => void;
  onPlay: () => void;
  /** The dev copy: replacements can be written into the game files. */
  canWrite: boolean;
}

export function SoundPanel({ lab, base, tier, onTier, onPlay, canWrite }: Props) {
  const info: SoundInfo | undefined = SOUND_INFO[base];
  const { sounds, entries, replacements } = lab;
  const [status, setStatus] = useState('');
  const [inGame, setInGame] = useState(replacementsInGame);
  const [dropping, setDropping] = useState(false);
  const zipInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tiered = info?.tiered !== false;
  const shown = soundForTier(sounds, base, tiered ? tier : 1);
  const entry = entries[shown.name];
  const replaced = replacements.find((r) => r.name === shown.name);
  const versions = Object.keys(entries).filter((n) => soundBaseOf(n) === base);

  /** Use a file for a sound (in this browser). */
  const replaceWith = async (name: string, fileName: string, type: string, data: ArrayBuffer) => {
    if (!(await sounds.replace(name, data))) return false;
    await putReplacement({ name, fileName, type, data, addedAt: Date.now() });
    return true;
  };

  const dropFile = async (file: File) => {
    if (/\.zip$/i.test(file.name)) return loadZip(file);
    const ok = await replaceWith(shown.name, file.name, file.type, await file.arrayBuffer());
    setStatus(ok ? `${shown.name} now plays ${file.name} (in this browser).` : `Couldn't read ${file.name} as audio.`);
    await lab.refresh();
    if (ok) onPlay();
  };

  const revert = async (name: string) => {
    await sounds.replace(name, null);
    await deleteReplacement(name);
    setStatus(`${name} plays its own file again.`);
    await lab.refresh();
  };

  /** "Download my replacements": every replacement named for its sound, plus a list. */
  const download = () => {
    const enc = new TextEncoder();
    const lines = [
      'Fleet game: replacement sounds from ShipArt (drop this zip on ShipArt → Sounds on the dev copy).',
      '',
      ...replacements.map((r) => `${r.name}.${extOf(r.fileName)}  replaces  ${entries[r.name]?.file ?? '?'}  (was "${r.fileName}")`),
      '',
    ];
    const blob = makeZip([
      ...replacements.map((r) => ({ name: `${r.name}.${extOf(r.fileName)}`, data: new Uint8Array(r.data) })),
      { name: 'replacements.txt', data: enc.encode(lines.join('\r\n')) },
    ]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fleet-sounds-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  /** A zip of replacements (from "Download my replacements"): each file named for its sound. */
  const loadZip = async (file: File) => {
    try {
      const files = await readZip(await file.arrayBuffer());
      let used = 0;
      const skipped: string[] = [];
      for (const f of files) {
        const short = f.name.replace(/^.*\//, '');
        if (short === 'replacements.txt' || short.startsWith('.')) continue;
        const name = short.replace(/\.[^.]+$/, '');
        if (entries[name] && (await replaceWith(name, short, '', f.data))) used++;
        else skipped.push(short);
      }
      setStatus(`Loaded ${used} replacement${used === 1 ? '' : 's'} from ${file.name}.${skipped.length ? ` Skipped (no sound of that name, or not audio): ${skipped.join(', ')}` : ''}`);
    } catch (e) {
      setStatus(`Couldn't read ${file.name}: ${(e as Error).message}`);
    }
    await lab.refresh();
  };

  /** Dev copy: write every replacement into public/assets/sfx and the manifest. */
  const writeAll = async () => {
    if (!confirm(`Write ${replacements.length} replacement sound${replacements.length === 1 ? '' : 's'} into the game files (public/assets/sfx and manifest.json)?`)) return;
    const done: string[] = [];
    const failed: string[] = [];
    for (const r of replacements) {
      const res = await fetch(`/__shipart/sound?name=${encodeURIComponent(r.name)}&ext=${extOf(r.fileName)}`, { method: 'POST', body: r.data });
      const out = await res.json().catch(() => ({ error: 'no answer' }));
      if (res.ok) {
        done.push(`${r.name} → ${out.file}`);
        // It's the game's own file now (already playing here).
        sounds.adopt(r.name);
        await deleteReplacement(r.name);
      } else failed.push(`${r.name}: ${out.error}`);
    }
    setStatus([done.length && `Written: ${done.join(', ')}.`, failed.length && `Not written: ${failed.join('; ')}`].filter(Boolean).join(' '));
    await lab.refresh();
  };

  return (
    <aside className="sa-vfx sa-sound">
      <h2>{base}</h2>
      <p className="sa-sound-use">{info?.use ?? 'Not described yet (add it to src/shipart/soundInfo.ts).'}</p>
      {info?.loop && <p className="sa-note">Loops: the game fades it in and out.</p>}

      <div className="sa-row sa-wrap">
        <button className="sa-sound-play" onClick={onPlay} title="Play it with its scene in the preview">
          ▶ Play
        </button>
        {tiered &&
          SOUND_TIERS.map((t) => (
            <button key={t} className={tier === t ? 'on' : ''} onClick={() => (onTier(t), onPlay())} title={`As played by tier-${t} ships`}>
              Tier {t}
            </button>
          ))}
      </div>
      {tiered && (
        <p className="sa-note">
          {shown.own
            ? `Tier ${tier} plays its own file.`
            : `Tier ${tier} has no file of its own: it plays the tier-${shown.from} sound at ${Math.round(shown.pitch * 100)}% pitch (${shown.pitch < 1 ? 'deeper' : 'brighter'}).`}
        </p>
      )}

      <h2>Settings</h2>
      {versions.sort().map((n) => (
        <div key={n} className="sa-sound-version">
          <b>{n === base ? 'Tier 1' : `Tier ${n.slice(-1)}`}</b> <span className="sa-note">{entries[n].file}</span>
          {replacements.some((r) => r.name === n) && <span className="sa-sound-badge">replaced</span>}
          <div className="sa-note">{describeSetting(entries[n])}</div>
        </div>
      ))}

      <h2>Try another sound</h2>
      <div
        className={'sa-sound-drop' + (dropping ? ' on' : '')}
        onDragOver={(e) => {
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          const f = e.dataTransfer.files[0];
          if (f) void dropFile(f);
        }}
        onClick={() => fileInput.current?.click()}
      >
        {replaced ? (
          <>
            Playing <b>{replaced.fileName}</b> instead of {entry?.file}.
            <br />
            Drop another file to try it instead.
          </>
        ) : (
          <>
            Drop an audio file here (WAV, MP3, OGG…) to hear it instead of <b>{entry?.file}</b>
            {!shown.own && ` (the tier-${shown.from} file)`}. Or click to pick one.
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void dropFile(f);
          }}
        />
      </div>
      {replaced && (
        <button onClick={() => revert(replaced.name)} title="Forget the replacement and play the game's own file">
          Use original
        </button>
      )}
      <p className="sa-note">Only you hear it, in this browser, until it's handed over and added to the game.</p>

      <h2>My replacements ({replacements.length})</h2>
      {replacements.map((r) => (
        <div key={r.name} className="sa-sound-version">
          <b>{r.name}</b> ← {r.fileName}{' '}
          <button className="sa-link" onClick={() => revert(r.name)} title="Use original">
            ✕
          </button>
        </div>
      ))}
      <label className="sa-row" title="The game in this browser plays your replacements too (reload the game tab after changing this)">
        <input
          type="checkbox"
          checked={inGame}
          onChange={(e) => {
            setReplacementsInGame(e.target.checked);
            setInGame(e.target.checked);
          }}
        />
        Use them in the game too (this browser; reload the game)
      </label>
      <div className="sa-row sa-wrap">
        <button onClick={download} disabled={!replacements.length} title="One zip with your files, named for the sounds they replace, to send over">
          Download my replacements
        </button>
        <button onClick={() => zipInput.current?.click()} title="Load a zip made by Download my replacements">
          Load a zip…
        </button>
        <input
          ref={zipInput}
          type="file"
          accept=".zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void loadZip(f);
          }}
        />
      </div>
      {canWrite && (
        <div className="sa-row">
          <button className="sa-save" onClick={writeAll} disabled={!replacements.length} title="Copy every replacement into public/assets/sfx and point the manifest at it (goes live at the next push)">
            Write into the game files
          </button>
        </div>
      )}
      {status && <p className="sa-sound-status">{status}</p>}
    </aside>
  );
}
