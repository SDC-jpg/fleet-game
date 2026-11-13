// Loads public/assets/manifest.json and the images it lists.
// The rest of the game asks for art by name (e.g. "vfx.explosion"), never by file path.

/** One entry in manifest.json. Only `file` or `files` is required. */
export interface ManifestEntry {
  file?: string;
  files?: string[];
  frameWidth?: number;
  frameHeight?: number;
  frames?: number;
  fps?: number;
  loop?: boolean;
  anchorX?: number;
  anchorY?: number;
}

/** One animation frame: which image, and which rectangle of it. */
export interface Frame {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  w: number;
  h: number;
}

/** A ready-to-draw sprite (a single picture is just a 1-frame animation). */
export interface Sprite {
  frames: Frame[];
  fps: number;
  loop: boolean;
  anchorX: number;
  anchorY: number;
}

export const ASSET_ROOT = `${import.meta.env.BASE_URL}assets/`;
// While developing, add a timestamp to URLs so the browser always fetches fresh art.
const CACHE_BUST = import.meta.env.DEV ? `?t=${Date.now()}` : '';

function loadImage(path: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = ASSET_ROOT + path + CACHE_BUST;
  });
}

/** Pink checkerboard drawn when art is missing, so problems are obvious. */
function makeMissingSprite(): Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#000' : '#ff00ff';
      ctx.fillRect(x * 4, y * 4, 4, 4);
    }
  return { frames: [{ image: c, sx: 0, sy: 0, w: 16, h: 16 }], fps: 0, loop: true, anchorX: 8, anchorY: 8 };
}

export class Assets {
  private sprites = new Map<string, Sprite>();
  /** The (first) image file of each sprite, e.g. "vfx/particle-move.png". */
  private files = new Map<string, string>();
  /** Each manifest sprite's entry as loaded (ShipArt edits and saves them). */
  private entries = new Map<string, ManifestEntry>();
  private missing = makeMissingSprite();
  /** Human-readable list of anything that failed to load. Shown on screen. */
  problems: string[] = [];

  static async load(): Promise<Assets> {
    const assets = new Assets();
    const res = await fetch(ASSET_ROOT + 'manifest.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load assets/manifest.json (${res.status})`);
    let manifest: { sprites?: Record<string, ManifestEntry> };
    try {
      manifest = await res.json();
    } catch (e) {
      throw new Error(`assets/manifest.json is not valid JSON: ${(e as Error).message}`);
    }
    const entries = Object.entries(manifest.sprites ?? {});
    for (const [name, entry] of entries) assets.entries.set(name, entry);
    await Promise.all(entries.map(([name, entry]) => assets.loadSprite(name, entry)));
    return assets;
  }

  private async loadSprite(name: string, entry: ManifestEntry) {
    const paths = entry.files ?? (entry.file ? [entry.file] : []);
    if (paths.length === 0) {
      this.problems.push(`${name}: no "file" or "files" in manifest`);
      return;
    }
    this.files.set(name, paths[0]);
    const images = await Promise.all(paths.map(loadImage));
    const frames: Frame[] = [];
    images.forEach((img, i) => {
      if (!img) {
        this.problems.push(`${name}: could not load ${paths[i]}`);
        return;
      }
      const fw = entry.frameWidth ?? img.width;
      const fh = entry.frameHeight ?? img.height;
      const cols = Math.max(1, Math.floor(img.width / fw));
      const rows = Math.max(1, Math.floor(img.height / fh));
      // With one sheet, `frames` limits how many cells are used. With many files, one frame per file.
      const count = entry.files ? 1 : Math.min(entry.frames ?? cols * rows, cols * rows);
      for (let f = 0; f < count; f++) {
        frames.push({ image: img, sx: (f % cols) * fw, sy: Math.floor(f / cols) * fh, w: fw, h: fh });
      }
    });
    if (frames.length === 0) return;
    this.sprites.set(name, {
      frames,
      fps: entry.fps ?? 12,
      loop: entry.loop ?? true,
      anchorX: entry.anchorX ?? frames[0].w / 2,
      anchorY: entry.anchorY ?? frames[0].h / 2,
    });
  }

  /**
   * Load an image file that isn't in the manifest (e.g. a ship part chosen in
   * the ShipArt tool), as sprite `name`. Its frames sit side by side. Loading
   * the same name again replaces it (e.g. after changing its frame count).
   */
  async loadFile(name: string, file: string, settings: { frames?: number; fps?: number; loop?: boolean } = {}) {
    this.problems = this.problems.filter((p) => !p.startsWith(name + ':'));
    const img = await loadImage(file);
    if (!img) {
      this.problems.push(`${name}: could not load ${file}`);
      this.sprites.delete(name);
      return;
    }
    const frames = Math.max(1, Math.floor(settings.frames ?? 1));
    await this.loadSprite(name, { file, frameWidth: Math.floor(img.width / frames), frames, fps: settings.fps, loop: settings.loop });
    // Recoloured copies were made from the old version.
    for (const key of this.recolorCache.keys()) if (key.startsWith(name + '|')) this.recolorCache.delete(key);
  }

  /** A manifest sprite's entry (its files and frame settings), if it has one. */
  entryOf(name: string): ManifestEntry | undefined {
    return this.entries.get(name);
  }

  /** Every file a sprite's frames come from. */
  filesOf(name: string): string[] {
    const e = this.entries.get(name);
    return e ? (e.files ?? (e.file ? [e.file] : [])) : [];
  }

  /** Replace a manifest sprite's entry and reload it (ShipArt: new speed, loop, or images). */
  async setEntry(name: string, entry: ManifestEntry) {
    this.entries.set(name, entry);
    this.problems = this.problems.filter((p) => !p.startsWith(name + ':'));
    await this.loadSprite(name, entry);
    for (const key of this.recolorCache.keys()) if (key.startsWith(name + '|')) this.recolorCache.delete(key);
  }

  /** The image file a sprite comes from (relative to the assets folder), if known. */
  fileOf(name: string) {
    return this.files.get(name);
  }

  /** Names of every loaded sprite. */
  names() {
    return [...this.sprites.keys()];
  }

  /** True if the manifest has a sprite with this name (and it loaded). */
  has(name: string) {
    return this.sprites.has(name);
  }

  /** Get a sprite by name. Returns the pink "missing" sprite if it doesn't exist. */
  get(name: string): Sprite {
    const s = this.sprites.get(name);
    if (s) return s;
    if (!this.problems.some((p) => p.startsWith(name + ':'))) this.problems.push(`${name}: not in manifest`);
    return this.missing;
  }

  private recolorCache = new Map<string, Sprite>();

  /**
   * Get a sprite with some of its colours turned around the colour wheel.
   * Only pixels whose hue (0–360°) is between `rule.hueMin` and `rule.hueMax`
   * and whose saturation (0–1) is at least `rule.minSaturation` change, by
   * `shift` degrees. Brightness and saturation stay the same, so shading
   * survives. The copy is made once and reused.
   */
  getRecolored(name: string, shift: number, rule: RecolorRule): Sprite {
    const source = this.get(name);
    if (shift % 360 === 0) return source;
    const key = `${name}|${shift}|${rule.hueMin}|${rule.hueMax}|${rule.minSaturation}`;
    let sprite = this.recolorCache.get(key);
    if (!sprite) {
      sprite = recolorSprite(source, shift, rule);
      this.recolorCache.set(key, sprite);
    }
    return sprite;
  }
}

/** Which pixels Assets.getRecolored changes. */
export interface RecolorRule {
  hueMin: number;
  hueMax: number;
  minSaturation: number;
}

function recolorSprite(source: Sprite, shift: number, rule: RecolorRule): Sprite {
  // Several frames can share one sprite sheet image, so recolour each image only once.
  const copies = new Map<CanvasImageSource, HTMLCanvasElement>();
  const frames = source.frames.map((f) => {
    let copy = copies.get(f.image);
    if (!copy) {
      copy = recolorImage(f.image, shift, rule);
      copies.set(f.image, copy);
    }
    return { ...f, image: copy };
  });
  return { ...source, frames };
}

function recolorImage(image: CanvasImageSource, shift: number, { hueMin, hueMax, minSaturation }: RecolorRule) {
  const { width, height } = image as HTMLImageElement | HTMLCanvasElement;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue; // fully transparent
    const [h, s, v] = rgbToHsv(d[i], d[i + 1], d[i + 2]);
    if (s === 0 || s < minSaturation) continue; // greys (even slightly tinted ones) stay
    // A range like 330–30 wraps around red.
    const inRange = hueMin <= hueMax ? h >= hueMin && h <= hueMax : h >= hueMin || h <= hueMax;
    if (!inRange) continue;
    [d[i], d[i + 1], d[i + 2]] = hsvToRgb(h + shift, s, v);
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

/** r, g, b in 0–255 → hue in degrees (0–360), saturation and value in 0–1. */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;
  let h = 0;
  if (c > 0) {
    if (max === r) h = ((g - b) / c) % 6;
    else if (max === g) h = (b - r) / c + 2;
    else h = (r - g) / c + 4;
  }
  return [(h * 60 + 360) % 360, max === 0 ? 0 : c / max, max / 255];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

/** Which frame to show `time` seconds after an animation started. */
export function frameAt(sprite: Sprite, time: number): Frame {
  const n = sprite.frames.length;
  if (n === 1 || sprite.fps <= 0) return sprite.frames[0];
  const i = Math.floor(time * sprite.fps);
  return sprite.frames[sprite.loop ? i % n : Math.min(i, n - 1)];
}

/** How long a play-once animation lasts, in seconds. */
export function spriteDuration(sprite: Sprite) {
  return sprite.fps > 0 ? sprite.frames.length / sprite.fps : 0;
}
