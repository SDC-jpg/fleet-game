// All the tuning numbers in one place. Change these to change how the game feels.
// Distances are in game pixels, times in seconds, speeds in pixels per second.
//
// The comments here also make the public tuning page (tools/make-tuning-page.mjs):
// - A `/** ... */` comment right above a setting is its description on the page.
// - A `// == Title: note ==` line starts a new section on the page.
// Keep each description to one clear line.

export interface ShipType {
  /** Hit size (radius). Separate from the art size. */
  radius: number;
  /** Health. */
  maxHp: number;
  /** Top speed. */
  maxSpeed: number;
  /** How quickly it speeds up and slows down. */
  accel: number;
  /** Speed and acceleration multiplier while boosting (Shift). */
  boostMultiplier: number;
  /** Turn speed in radians per second (6.28 = a full circle). */
  turnRate: number;
  /** Seconds between shots. */
  fireCooldown: number;
  /** How far away AI-controlled ships start shooting. */
  range: number;
  /** Shot speed. */
  bulletSpeed: number;
  /** Seconds a shot lasts (its reach is speed × life). */
  bulletLife: number;
  /** Damage per shot. */
  bulletDamage: number;
  /** Where shots appear, measured forward from the ship's centre. */
  gunOffset: number;
  /**
   * Art names from public/assets/manifest.json, used by both teams and
   * recoloured per team (see CONFIG.teamColors).
   * - Bigger tiers add ".t2", ".t3"... (e.g. "ship.fighter.t2"). A missing
   *   tier uses the closest smaller tier's art.
   * - Engine states add ".move" or ".boost"; wrecks add ".wreck".
   */
  sprites: { ship: string; bullet: string };
}

/** Ship stats at tier 1. Bigger tiers are worked out from these with CONFIG.tiers. */
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
   * Both teams use the same ship images. Team-colour parts are painted in a hue
   * inside hueMin–hueMax, and each team turns those pixels by its own number of
   * degrees (0 red, 120 green, 200 sky blue, 240 blue, 300 magenta).
   */
  teamColors: {
    /** Lowest hue (degrees) counted as team colour. */
    hueMin: 180,
    /** Highest hue (degrees) counted as team colour. */
    hueMax: 230,
    /** Greys with less saturation than this (0–1) are left alone, even if faintly blue. */
    minSaturation: 0.4,
    /** How far your team turns the hue (0 = keep sky blue). */
    player: 0,
    /** How far enemies turn the hue (170 turns sky blue into red). */
    enemy: 170,
  },

  /**
   * 16 ships of one tier merge into 1 ship of the next tier up. Fleet value counts
   * what every ship is worth in tier-1 ships (T2 = 16, T3 = 256...).
   */
  tiers: {
    /** Ships of one tier that merge into one ship of the next tier. */
    shipsPerMerge: 16,
    /** Merging only starts once your fleet value reaches this. */
    mergeStartsAt: 32,
    /** Each tier up multiplies health and damage per second by this. */
    powerPerTier: 12,
    /** Shots per volley for tier 2 and up (tier 1 fires 1). Damage is split between them. */
    shotsPerVolley: 2,
    /** Each tier up multiplies hit size, gun position and shot size by this. */
    sizePerTier: 1.5,
    /** Each tier up multiplies shot speed by this. */
    shotSpeedPerTier: 1.2,
    /** Each tier up multiplies shot reach and AI firing range by this. */
    rangePerTier: 1.5,
    /** Each tier up fires this many times slower, with harder shots so damage per second is unchanged. */
    fireIntervalPerTier: 1.25,
    /** Each tier up multiplies an enemy's chance of leaving a wreck by this. */
    wreckChancePerTier: 0.4,
    /** Longest time (seconds) the merging ships take to fly together. */
    mergeDuration: 1,
    /** Shots fired in a ring when a merge finishes, each as strong as the new ship's normal shot (0 = off). */
    mergeBurstShots: 16,
  },

  /**
   * The ship you fly is faster moving toward where it faces (the mouse) and
   * slower backing away. Sideways is normal speed, with a smooth blend between.
   */
  directionalSpeed: {
    /** Speed multiplier when moving straight toward the cursor. */
    forward: 1.2,
    /** Speed multiplier when backing straight away from the cursor. */
    backward: 0.82,
  },

  /** Right-click dash: the whole fleet gets a burst of speed that fades out. */
  dash: {
    /** Speed at the start of a dash, compared to normal speed (at the starting zoom). */
    speedMultiplier: 3,
    /** true = the dash gets stronger as the camera zooms out, so it covers the same share of the screen. */
    scaleWithZoom: true,
    /** Seconds for the dash to fade back to normal speed. */
    duration: 0.5,
    /** Seconds before you can dash again. */
    cooldown: 18,
  },

  // == Formation: how your wingmen follow ==
  /** Distance between rings in a formation. */
  formationSpacing: 40,
  /** false = your ships fly over/under each other freely; true = they push apart (enemies always do). */
  playerShipsCollide: false,
  /** Seconds before the first ring of followers reacts to the leader. */
  followDelay: 0.12,
  /** Extra reaction delay for each ring further out, so turns ripple outward. */
  followDelayPerRing: 0.1,
  /** Up to this much random extra delay per ship. */
  followDelayRandom: 0.08,
  /** Seconds of the leader's path to remember (must cover the slowest follower). */
  followDelayMaxTotal: 1.5,
  /** How firmly followers pull toward their spot (higher = snappier, lower = floatier). */
  followStiffness: 2.2,
  /** How far each ship drifts around its spot. */
  driftAmount: 5,
  /** Slowest drift loop, in loops per second (each ship picks its own speed). */
  driftSpeedMin: 0.15,
  /** Fastest drift loop, in loops per second. */
  driftSpeedMax: 0.4,
  /** How much (radians) ships sway their nose when not shooting. */
  idleSway: 0.08,

  // == Combat AI ==
  /** Your wingmen fire this many times slower than you do. */
  allyFireCooldownMultiplier: 1.4,
  /** Enemies fire this many times slower than you, so you have a chance. */
  enemyFireCooldownMultiplier: 6,
  /** Your ships get this much health compared to the same ship flown by enemies. */
  playerHpMultiplier: 1.5,
  /** Enemy speed compared to yours. */
  enemySpeedMultiplier: 0.8,
  /** Fleet ships only aim and fire within this many degrees either side of their leader's facing. */
  allyFireArc: 15,
  /** The same for ships following an enemy fleet's leader. */
  enemyFireArc: 15,
  /** Your wingmen's random aim error, in radians. */
  allyAimSpread: 0.08,
  /** Enemies' random aim error, in radians. */
  enemyAimSpread: 0.2,
  /** Your wingmen aim ahead of moving targets. */
  allyLeadsTargets: true,
  /** Enemies aim ahead too (false = straight at you, so moving sideways dodges). */
  enemyLeadsTargets: false,
  /** Lone enemies try to stay about this far from their target. */
  enemyPreferredDistance: 160,

  // == Wrecks ==
  /** Chance a destroyed tier-1 enemy leaves a wreck you can recruit. */
  wreckChance: 0.75,
  /** Seconds before a wreck disappears. */
  wreckLifetime: 40,
  /** Wrecks blink during their last this-many seconds. */
  wreckBlinkTime: 5,
  /** Wrecks drift toward your ships when one is this close. */
  wreckMagnetRange: 70,
  /** How strongly wrecks are pulled toward your ships. */
  wreckMagnetAccel: 400,

  // == Waves ==
  /** Seconds before the first wave. */
  firstWaveDelay: 2,
  /** Seconds between waves at the start. */
  waveInterval: 12,
  /** Each gap between waves is this times the last (0.995 = 0.5% shorter each time). */
  waveIntervalShrink: 0.995,
  /** Random change to each gap, either way (0.2 = up to 20% shorter or longer). */
  waveIntervalRandom: 0.2,
  /** Shortest possible gap between waves. */
  waveIntervalMin: 4,
  /** Lone enemies per wave = 1 + wave number × this. */
  loneEnemiesPerWave: 0.25,
  /** Most lone enemies in one wave. */
  maxLoneEnemiesPerWave: 12,
  /** Most enemies alive at once. */
  maxEnemies: 120,
  /** How far outside the visible area enemies appear. */
  spawnMargin: 150,
  /** Enemy fleets start appearing once your fleet value is at least this. */
  enemyFleetMinPlayerSize: 6,
  /** Once they've started, an enemy fleet comes every this-many waves. */
  enemyFleetEveryNthWave: 3,
  /** Enemy fleet value compared to yours (1.1 = 10% bigger, plus 2). */
  enemyFleetSizeRatio: 1.1,

  /** Sound settings. Each sound's own volume is in public/assets/manifest.json. */
  audio: {
    /** Overall volume, 0–1. */
    masterVolume: 0.6,
    /** Your wingmen's shots, compared to the ship you fly (0 = silent). */
    allyShotVolume: 0.4,
    /** A bigger tier with no sound of its own plays the smaller tier's sound at this pitch per tier. */
    pitchPerTier: 0.85,
    /** Left/right panning strength for sounds at the screen edge (0 = none, 1 = full). */
    panAmount: 0.7,
    /** Off-screen sounds fade to silence this many half-screens from the centre. */
    silentAt: 2,
  },

  /**
   * Camera zoom steps. Every step you've reached (biggest fleet value, or biggest
   * tier) counts, and the most zoomed-out one wins. Below 1× the art is shrunk,
   * so it looks a little softer.
   */
  zoomSteps: [
    { minFleet: 1, zoom: 3 },
    { minFleet: 8, zoom: 2 },
    { minTier: 2, zoom: 1 },
    { minTier: 3, zoom: 0.75 },
  ] as { minFleet?: number; minTier?: number; zoom: number }[],
};
