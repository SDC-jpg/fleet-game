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

/** Weapon types a gun can fire (see CONFIG.guns.types). */
export const WEAPON_TYPES = ['ballistic', 'energy', 'explosive'] as const;
export type WeaponType = (typeof WEAPON_TYPES)[number];

/**
 * A gun on a ship (placed in ShipArt). Its damage isn't set here: every ship of
 * a tier shares the same damage budget, split between its guns by size
 * (see guns.ts), so more guns means smaller shots.
 */
export interface Gun {
  /** Where its shots start, in the ship's pixels (like mounts). */
  x: number;
  y: number;
  /** Which way it points, in degrees (0 = forward, clockwise). A turret's resting direction and the middle of its arc. */
  angle: number;
  /** Gun size = the tier of shot it fires (1 = a tier-1 ship's shot). */
  size: number;
  type: WeaponType;
  /** true = turns on its own toward its target (turn speed and arc: CONFIG.guns, per size). */
  turret: boolean;
  /** Optional image drawn at the gun, turned with it (parts/gun-….png). */
  image?: string;
  /**
   * Explosive guns: missiles per shot (missing = CONFIG.guns.types.explosive.missiles). They share
   * the shot's damage, so the ship's damage budget stays the same.
   */
  missiles?: number;
}

export interface ArtLayout {
  /** Base image file for a state, instead of the normal image. Missing = the normal image. */
  base: Record<string, string>;
  mounts: Mount[];
  /** Ships only: its guns. Missing = the standard guns for its tier (see defaultGuns in guns.ts). */
  guns?: Gun[];
  /** Named points (objects only), e.g. "impact". */
  points?: Record<string, Point>;
  /**
   * Ships only: the shape shots, missiles and beams hit (circles in the ship's pixels, turning
   * with it; see game/hitShape.ts). Missing = one round hit circle (the tier's hit radius).
   */
  hitShape?: HitCircle[];
  /** Fingerprint of the image's outline when the hit shape was fitted (ShipArt asks to fit again when it changes). */
  hitShapeArt?: string;
}

/** One circle of a ship's hit shape, in the ship's pixels from its centre (facing right). */
export interface HitCircle {
  x: number;
  y: number;
  r: number;
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
  /** Bosses' body layouts, edited in ShipArt (Bosses section). Missing settings use the defaults in leviathan.ts. */
  bosses?: { leviathan?: Partial<LeviathanLayout> };
}

/** A Leviathan's body pieces, head to tail. */
export type LeviathanPieceKind = 'head' | 'segment' | 'antepenultimate' | 'penultimate' | 'tail';

/**
 * How a Leviathan's body is put together (art.json `bosses.leviathan`, ShipArt → Bosses).
 * Each piece's pivot (the point it turns around, which sits on the path) is its image's
 * anchor in the manifest.
 */
export interface LeviathanLayout {
  /** How many repeating segments between the head and the last three pieces. */
  segments: number;
  /** Distance along its path from the head's pivot to the first segment's pivot. */
  headGap: number;
  /** Distance along its path between one segment's pivot and the next. */
  spacing: number;
  /** Distance from the penultimate segment's pivot to the tail's. */
  tailGap: number;
  /** true = the side-view head (as drawn) is for right turns, mirrored for left turns; false = the other way round. */
  sideViewForRightTurns: boolean;
  /** Hit circle radius of each piece, centred on its pivot. */
  hitRadius: Record<LeviathanPieceKind, number>;
  /** Pieces drawn bigger or smaller (and their hit circles), fading out over their neighbours. */
  bulges: LeviathanBulge[];
  /** Fins on the body's pieces (just for looks: no collision). */
  fins: LeviathanFin[];
  /** Where each fin image attaches (its root, in the image's pixels from the top left), by file. Missing = the middle of its left edge. */
  finImages: Record<string, { x: number; y: number }>;
  /** Colour gradients along the body, head to tail, applied in order (each on top of the ones before), like stacked layer styles. */
  gradients: BossGradient[];
}

/** How a gradient mixes with the art under it (like Photoshop blend modes). */
export type BlendMode = 'multiply' | 'screen' | 'color-dodge' | 'linear-dodge' | 'soft-light' | 'hard-light' | 'hue' | 'color';

/** One colour stop of a gradient. */
export interface GradientStop {
  /** Where it sits along the gradient: 0 = its start, 1 = its end. */
  at: number;
  /** Its colour, "#rrggbb". */
  color: string;
  /** How strongly it shows, 0–1 (0 = this part of the gradient leaves the art as it is). */
  opacity: number;
}

/** A colour gradient laid along a boss from head to tail. */
export interface BossGradient {
  mode: BlendMode;
  /** How strongly the whole gradient shows, 0–1. */
  opacity: number;
  /** Where its start and end fall along the body: 0 = the tip of the head, 1 = the end of the tail (can go past either end). Before its start and after its end it keeps its first / last colour. */
  start: number;
  end: number;
  /** At least two, any order (sorted when used). */
  stops: GradientStop[];
  /** Switched off (kept, but not drawn). */
  hidden?: boolean;
}

/** The fin image used when a fin doesn't name one. */
export const DEFAULT_FIN_IMAGE = 'bosses/leviathan/fin.png';

/**
 * A fin on a Leviathan's piece. Its image points right (from its root toward its tip) and bends at
 * its joints, trailing behind the body's movement (CONFIG.leviathan fin settings).
 */
export interface LeviathanFin {
  /** Which piece it's on: 0 = the head, 1 = the first segment... (counted from the head). */
  piece: number;
  /** Where its root sits on the piece: x forward, y toward the creature's right side (pixels from the piece's pivot). */
  x: number;
  y: number;
  /** Which way it points, in degrees: 0 = forward, 90 = out to the right, 180 = backward, −90 = out to the left. */
  angle: number;
  /** Its size: 1 = the image's own size. */
  scale: number;
  /** Mirrored across its length (its top and bottom edges swap). */
  flip: boolean;
  /** Drawn over its piece (otherwise under it). Either way it keeps its piece's place in the layering. */
  front: boolean;
  /** Its image (a file in the art folder); none = DEFAULT_FIN_IMAGE. */
  image?: string;
}

/** A bulge on one piece of a Leviathan's body. */
export interface LeviathanBulge {
  /** Which piece: 0 = the head, 1 = the first segment... (counted from the head). */
  piece: number;
  /** Its size there: 1 = normal, 1.5 = half as big again, 0.7 = smaller. */
  scale: number;
  /** How many pieces on each side also get some of it (0 = only this one). */
  falloff: number;
  /** Shape of the fade over the falloff (a Bezier curve): 0 = even, + = stays big then drops, − = drops fast then trails off. */
  curve: number;
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
    for (const g of layout.guns ?? []) if (g.image) files.add(g.image);
  }
  // The Leviathan's fin images.
  files.add(DEFAULT_FIN_IMAGE);
  for (const f of data.bosses?.leviathan?.fins ?? []) if (f.image) files.add(f.image);
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
        ...(json.bosses ? { bosses: json.bosses } : {}),
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
