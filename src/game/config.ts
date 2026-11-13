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
    bulletLife: 2.0,
    bulletDamage: 1,
    gunOffset: 14,
    sprites: { ship: "ship.fighter", bullet: "projectile" },
  },
} satisfies Record<string, ShipType>;

export type ShipTypeId = keyof typeof SHIP_TYPES;

/**
 * Pilot skills, picked from cards at each level-up. Weapons (left click) fire
 * with your gun while you hold the button; defences (right click) go off when
 * you click. Each fires again once its cooldown is over. Numbers per skill are
 * in CONFIG (laser, missiles, mines, shield, repulse).
 */
export const SKILLS = {
  laser: {
    name: 'Laser',
    side: 'left',
    icon: 'ui.skill.laser',
    text: 'A beam that pierces every ship in a line.',
    /** What each upgradeable stat is called on rank-up cards. */
    stats: { power: 'damage', rate: 'fire rate', size: 'beam size' },
  },
  missiles: {
    name: 'Missiles',
    side: 'left',
    icon: 'ui.skill.missiles',
    text: 'A cluster of homing missiles.',
    stats: { power: 'damage', rate: 'fire rate', size: 'missiles' },
  },
  mines: {
    name: 'Mines',
    side: 'left',
    icon: 'ui.skill.mines',
    text: 'Drops a mine that blows up when an enemy comes near.',
    stats: { power: 'damage', rate: 'drop rate', size: 'blast size' },
  },
  shield: {
    name: 'Shield',
    side: 'right',
    icon: 'ui.skill.shield',
    text: 'A bubble that soaks up damage, on you and nearby ships.',
    stats: { power: 'strength', rate: 'recharge', size: 'reach' },
  },
  repulse: {
    name: 'Repulse',
    side: 'right',
    icon: 'ui.skill.repulse',
    text: 'A shockwave that pushes enemies and their shots away.',
    stats: { power: 'force', rate: 'recharge', size: 'reach' },
  },
  freeze: {
    name: 'Freeze',
    side: 'right',
    icon: 'ui.skill.freeze',
    text: 'Enemies in a cone in front of you stop moving and shooting for a moment.',
    stats: { power: 'duration', rate: 'recharge', size: 'cone size' },
  },
} satisfies Record<
  string,
  { name: string; side: 'left' | 'right'; icon: string; text: string; stats: Record<SkillStat, string> }
>;

export type SkillId = keyof typeof SKILLS;

/** What a rank-up card improves: power (damage, strength...), rate (shorter cooldown) or size. */
export type SkillStat = 'power' | 'rate' | 'size';

/** Rarity of rank-up cards (and later, equipment): name and colour. Odds and bonuses are in CONFIG.rarity. */
export const RARITIES = {
  common: { name: 'Common', color: '#e8ecf4' },
  uncommon: { name: 'Uncommon', color: '#6fe07a' },
  rare: { name: 'Rare', color: '#ffd34a' },
  epic: { name: 'Epic', color: '#c890ff' },
};

export type Rarity = keyof typeof RARITIES;

/**
 * Equipment: each item gives your whole fleet one bonus. Its size depends on
 * its rarity (see CONFIG.items for the common-rarity bonus of each).
 */
export const ITEM_STATS = {
  damage: { name: 'Targeting Computer', bonus: 'damage', icon: 'ui.item.damage' },
  fireRate: { name: 'Autoloader', bonus: 'fire rate', icon: 'ui.item.fire-rate' },
  health: { name: 'Hull Plating', bonus: 'max health', icon: 'ui.item.health' },
  speed: { name: 'Thrusters', bonus: 'speed', icon: 'ui.item.speed' },
  stamina: { name: 'Fuel Cells', bonus: 'boost time', icon: 'ui.item.stamina' },
  boostSpeed: { name: 'Afterburner', bonus: 'boost speed', icon: 'ui.item.boost-speed' },
  skillRate: { name: 'Capacitor', bonus: 'skill recharge', icon: 'ui.item.skill-rate' },
};

export type ItemStat = keyof typeof ITEM_STATS;

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
   * counts what every ship is worth in tier-1 ships (T2 = 16, T3 = 256...).
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
    /** Each tier up multiplies turn speed by this (0.75 = 25% slower), so big ships feel heavy. */
    turnRatePerTier: 0.75,
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

  /**
   * Experience and levels. Kills give XP (enemy value × xpPerValue). The XP
   * needed for the next level grows each level: firstLevelXp × growth^(level − 1).
   */
  levels: {
    /** XP per tier-1 ship's worth of enemy destroyed. */
    xpPerValue: 1,
    /** XP needed to go from level 1 to level 2. */
    firstLevelXp: 50,
    /** Each level needs this many times more XP than the last (1 = always the same). */
    growth: 1.15,
    /** Seconds between reaching a level and the cards appearing (so the kill that did it can play out). */
    cardDelay: 0.5,
  },

  /** Level-up cards. */
  cards: {
    /** Cards to choose from at each level-up. */
    choices: 3,
    /** Most weapon skills (left click) you can have at once. */
    maxWeapons: 3,
    /** Most defence skills (right click) you can have at once. */
    maxDefences: 2,
    /** How much more likely a new-skill card is than a bonus card. */
    newSkillWeight: 3,
    /** How much more likely a rank-up card (for a skill you have) is than a bonus card. */
    rankUpWeight: 3,
    /** Highest rank a skill can reach (rank 1 = just picked). */
    maxRank: 10,
    /** Bonus card: extra damage for the whole fleet (0.1 = +10%). */
    damageBonus: 0.1,
    /** Bonus card: faster firing for the whole fleet (0.1 = +10%). */
    fireRateBonus: 0.1,
  },

  /**
   * Rarity of rank-up cards: how often each comes up (weights) and how big its
   * bonus is (0.1 = +10%). Each card's bonus is rolled within ± spread of that.
   */
  rarity: {
    /** How often Common cards come up, compared to the others. */
    commonWeight: 60,
    /** How often Uncommon cards come up. */
    uncommonWeight: 25,
    /** How often Rare cards come up. */
    rareWeight: 11,
    /** How often Epic cards come up. */
    epicWeight: 4,
    /** Common bonus. */
    commonBonus: 0.1,
    /** Uncommon bonus. */
    uncommonBonus: 0.15,
    /** Rare bonus. */
    rareBonus: 0.22,
    /** Epic bonus. */
    epicBonus: 0.32,
    /** Random spread around each bonus (0.2 = up to 20% lower or higher). */
    spread: 0.2,
  },

  /**
   * Equipment items: rare drops from destroyed enemies. Each gives the whole
   * fleet one bonus; rarer items give more (scaled like CONFIG.rarity's card
   * bonuses: Epic is about 3× Common). Slots = slotsPerTier × your highest tier this run.
   */
  items: {
    /** Chance a destroyed tier-1 enemy drops an item. */
    dropChance: 0.03,
    /** Bigger enemies drop more often: chance × (their value ^ this). 0.5 = a value-16 enemy is 4× as likely. */
    dropChanceGrowth: 0.5,
    /** Seconds before an item nobody picked up disappears. */
    lifetime: 120,
    /** Equipment slots per tier of your biggest ship so far. */
    slotsPerTier: 3,
    /** Common Targeting Computer: extra damage (0.05 = +5%). */
    damageBonus: 0.05,
    /** Common Autoloader: faster firing. */
    fireRateBonus: 0.05,
    /** Common Hull Plating: more max health. */
    healthBonus: 0.08,
    /** Common Thrusters: faster flying. */
    speedBonus: 0.04,
    /** Common Fuel Cells: longer boost. */
    staminaBonus: 0.1,
    /** Common Afterburner: faster boost. */
    boostSpeedBonus: 0.05,
    /** Common Capacitor: skills recharge faster. */
    skillRateBonus: 0.05,
  },

  /** Laser skill: an instant beam that hits every enemy along it. Damage and size grow with your ship's tier. */
  laser: {
    /** Seconds between beams. */
    cooldown: 3,
    /** Damage to each ship it hits (tier 1). */
    damage: 6,
    /** Beam length (tier 1; grows like shot reach). */
    length: 420,
    /** Beam width (tier 1; grows with ship size). */
    width: 6,
  },

  /** Missiles skill: a cluster of slow homing missiles. */
  missiles: {
    /** Seconds between clusters. */
    cooldown: 3.5,
    /** Missiles per cluster. */
    count: 4,
    /** Damage per missile (tier 1). */
    damage: 2,
    /** Missile speed at launch: they start slow, then speed up. */
    startSpeed: 40,
    /** Missile top speed, reached rampTime seconds after launch. */
    speed: 500,
    /** Seconds for a missile to go from startSpeed to speed. */
    rampTime: 0.5,
    /** How fast missiles turn toward their target (radians per second). */
    turnRate: 4,
    /** Seconds a missile lasts. */
    life: 3,
  },

  /** Mines skill: drops a mine behind you that blows up when an enemy comes near. */
  mines: {
    /** Seconds between mines. */
    cooldown: 2.5,
    /** Seconds before a new mine can go off. */
    armTime: 0.4,
    /** An enemy this close sets it off (tier 1). */
    triggerRadius: 40,
    /** Everything this close takes damage when it blows (tier 1). */
    blastRadius: 55,
    /** Blast damage (tier 1). */
    damage: 8,
    /** Seconds before an untouched mine fizzles out. */
    life: 6,
  },

  /** Shield skill: a bubble on you and nearby ships of your fleet that soaks up damage. */
  shield: {
    /** Seconds between shields. */
    cooldown: 4,
    /** Damage each shield absorbs (tier 1, times your health bonus for being the player). */
    amount: 4,
    /** Seconds a shield lasts. */
    duration: 2.5,
    /** Ships of your fleet this close (tier 1) get a shield too. */
    radius: 80,
  },

  /** Repulse skill: a shockwave that pushes enemies away, hurts them a little and wipes out their shots. */
  repulse: {
    /** Seconds between shockwaves. */
    cooldown: 3,
    /** Reach (tier 1; grows with ship size). */
    radius: 150,
    /** How hard enemies are pushed (speed added, pixels per second). */
    push: 420,
    /** Damage to each enemy caught (tier 1). */
    damage: 2,
  },

  /** Freeze skill: enemies in a cone in front of you stop moving and shooting for a while. */
  freeze: {
    /** Seconds between freezes. */
    cooldown: 4,
    /** Seconds enemies stay frozen. */
    duration: 2,
    /** Cone length (tier 1; grows with ship size). */
    length: 220,
    /** Cone half-width in degrees (each side of where you face). */
    angle: 30,
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
  /** First wave that brings an enemy fleet. */
  enemyFleetsFromWave: 6,
  /** After that, an enemy fleet comes every this-many waves. */
  enemyFleetEveryNthWave: 3,
  /** Enemy fleet value = start + perWave × wave^curve. This is the value at wave 0. */
  enemyFleetValueStart: 3,
  /** How much enemy fleet value is added per wave (see enemyFleetValueCurve). */
  enemyFleetValuePerWave: 0.6,
  /** 1 = enemy fleets grow steadily; higher = they grow faster and faster in later waves. */
  enemyFleetValueCurve: 1.3,

  /**
   * Elite enemies: one strong ship every few waves that uses skills and always
   * drops a wreck, an item, or both (items of better rarity). Set `enabled` to
   * false to turn elites off completely.
   */
  elite: {
    /** true = elites appear; false = no elites at all. (Test key O switches them for your browser only.) */
    enabled: true,
    /** An elite comes every this-many waves (5 = waves 10, 15, 20... from firstWave). If that wave brings an enemy fleet, the elite waits one wave. */
    everyNthWave: 5,
    /** No elite before this wave (10 = the wave-5 one is skipped). */
    firstWave: 10,
    /** Elite tier = biggest tier in an enemy fleet of that wave, plus this. */
    extraTiers: 1,
    /** Elite health compared to a normal enemy of its tier. */
    healthMultiplier: 4,
    /** XP for destroying an elite, compared to a normal enemy of its tier. */
    xpMultiplier: 3,
    /** Skills the first elite has; each later elite has one more, up to maxSkills. */
    firstSkills: 1,
    /** Most skills an elite can have. */
    maxSkills: 3,
    /** From this elite on (4 = the 4th), each new elite's skills are one rank higher (up to rank 5). */
    rankUpFrom: 4,
    /** Each rank above 1 improves one random stat of the skill by this (0.15 = +15%). */
    rankBonus: 0.15,
    /** An elite's skill damage compared to yours (0.25 = a quarter; full strength would destroy a ship of its tier in one hit). */
    skillDamage: 0.25,
    /** An elite's skill cooldowns compared to yours (1.5 = 50% longer). */
    cooldownMultiplier: 1.5,
    /** Seconds an elite's laser shows a warning line before it fires. */
    laserWarning: 0.6,
    /** Drop odds: weight for "a wreck only". */
    dropWreckWeight: 40,
    /** Drop odds: weight for "an item only". */
    dropItemWeight: 40,
    /** Drop odds: weight for "a wreck and an item". */
    dropBothWeight: 20,
    /** An elite's wreck is never more than this many tiers above your biggest ship this run (0 = never bigger). */
    wreckMaxTiersAbove: 1,
    /** Item rarity odds for elite drops (normal drops use the rarity weights above): Common. */
    commonWeight: 20,
    /** Elite item odds: Uncommon. */
    uncommonWeight: 35,
    /** Elite item odds: Rare. */
    rareWeight: 30,
    /** Elite item odds: Epic. */
    epicWeight: 15,
  },

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
