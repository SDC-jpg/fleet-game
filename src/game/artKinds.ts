// The kinds of things ShipArt can show and edit: ships, and objects such as
// missiles. Each kind lists its states (the buttons above ShipArt's preview),
// which of those states mounts and particles can be set for, and its named
// points. Adding an object kind here makes it appear in ShipArt; the game
// then draws it from its layout in art.json (see render.ts).

export interface ArtState {
  id: string;
  label: string;
  /** The state its mounts and particles use (e.g. Dash shows a ship's Move thrusters). */
  uses: string;
}

export interface ArtKind {
  id: string;
  label: string;
  /** Which layouts section of art.json it's in. */
  section: 'ships' | 'objects';
  /** Which manifest sprites are this kind (one per tier). */
  matches: (sprite: string) => boolean;
  /** Preview states, in button order. */
  states: ArtState[];
  /** States that mounts can have images and particles for (in panel order). */
  mountStates: string[];
  /** Named points that can be placed, and the effect each one shows. */
  points: { id: string; label: string; effect: string }[];
}

export const SHIP_KIND: ArtKind = {
  id: 'ship',
  label: 'Ships',
  section: 'ships',
  matches: (s) => /^ship\.[a-z]+(\.t\d+)?$/.test(s),
  states: [
    { id: 'idle', label: 'Idle', uses: 'idle' },
    { id: 'move', label: 'Move', uses: 'move' },
    { id: 'boost', label: 'Boost', uses: 'boost' },
    { id: 'dash', label: 'Dash', uses: 'move' },
  ],
  mountStates: ['idle', 'move', 'boost'],
  points: [],
};

/** Missiles: drift out of the ship unlit (Inert), fire up and fly (Fired up), then burst (Impact). */
export const MISSILE_KIND: ArtKind = {
  id: 'missile',
  label: 'Missile',
  section: 'objects',
  matches: (s) => /^projectile\.missile(\.t\d+)?$/.test(s),
  states: [
    { id: 'inert', label: 'Inert', uses: 'inert' },
    { id: 'fired', label: 'Fired up', uses: 'fired' },
    { id: 'impact', label: 'Impact', uses: 'fired' },
    { id: 'sequence', label: 'Sequence', uses: 'fired' },
  ],
  mountStates: ['inert', 'fired'],
  points: [{ id: 'impact', label: 'Impact', effect: 'vfx.missile-hit' }],
};

/** Every object kind (in the Objects section of ShipArt). */
export const OBJECT_KINDS: ArtKind[] = [MISSILE_KIND];

export const ALL_KINDS: ArtKind[] = [SHIP_KIND, ...OBJECT_KINDS];

/** The kind a sprite belongs to, if any. */
export const kindOf = (sprite: string) => ALL_KINDS.find((k) => k.matches(sprite));

/** The tier in a sprite name ("ship.fighter.t3" → 3; no tier → 1). */
export const tierOf = (sprite: string) => Number(/\.t(\d+)$/.exec(sprite)?.[1] ?? 1);
