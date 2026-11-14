// Art layouts: how ships and other objects (missiles...) are dressed up in the
// game. Edited with the ShipArt tool (shipart.html) and saved in
// public/assets/art.json.
//
// A layout gives a ship or object its base image for each state (the normal
// image by default), a list of "mounts" and, for objects, named points.
// - A mount is something placed on it: an image (a thruster, a flame), a
//   particle emitter, or both. It has an image for each state it shows in
//   (none = hidden then) and particle settings for each state it gives off
//   particles in (none = no particles then). Particles come from its VFX point.
// - A point marks a spot, like where a missile's impact burst appears.
//
// Positions are in the image's pixels, measured from its centre (anchor):
// +x is forward (ships and objects face right in their art), +y is down.

import { ASSET_ROOT, type Assets } from '../engine/assets';

/** States a ship can be drawn in. Mounts and base images can differ per state. */
export const SHIP_STATES = ['idle', 'move', 'boost'] as const;
export type ShipState = (typeof SHIP_STATES)[number];

/** How a particle emitter spawns particles. */
export interface ParticleSettings {
  /** The particle's look: a sprite name from the manifest (e.g. "vfx.particle.boost"). */
  sprite: string;
  /** Particles per second. */
  perSecond: number;
  /** Starting speed (game pixels per second). */
  speed: number;
  /** Width of the cone particles fly out in, in degrees, centred on straight back (0 = a line, 360 = every direction). */
  angle: number;
  /** Seconds each particle lasts. */
  life: number;
  /** How quickly particles slow down (0 = never; 3 = lose most of their speed in about a second). */
  drag: number;
}

export interface Mount {
  /** What kind of part it is: the start of its image names ("thruster" for parts/thruster-boost-1.png), or "emitter" for particles only. */
  category: string;
  x: number;
  y: number;
  /** Rotation in degrees (clockwise; 0 = as drawn). Particles fly out the back (toward -x). */
  angle: number;
  /** Mirror left–right / top–bottom. */
  flipX: boolean;
  flipY: boolean;
  /** Size compared to the image (1 = as drawn; whole numbers keep pixels crisp). */
  scale: number;
  /** true = drawn under the ship, false = on top. */
  behind: boolean;
  /** Where particles come from, relative to the mount's centre (in ship pixels, not rotated with the mount). */
  vfxX: number;
  vfxY: number;
  /**
   * Image for each state it shows in: a file ("parts/thruster-boost-1.png") or a
   * folder of frame files ending in "/" ("parts/thruster-boost-3/"). Missing = hidden in that state.
   */
  images: Record<string, string>;
  /**
   * Particles for each state it gives them off in (missing = none in that state).
   * Each holds only what differs from the defaults for its category (see particleSettings).
   */
  emit?: Record<string, Partial<ParticleSettings>>;
}

/** A spot on an object, e.g. where its impact burst appears. */
export interface Point {
  x: number;
  y: number;
}

export interface ArtLayout {
  /** Base image file for a state, instead of the normal image. Missing = the normal image. */
  base: Record<string, string>;
  mounts: Mount[];
  /** Named points (objects only), e.g. "impact". */
  points?: Record<string, Point>;
}

/** Animation settings for an image file or frame folder (most are single pictures and need none). */
export interface ImageSettings {
  /** Frames side by side in the file (not used for a folder: there, each file is a frame). */
  frames?: number;
  fps?: number;
  loop?: boolean;
}

/** The whole art.json file. */
export interface ArtLayoutsFile {
  _readme?: string;
  /** Layouts by ship sprite name ("ship.fighter", "ship.fighter.t2"...). */
  ships: Record<string, ArtLayout>;
  /** Layouts by object sprite name ("projectile.missile", "projectile.missile.t2"...). */
  objects: Record<string, ArtLayout>;
  /** Default particle settings by mount category, then state (e.g. thruster → boost). Edited in ShipArt. */
  particleDefaults: Record<string, Record<string, Partial<ParticleSettings>>>;
  /** Animation settings by image file. */
  images: Record<string, ImageSettings>;
}

export const emptyLayouts = (): ArtLayoutsFile => ({ ships: {}, objects: {}, particleDefaults: {}, images: {} });
export const emptyLayout = (): ArtLayout => ({ base: {}, mounts: [] });

/** Used for any particle setting that neither the mount nor its category's defaults give. */
export const FALLBACK_PARTICLES: ParticleSettings = { sprite: 'vfx.particle.move', perSecond: 10, speed: 35, angle: 30, life: 0.35, drag: 0 };

/** The default particle settings for a category of mount in a state (from art.json). */
export const particleDefaults = (data: ArtLayoutsFile, category: string, state: string): ParticleSettings => ({
  ...FALLBACK_PARTICLES,
  ...data.particleDefaults[category]?.[state],
});

/** A mount's particle settings for a state: its own values, then its category's defaults. */
export const particleSettings = (data: ArtLayoutsFile, m: Mount, state: string): ParticleSettings => ({
  ...particleDefaults(data, m.category, state),
  ...m.emit?.[state],
});

/** The sprite name an image file is loaded under (see Assets.loadFile). */
export const fileSprite = (file: string) => `file:${file}`;

/** A folder of frame files, one image made of every PNG in it ("parts/thruster-boost-3/"). */
export const isFrameFolder = (image: string) => image.endsWith('/');

/** The frame files in a folder, from a list of art files, in name order (numbers counted properly: 2 before 10). */
export const framesIn = (folder: string, artFiles: string[]) =>
  artFiles
    .filter((f) => f.startsWith(folder) && !f.slice(folder.length).includes('/') && /\.png$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

/**
 * The images mounts can use: every PNG directly in parts/, plus each folder
 * inside parts/ as one animated image ("parts/thruster-boost-3/").
 */
export function partImages(artFiles: string[]): string[] {
  const out = new Set<string>();
  for (const f of artFiles) {
    if (!f.startsWith('parts/')) continue;
    const rest = f.slice('parts/'.length);
    out.add(rest.includes('/') ? `parts/${rest.split('/')[0]}/` : f);
  }
  return [...out].sort();
}

/** Every art file in the project (from the dev server, or the list written into published builds). */
export async function fetchArtFileList(): Promise<string[]> {
  const url = import.meta.env.DEV ? '/__shipart/files' : ASSET_ROOT + 'art-files.json';
  return (await (await fetch(url, { cache: 'no-store' })).json()).files;
}

/** Load an image file or frame folder as its sprite (see fileSprite), with its animation settings. */
export const loadLayoutImage = (assets: Assets, image: string, settings: ImageSettings | undefined, artFiles: string[]) =>
  assets.loadFile(fileSprite(image), isFrameFolder(image) ? framesIn(image, artFiles) : image, settings);

/** Every image file (or frame folder) a layouts file uses. */
export function layoutFiles(data: ArtLayoutsFile): string[] {
  const files = new Set<string>();
  for (const layout of [...Object.values(data.ships), ...Object.values(data.objects)]) {
    for (const f of Object.values(layout.base)) if (f) files.add(f);
    for (const m of layout.mounts) for (const f of Object.values(m.images)) if (f) files.add(f);
  }
  return [...files];
}

/**
 * A point on a ship or object (in its pixels) in the world, for one at (x, y)
 * facing `angle` (radians).
 */
export function shipPointToWorld(px: number, py: number, x: number, y: number, angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x + px * c - py * s, y: y + px * s + py * c };
}

/** The reverse: a world point to ship pixels. */
export function worldToShipPoint(wx: number, wy: number, x: number, y: number, angle: number) {
  const dx = wx - x;
  const dy = wy - y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** Which way a mount points in the world (radians): forward along its image, flipped if mirrored. */
export function mountWorldAngle(m: Mount, shipAngle: number) {
  return shipAngle + (m.angle * Math.PI) / 180 + (m.flipX ? Math.PI : 0);
}

/**
 * Load public/assets/art.json (none yet = no layouts) and every image file it
 * uses, so the game can draw them by name (see fileSprite).
 */
export async function loadArtLayouts(assets: Assets): Promise<ArtLayoutsFile> {
  let data = emptyLayouts();
  try {
    const res = await fetch(ASSET_ROOT + 'art.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      // Same order as the file, so saving from ShipArt keeps the note at the top.
      data = {
        _readme: json._readme,
        ships: json.ships ?? {},
        objects: json.objects ?? {},
        particleDefaults: json.particleDefaults ?? {},
        images: json.images ?? {},
      };
    }
  } catch (e) {
    assets.problems.push(`art.json: ${(e as Error).message}`);
  }
  const images = layoutFiles(data);
  // Frame folders need the list of files to know their frames.
  let artFiles: string[] = [];
  if (images.some(isFrameFolder))
    try {
      artFiles = await fetchArtFileList();
    } catch (e) {
      assets.problems.push(`art file list: ${(e as Error).message}`);
    }
  await Promise.all(images.map((f) => loadLayoutImage(assets, f, data.images[f], artFiles)));
  return data;
}
