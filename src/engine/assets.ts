// Loads public/assets/manifest.json and the images it lists.
// The rest of the game asks for art by name (e.g. "vfx.explosion"), never by file path.

/** One entry in manifest.json. Only `file` or `files` is required. */
interface ManifestEntry {
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

const ASSET_ROOT = `${import.meta.env.BASE_URL}assets/`;
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
    await Promise.all(entries.map(([name, entry]) => assets.loadSprite(name, entry)));
    return assets;
  }

  private async loadSprite(name: string, entry: ManifestEntry) {
    const paths = entry.files ?? (entry.file ? [entry.file] : []);
    if (paths.length === 0) {
      this.problems.push(`${name}: no "file" or "files" in manifest`);
      return;
    }
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

  /** Get a sprite by name. Returns the pink "missing" sprite if it doesn't exist. */
  get(name: string): Sprite {
    const s = this.sprites.get(name);
    if (s) return s;
    if (!this.problems.some((p) => p.startsWith(name + ':'))) this.problems.push(`${name}: not in manifest`);
    return this.missing;
  }
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
