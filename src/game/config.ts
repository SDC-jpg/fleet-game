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
   * Sprite names from public/assets/manifest.json. Optional engine-state
   * versions are found by adding ".move" or ".boost" to the name.
   */
  sprites: { player: string; enemy: string; wreck: string };
  bulletSprites: { player: string; enemy: string };
}

export const SHIP_TYPES = {
  fighter: {
    radius: 11,
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
    sprites: { player: 'ship.fighter.player', enemy: 'ship.fighter.enemy', wreck: 'ship.fighter.wreck' },
    bulletSprites: { player: 'projectile.player', enemy: 'projectile.enemy' },
  },
} satisfies Record<string, ShipType>;

export type ShipTypeId = keyof typeof SHIP_TYPES;

export const CONFIG = {
  /** Distance between rings in a formation. */
  formationSpacing: 40,
  /** AI ships in your fleet shoot a bit slower than you do. */
  allyFireCooldownMultiplier: 1.4,
  /** Enemies are slower and shoot less often, so the player has a chance. */
  enemyFireCooldownMultiplier: 6,
  /** Your ships get extra health compared to the same ship type flown by enemies. */
  playerHpMultiplier: 1.5,
  enemySpeedMultiplier: 0.8,
  /** Random aim error in radians. */
  allyAimSpread: 0.08,
  enemyAimSpread: 0.2,
  /** Allies aim ahead of moving targets. Enemies aim straight at you, so moving sideways dodges. */
  allyLeadsTargets: true,
  enemyLeadsTargets: false,
  /** Lone enemies try to stay about this far from their target. */
  enemyPreferredDistance: 160,

  /** Chance a destroyed enemy leaves a wreck you can recruit. */
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
  /** Enemy fleet size compared to yours (1.1 = 10% bigger, plus 2). */
  enemyFleetSizeRatio: 1.1,

  /** Camera zoom steps: the biggest `minFleet` you've reached picks the zoom. */
  zoomSteps: [
    { minFleet: 1, zoom: 3 },
    { minFleet: 8, zoom: 2 },
    { minFleet: 20, zoom: 1 },
  ],
};
