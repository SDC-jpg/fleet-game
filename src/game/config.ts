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
  /** Speed and acceleration multiplier while boosting (Shift, limited by CONFIG.boost). */
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
    boostMultiplier: 2.2,
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

/**
 * Ship classes. Every tier-1 ship is one class and carries one "module" of it.
 * A merged ship carries all the modules of the ships that went into it, and
 * those decide its abilities (see CONFIG.modules).
 */
export const CLASSES = {
  lancer: {
    name: 'Lancer',
    /** Colour for this class in the HUD. */
    color: '#ffd34a',
    ability: 'Lance',
    /** Tier-1 art (bigger tiers all use SHIP_TYPES.fighter's art). */
    sprite: 'ship.lancer',
    /** Rank icon shown above ships. A ".small" version is used for a ship's second class. */
    icon: 'ui.class.lancer',
  },
  knight: { name: 'Knight', color: '#7fe0b0', ability: 'Aegis', sprite: 'ship.knight', icon: 'ui.class.knight' },
  ballista: { name: 'Ballista', color: '#c890ff', ability: 'Missile volley', sprite: 'ship.ballista', icon: 'ui.class.ballista' },
};

export type ClassId = keyof typeof CLASSES;
export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

/** Combos: a ship with both classes (each at least CONFIG.modules.minShare) gets a bonus. */
export const COMBOS = {
  mirror: { name: 'Mirror Guard', classes: ['lancer', 'knight'], text: 'Aegis shields reflect the shots they block' },
  splinter: { name: 'Splinter Volley', classes: ['lancer', 'ballista'], text: 'Missiles burst into small lances on impact' },
  retaliation: { name: 'Retaliation', classes: ['knight', 'ballista'], text: 'Hits on Aegis shields fire a missile back' },
} satisfies Record<string, { name: string; classes: [ClassId, ClassId]; text: string }>;

export type ComboId = keyof typeof COMBOS;

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
   * shipsPerMerge ships of one tier merge into 1 ship of the next tier up. Fleet value
   * counts what every ship is worth in tier-1 ships (with 4 per merge: T2 = 4, T3 = 16...).
   */
  tiers: {
    /** Ships of one tier that merge into one ship of the next tier. */
    shipsPerMerge: 8,
    /** Merging only starts once your fleet value reaches this. */
    mergeStartsAt: 16,
    /** Each tier up multiplies health, damage per second and ability strength by this. */
    powerPerTier: 7,
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
    /** Each tier up multiplies turn speed by this (0.75 = 25% slower), so big ships feel heavy. */
    turnRatePerTier: 0.75,
    /** Each tier up multiplies an enemy's chance of leaving a wreck by this. */
    wreckChancePerTier: 0.6,
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

  /**
   * Modules: what a ship's classes add up to. A class needs at least minShare of
   * a ship's modules to give it that class's ability. Ability strength =
   * powerPerTier^(tier − 1) × share^purityBonus, so pure ships beat mixed ones.
   */
  modules: {
    /** A class below this share of a ship's modules gives no ability (0.25 = 2 of 8). */
    minShare: 0.25,
    /** Above 1, pure ships are stronger than mixed ones (a half share gives less than half strength). */
    purityBonus: 1.2,
    /** Classes too small for an ability strengthen the basic gun instead: +this × their share. */
    smallShareGunBonus: 0.5,
    /** Your wingmen use abilities this many times slower than the ship you fly. */
    allyCooldownMultiplier: 1.2,
    /** Enemies use abilities this many times slower, so you have a chance. */
    enemyCooldownMultiplier: 3,
  },

  /**
   * Rare modules: stronger versions of a class's ability. Each bonus is the
   * value for a class whose modules are all rare; a half-rare class gets half the extra.
   */
  rare: {
    /** Lance reach multiplier. */
    lanceReach: 1.75,
    /** Aegis shield duration multiplier. */
    shieldDuration: 2,
    /** Missiles per volley multiplier (each missile keeps its damage, so volleys hit harder). */
    missileCount: 2,
    /** Chance that an ordinary enemy's tier-1 wreck holds a rare module. */
    wreckChance: 0.04,
  },

  /** Elite enemies: rare, tougher, glowing, and always drop rare modules. */
  elites: {
    /** First wave that can have elites. */
    fromWave: 5,
    /** Chance for each lone enemy, and each enemy fleet's leader, to be elite. */
    chance: 0.08,
    /** Elite health compared to a normal enemy of the same tier. */
    hpMultiplier: 4,
    /** Elite gun damage compared to a normal enemy of the same tier. */
    damageMultiplier: 1.5,
  },

  /** Scrap: currency for the body shop (coming soon). */
  scrap: {
    /** Scrap per destroyed enemy, times its value (tier-1 ships it's worth). */
    perKillValue: 1,
    /** Extra scrap for destroying an elite. */
    eliteBonus: 10,
  },

  /** Big enemies (tier 2+) drop some of their modules as tier-1 wrecks when destroyed. */
  moduleDrops: {
    /** Share of their modules they drop. */
    share: 0.25,
    /** Most tier-1 wrecks one enemy drops. */
    max: 8,
    /** Their chance of also leaving a whole big wreck, compared to before module drops. */
    bigWreckChanceMultiplier: 0.5,
  },

  /** Lancer ability: a fast, heavy shot that passes through every ship in its path. */
  lance: {
    /** Seconds between lances. */
    cooldown: 3,
    /** Damage to each ship it passes through (at strength 1). */
    damage: 4,
    /** Speed (grows with tier like normal shots). */
    speed: 900,
    /** Seconds it lasts (reach = speed × life, grows with tier). */
    life: 0.5,
    /** Hit size (radius), grows with ship size. */
    radius: 3,
  },

  /** Knight ability (Aegis): a shield on the ship and nearby allies that soaks up damage. */
  shield: {
    /** Seconds between shields. */
    cooldown: 10,
    /** Damage each shield absorbs (at strength 1). */
    amount: 4,
    /** Seconds a shield lasts. */
    duration: 5,
    /** Allies this close (grows with ship size and the Knight share) get a shield too. */
    radius: 90,
  },

  /** Ballista ability: a volley of slow homing missiles. */
  missiles: {
    /** Seconds between volleys. */
    cooldown: 6,
    /** Total damage of a volley (at strength 1), split between its missiles. */
    damage: 6,
    /** Missiles per volley at strength 1 (grows with the cube root of strength). */
    count: 3,
    /** Most missiles in one volley. */
    maxCount: 12,
    /** Missile speed. */
    speed: 260,
    /** How fast missiles turn toward their target (radians per second). */
    turnRate: 4,
    /** Seconds a missile lasts. */
    life: 3,
  },

  /** Combo bonus numbers (see COMBOS at the top of this file). */
  combos: {
    /** Splinter Volley: small lances each missile bursts into. */
    splinterCount: 3,
    /** Splinter Volley: each small lance's damage, compared to the missile's. */
    splinterDamage: 0.5,
    /** Retaliation: shortest time between two missiles fired back by the same shield. */
    retaliationGap: 0.4,
  },

  /** Shift boost runs on stamina, shown by the ring around the ship you fly. */
  boost: {
    /** Seconds of boost from a full bar, for a tier-1 ship you fly. */
    duration: 3,
    /** Each tier up multiplies boost time by this (an empty bar still refills in rechargeTime). */
    durationPerTier: 1.5,
    /** Seconds to refill an empty bar. */
    rechargeTime: 6,
    /** Seconds after you stop boosting before the bar starts refilling. */
    rechargeDelay: 0.75,
    /** After running dry, boost unlocks once the bar refills to this share (0–1). */
    restartAt: 0.3,
  },

  /** Space dash: the whole fleet gets a burst of speed that fades out. */
  dash: {
    /** Speed at the start of a dash, compared to normal speed (at the starting zoom). */
    speedMultiplier: 8,
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
  /** true = the first enemy you destroy in a run always leaves a wreck. */
  firstKillWreck: true,
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
    { minTier: 2, zoom: 2 },
    { minTier: 3, zoom: 1 },
  ] as { minFleet?: number; minTier?: number; zoom: number }[],
};
