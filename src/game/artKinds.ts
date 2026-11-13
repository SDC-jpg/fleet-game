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
  /** Preview only: this state plays the effect of this point (e.g. Impact), with the object shown faintly. */
  point?: string;
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
  /** The art folder its alternative base images come from. */
  baseFolder: string;
  /** false = drawn in its own colours on both sides (no team recolouring), like wrecks. */
  teamColored?: boolean;
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
  baseFolder: 'ships/',
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
    { id: 'impact', label: 'Impact', uses: 'fired', point: 'impact' },
    { id: 'sequence', label: 'Sequence', uses: 'fired' },
  ],
  mountStates: ['inert', 'fired'],
  points: [{ id: 'impact', label: 'Impact', effect: 'vfx.missile-hit' }],
  baseFolder: 'projectiles/',
};

/** Mines: sit blinking (Armed) until an enemy comes near, then blow up (Blast). */
export const MINE_KIND: ArtKind = {
  id: 'mine',
  label: 'Mine',
  section: 'objects',
  matches: (s) => /^projectile\.mine(\.t\d+)?$/.test(s),
  states: [
    { id: 'armed', label: 'Armed', uses: 'armed' },
    { id: 'blast', label: 'Blast', uses: 'armed', point: 'blast' },
  ],
  mountStates: ['armed'],
  points: [{ id: 'blast', label: 'Blast', effect: 'vfx.mine-blast' }],
  baseFolder: 'projectiles/',
};

/** Gun shots: fly (Flying), then spark where they hit (Hit). */
export const SHOT_KIND: ArtKind = {
  id: 'shot',
  label: 'Gun shot',
  section: 'objects',
  matches: (s) => /^projectile(\.t\d+)?$/.test(s),
  states: [
    { id: 'flying', label: 'Flying', uses: 'flying' },
    { id: 'hit', label: 'Hit', uses: 'flying', point: 'hit' },
  ],
  mountStates: ['flying'],
  points: [{ id: 'hit', label: 'Hit', effect: 'vfx.hit' }],
  baseFolder: 'projectiles/',
};

/**
 * Laser: an elite's aim line (Warning), then the beam (Beam). The beam is the
 * vfx.laser image repeated along its length; mounts sit at the muzzle (where
 * the beam starts), e.g. a flash or sparks.
 */
export const LASER_KIND: ArtKind = {
  id: 'laser',
  label: 'Laser',
  section: 'objects',
  matches: (s) => /^vfx\.laser(\.t\d+)?$/.test(s),
  states: [
    { id: 'warning', label: 'Warning', uses: 'warning' },
    { id: 'beam', label: 'Beam', uses: 'beam' },
  ],
  mountStates: ['warning', 'beam'],
  points: [],
  baseFolder: 'vfx/',
};

/** Wrecks: drift and spin slowly until a ship flies into them. */
export const WRECK_KIND: ArtKind = {
  id: 'wreck',
  label: 'Wreck',
  section: 'objects',
  matches: (s) => /^ship\.[a-z]+(\.t\d+)?\.wreck$/.test(s),
  states: [{ id: 'drifting', label: 'Drifting', uses: 'drifting' }],
  mountStates: ['drifting'],
  points: [],
  baseFolder: 'ships/',
  teamColored: false,
};

/** Every object kind (in the Objects section of ShipArt). */
export const OBJECT_KINDS: ArtKind[] = [MISSILE_KIND, MINE_KIND, SHOT_KIND, LASER_KIND, WRECK_KIND];

export const ALL_KINDS: ArtKind[] = [SHIP_KIND, ...OBJECT_KINDS];

/** The kind a sprite belongs to, if any. */
export const kindOf = (sprite: string) => ALL_KINDS.find((k) => k.matches(sprite));

/** The tier in a sprite name ("ship.fighter.t3" → 3, "ship.fighter.t2.wreck" → 2; no tier → 1). */
export const tierOf = (sprite: string) => Number(/\.t(\d+)(\.wreck)?$/.exec(sprite)?.[1] ?? 1);
