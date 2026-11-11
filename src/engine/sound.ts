// Loads the "sounds" section of public/assets/manifest.json and plays them.
// The rest of the game asks for sounds by name (e.g. "sfx.explosion"), never by file.

/** One entry in the manifest's "sounds" section. Only `file` is required. */
interface SoundEntry {
  file: string;
  /** 0–1 (can go above 1 to boost a quiet file). */
  volume?: number;
  /** Random pitch change per play, e.g. 0.05 = up to 5% higher or lower. */
  pitchVariation?: number;
  /** How many copies of this sound may play at the same time. */
  maxVoices?: number;
  /** Shortest time (seconds) between two starts of this sound. */
  minGap?: number;
}

interface LoadedSound {
  buffer: AudioBuffer;
  volume: number;
  pitchVariation: number;
  maxVoices: number;
  minGap: number;
  playing: number;
  lastStart: number;
}

export interface PlayOptions {
  /** Extra volume factor, 0–1. */
  volume?: number;
  /** Playback speed: below 1 is lower and slower. */
  pitch?: number;
  /** Left (-1) to right (1). */
  pan?: number;
}

const ASSET_ROOT = `${import.meta.env.BASE_URL}assets/`;
const CACHE_BUST = import.meta.env.DEV ? `?t=${Date.now()}` : '';
const STORAGE_KEY = 'fleet.soundOn';

function readSavedOn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sounds = new Map<string, LoadedSound>();
  private masterVolume = 1;
  /** Is sound switched on (the M key / speaker button)? Remembered between visits. */
  enabled = readSavedOn();
  /** Human-readable list of anything that failed to load. Shown on screen. */
  problems: string[] = [];

  /** Load every sound in the manifest. Never throws: problems are listed instead. */
  static async load(masterVolume: number): Promise<Sounds> {
    const sounds = new Sounds();
    sounds.masterVolume = masterVolume;
    try {
      sounds.ctx = new AudioContext();
      sounds.master = sounds.ctx.createGain();
      sounds.master.connect(sounds.ctx.destination);
      sounds.applyVolume();
      sounds.unlockOnFirstInput();
      const res = await fetch(ASSET_ROOT + 'manifest.json', { cache: 'no-store' });
      const manifest = (await res.json()) as { sounds?: Record<string, SoundEntry> };
      await Promise.all(Object.entries(manifest.sounds ?? {}).map(([name, e]) => sounds.loadSound(name, e)));
    } catch (e) {
      sounds.problems.push(`sound: ${(e as Error).message}`);
    }
    return sounds;
  }

  private async loadSound(name: string, entry: SoundEntry) {
    if (!entry.file) {
      this.problems.push(`${name}: no "file" in manifest`);
      return;
    }
    try {
      const res = await fetch(ASSET_ROOT + entry.file + CACHE_BUST);
      if (!res.ok) throw new Error();
      const buffer = await this.ctx!.decodeAudioData(await res.arrayBuffer());
      this.sounds.set(name, {
        buffer,
        volume: entry.volume ?? 1,
        pitchVariation: entry.pitchVariation ?? 0.05,
        maxVoices: entry.maxVoices ?? 4,
        minGap: entry.minGap ?? 0.03,
        playing: 0,
        lastStart: -Infinity,
      });
    } catch {
      this.problems.push(`${name}: could not load or play ${entry.file}`);
    }
  }

  /** Browsers only allow sound after the player clicks or presses a key. */
  private unlockOnFirstInput() {
    const unlock = () => {
      void this.ctx?.resume();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  private applyVolume() {
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(this.enabled ? this.masterVolume : 0, this.ctx.currentTime, 0.02);
  }

  /** Switch all sound on or off (and remember it). */
  toggle() {
    this.enabled = !this.enabled;
    this.applyVolume();
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off');
    } catch {
      // Storage blocked (private window): the setting just isn't remembered.
    }
  }

  /** True if the manifest has a sound with this name (and it loaded). */
  has(name: string) {
    return this.sounds.has(name);
  }

  /** Play a sound by name. Quietly does nothing if it's missing, muted or playing too often. */
  play(name: string, opts: PlayOptions = {}) {
    const ctx = this.ctx;
    const s = this.sounds.get(name);
    if (!ctx || !this.master || !s || !this.enabled || ctx.state !== 'running') return;
    const volume = s.volume * (opts.volume ?? 1);
    if (volume <= 0.001) return;
    const now = ctx.currentTime;
    if (s.playing >= s.maxVoices || now - s.lastStart < s.minGap) return;

    const source = ctx.createBufferSource();
    source.buffer = s.buffer;
    source.playbackRate.value = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * s.pitchVariation);
    const gain = ctx.createGain();
    gain.gain.value = volume;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
    source.connect(gain).connect(panner).connect(this.master);
    s.playing++;
    s.lastStart = now;
    source.onended = () => s.playing--;
    source.start();
  }
}
