// Ship layouts: how each ship image is dressed up in the game, edited with the
// ShipArt tool (shipart.html) and saved in public/assets/ships.json.
//
// A layout gives a ship its base image for each state (idle by default) and a
// list of "mounts": extra images placed on the ship, like thrusters. Each mount
// has an image for each state it shows in (none = hidden in that state) and a
// VFX point where its particles come from.
//
// Positions are in the ship image's pixels, measured from its centre (anchor):
// +x is forward (ships face right in their art), +y is down.

import { ASSET_ROOT, type Assets } from '../engine/assets';
import { CONFIG } from './config';

/** States a ship can be drawn in. Mounts and base images can differ per state. */
export const SHIP_STATES = ['idle', 'move', 'boost'] as const;
export type ShipState = (typeof SHIP_STATES)[number];

export interface Mount {
  /** What kind of part it is: the start of its image names ("thruster" for parts/thruster-boost-1.png). */
  category: string;
  x: number;
  y: number;
  /** Rotation in degrees (clockwise; 0 = as drawn). */
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
  /** Image file for each state it shows in (e.g. "parts/thruster-boost-1.png"). Missing = hidden in that state. */
  images: Partial<Record<ShipState, string>>;
  /** This mount's particle settings per state, where they differ from CONFIG.particles. */
  vfx?: Partial<Record<ParticleState, Partial<ParticleSettings>>>;
}

/** States that give off particles. */
export type ParticleState = Exclude<ShipState, 'idle'>;
export const PARTICLE_STATES: ParticleState[] = ['move', 'boost'];

/** How a VFX source spawns particles (defaults in CONFIG.particles). */
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

/** A mount's particle settings for a state: its own values, or the defaults. */
export const particleSettings = (m: Mount, state: ParticleState): ParticleSettings => ({
  ...CONFIG.particles[state],
  ...m.vfx?.[state],
});

export interface ShipLayout {
  /** Base image file for a state, instead of the ship's normal image. Missing = the normal image. */
  base: Partial<Record<ShipState, string>>;
  mounts: Mount[];
}

/** Animation settings for an image file (most are single pictures and need none). */
export interface ImageSettings {
  /** Frames side by side in the file. */
  frames?: number;
  fps?: number;
  loop?: boolean;
}

/** The whole ships.json file. */
export interface ShipLayoutsFile {
  _readme?: string;
  /** Layouts by ship sprite name ("ship.fighter", "ship.fighter.t2"...). */
  ships: Record<string, ShipLayout>;
  /** Animation settings by image file. */
  images: Record<string, ImageSettings>;
}

export const emptyLayouts = (): ShipLayoutsFile => ({ ships: {}, images: {} });

/** The sprite name an image file is loaded under (see Assets.loadFile). */
export const fileSprite = (file: string) => `file:${file}`;

/** Every image file a layouts file uses. */
export function layoutFiles(data: ShipLayoutsFile): string[] {
  const files = new Set<string>();
  for (const layout of Object.values(data.ships)) {
    for (const f of Object.values(layout.base)) if (f) files.add(f);
    for (const m of layout.mounts) for (const f of Object.values(m.images)) if (f) files.add(f);
  }
  return [...files];
}

/**
 * A point on a ship (in ship pixels) in the world, for a ship at (x, y)
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
 * Load public/assets/ships.json (none yet = no layouts) and every image file it
 * uses, so the game can draw them by name (see fileSprite).
 */
export async function loadShipLayouts(assets: Assets): Promise<ShipLayoutsFile> {
  let data = emptyLayouts();
  try {
    const res = await fetch(ASSET_ROOT + 'ships.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      // Same order as the file, so saving from ShipArt keeps the note at the top.
      data = { _readme: json._readme, ships: json.ships ?? {}, images: json.images ?? {} };
    }
  } catch (e) {
    assets.problems.push(`ships.json: ${(e as Error).message}`);
  }
  await Promise.all(layoutFiles(data).map((f) => assets.loadFile(fileSprite(f), f, data.images[f])));
  return data;
}
