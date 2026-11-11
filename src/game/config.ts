// All the tuning numbers in one place. Change these to change how the game feels.
// Distances are in game pixels, times in seconds, speeds in pixels per second.

export interface ShipType {
  /** Hit area radius. Independent of the art size. */
  radius: number;
  maxHp: number;
  maxSpeed: number;
  accel: number;
  /** Speed and acceleration multiplier while boosting (Shift). */
  boostMultiplier: number;
  /** Radians per second. */
  turnRate: number;
  fireCooldown: number;
  /** How far away AI-controlled ships start shooting. */
  range: number;
  bulletSpeed: number;
  bulletLife: number;
  bulletDamage: number;
  /** Where bullets come out, measured forward from the ship's centre. */
  gunOffset: number;
  /**
   * Sprite names from public/assets/manifest.json, used by both teams and
   * recoloured per team (see CONFIG.teamColors).
   * - Bigger tiers add ".t2", ".t3"... (e.g. "ship.fighter.t2"). A missing
   *   tier uses the closest smaller tier's art.
   * - Engine states add ".move" or ".boost"; wrecks add ".wreck".
   */
  sprites: { ship: string; bullet: string };
}

export const SHIP_TYPES = {
  fighter: {
    radius: 14,
    maxHp: 4,
    maxSpeed: 150,
    accel: 520,
    boostMultiplier: 1.8,
    turnRate: 9,
    fireCooldown: 0.25,
    range: 240,
    bulletSpeed: 380,
    bulletLife: 1.1,
    bulletDamage: 1,
    gunOffset: 14,
    sprites: { ship: "ship.fighter", bullet: "projectile" },
  },
} satisfies Record<string, ShipType>;

export type ShipTypeId = keyof typeof SHIP_TYPES;

export const CONFIG = {
  /**
   * Both teams use the same ship images. Paint "team colour" parts in a hue
   * inside hueMin–hueMax (degrees on the colour wheel: 0 red, 120 green,
   * 200 sky blue, 240 blue, 300 magenta). Each team turns those pixels by its
   * own number of degrees. Colours outside the range (hull, flames) never change,
   * and neither do greys with only a faint tint (saturation below minSaturation, 0–1).
   */
  teamColors: {
    hueMin: 180,
    hueMax: 230,
    minSaturation: 0.4,
    player: 0,
    enemy: 170,
  },

  /**
   * Tiers: 16 ships of one tier merge into 1 ship of the next tier up.
   * Fleet value counts what every ship is worth in tier-1 ships (T2 = 16, T3 = 256...).
   */
  tiers: {
    shipsPerMerge: 16,
    /** Merging only starts once your fleet value reaches this. */
    mergeStartsAt: 32,
    /** Each tier up multiplies health and damage per volley by this. */
    powerPerTier: 12,
    /** Shots per volley for tier 2 and up (tier 1 fires 1). Damage is split between them. */
    shotsPerVolley: 2,
    /** Each tier up multiplies hit size, gun position and shot hit size by this. */
    sizePerTier: 1.5,
    /** Each tier up multiplies shot speed by this... */
    shotSpeedPerTier: 1.2,
    /** ...and how far shots travel (and AI firing range) by this. */
    rangePerTier: 1.5,
    /** Each tier up multiplies the chance of leaving a wreck by this. */
    wreckChancePerTier: 0.4,
    /** Seconds for the merging ships to fly together before the big ship appears. */
    mergeDuration: 1,
  },
  /** Distance between rings in a formation. */
  formationSpacing: 40,
  /**
   * false = your ships fly over/under each other freely (as if at different
   * heights). true = they gently push apart when they overlap. Enemies always push apart.
   */
  playerShipsCollide: false,
  /** Seconds before the first ring of followers reacts to the leader... */
  followDelay: 0.12,
  /** ...plus this much more for each ring further out... */
  followDelayPerRing: 0.1,
  /** ...plus up to this much random extra per ship. */
  followDelayRandom: 0.08,
  /** How much leader history to keep (must cover the slowest follower). */
  followDelayMaxTotal: 1.5,
  /** How firmly followers pull toward their spot (higher = snappier, lower = floatier). */
  followStiffness: 2.2,
  /** How far (pixels) each ship drifts around its spot. */
  driftAmount: 5,
  /** Drift loop speed range, in loops per second (each ship picks its own). */
  driftSpeedMin: 0.15,
  driftSpeedMax: 0.4,
  /** How much (radians) idle ships sway their nose. */
  idleSway: 0.08,
  /** AI ships in your fleet shoot a bit slower than you do. */
  allyFireCooldownMultiplier: 1.4,
  /** Enemies are slower and shoot less often, so the player has a chance. */
  enemyFireCooldownMultiplier: 6,
  /** Your ships get extra health compared to the same ship type flown by enemies. */
  playerHpMultiplier: 1.5,
  enemySpeedMultiplier: 0.8,
  /**
   * Fleet ships (not the flagship) only aim and fire within this many degrees
   * either side of where their leader is facing, so the fleet fires where you aim.
   */
  allyFireArc: 15,
  /** The same for ships following an enemy fleet's leader. */
  enemyFireArc: 15,
  /** Random aim error in radians. */
  allyAimSpread: 0.08,
  enemyAimSpread: 0.2,
  /** Allies aim ahead of moving targets. Enemies aim straight at you, so moving sideways dodges. */
  allyLeadsTargets: true,
  enemyLeadsTargets: false,
  /** Lone enemies try to stay about this far from their target. */
  enemyPreferredDistance: 160,

  /** Chance a destroyed tier-1 enemy leaves a wreck you can recruit. */
  wreckChance: 0.75,
  wreckLifetime: 40,
  /** Wrecks blink during their last few seconds. */
  wreckBlinkTime: 5,
  /** Wrecks drift toward your ships when one is this close... */
  wreckMagnetRange: 70,
  /** ...with this much pull. */
  wreckMagnetAccel: 400,

  firstWaveDelay: 2,
  waveInterval: 12,
  /** Lone enemies per wave = 1 + wave number × this. */
  loneEnemiesPerWave: 0.25,
  maxLoneEnemiesPerWave: 12,
  maxEnemies: 120,
  /** How far outside the visible area enemies appear. */
  spawnMargin: 150,
  /** Enemy fleets start appearing once your fleet is at least this big... */
  enemyFleetMinPlayerSize: 6,
  /** ...on every Nth wave. */
  enemyFleetEveryNthWave: 3,
  /** Enemy fleet value compared to yours (1.1 = 10% bigger, plus 2). */
  enemyFleetSizeRatio: 1.1,

  /** Sound settings. Per-sound volumes are in public/assets/manifest.json. */
  audio: {
    /** Overall volume, 0–1. */
    masterVolume: 0.6,
    /** Your wingmen's shots, compared to the ship you fly (0 = silent). */
    allyShotVolume: 0.4,
    /** When a tier has no sound of its own, the smaller tier's sound plays this much lower per tier. */
    pitchPerTier: 0.85,
    /** Left/right panning strength for sounds at the screen edge (0 = none, 1 = full). */
    panAmount: 0.7,
    /** Sounds off-screen fade out, reaching silence this many screen-halves from the centre. */
    silentAt: 2,
  },

  /**
   * Camera zoom. Every step you've reached (biggest fleet value, or biggest
   * tier) counts, and the most zoomed-out one wins. Below 1 the art is shrunk,
   * so it gets a little softer.
   */
  zoomSteps: [
    { minFleet: 1, zoom: 3 },
    { minFleet: 8, zoom: 2 },
    { minTier: 2, zoom: 1 },
    { minTier: 3, zoom: 0.75 },
  ] as { minFleet?: number; minTier?: number; zoom: number }[],
};
