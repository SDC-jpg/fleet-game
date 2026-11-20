// ShipArt → Sounds (docs/SOUND-TOOL.md): what each sound in the manifest's "sounds" section is
// for, in plain words, and a short scene the preview plays with it (the game's own art).
//
// A sound missing here still shows in ShipArt, as "not described yet", so new sounds are never
// hidden. When you add a sound to the game, add a line here too.

export type SoundGroup = 'Weapons and guns' | 'Skills' | 'Explosions' | 'Ship' | 'Alerts and menus' | 'Leviathan';
export const SOUND_GROUPS: SoundGroup[] = ['Weapons and guns', 'Skills', 'Explosions', 'Ship', 'Alerts and menus', 'Leviathan'];

/**
 * One thing a scene shows. Times are seconds from the start of the scene; positions are game
 * pixels from the middle of the preview (x to the right, y down); angles in radians (0 = right).
 * Sprite names may hold "{t}" for the tier being played (".t2", or nothing for tier 1);
 * effects and shots also pick their own tier versions.
 */
export type SceneItem =
  /** A ship in its own colours, in a state (idle, move, boost), optionally moving and only shown for a while. */
  | { ship: string; x: number; y: number; angle?: number; state?: string; vx?: number; vy?: number; from?: number; until?: number; alpha?: number }
  /** An effect or image at a point from `at`: play-once flipbooks run once, others show until `until`. */
  | { fx: string; x: number; y: number; at: number; angle?: number; scale?: number; until?: number; vx?: number; vy?: number }
  /** A shot flying from (x, y) along `angle`, from `at` to `until` (in enemy colours with `enemy`). */
  | { shot: string; x: number; y: number; angle: number; speed: number; at: number; until: number; enemy?: boolean }
  /** A beam (a repeated segment image) from (x, y) along `angle`, from `at` to `until`. */
  | { beam: string; x: number; y: number; angle: number; length: number; at: number; until: number; width?: number };

export interface SoundScene {
  items: SceneItem[];
  /** When the sound starts. */
  cue: number;
  /** How long the scene runs. */
  length: number;
  /** Looping sounds: when the loop fades out (it starts at `cue`). */
  loopUntil?: number;
}

export interface SoundInfo {
  group: SoundGroup;
  /** Where it's used, in plain words. */
  use: string;
  /** Played deeper (or brighter) for bigger ships: shows Tier 1–4 buttons. Default true. */
  tiered?: boolean;
  /** A looping sound (the game fades it in and out). */
  loop?: boolean;
  /** The scene for a tier (1 = the smallest ships). */
  scene?: (tier: number) => SoundScene;
  /** Menu and message sounds: words shown over the preview instead of a scene. */
  label?: string;
}

// ---------- Scene helpers ----------

/** How far apart things sit at this tier (ships grow 1.5× per tier). */
const gap = (t: number) => 70 * 1.5 ** (t - 1);
const you = (t: number, extra: Partial<Extract<SceneItem, { ship: string }>> = {}): SceneItem => ({ ship: 'ship.fighter{t}', x: -gap(t), y: 0, ...extra });
const foe = (t: number, extra: Partial<Extract<SceneItem, { ship: string }>> = {}): SceneItem => ({ ship: 'ship.enemy{t}', x: gap(t), y: 0, angle: Math.PI, ...extra });

/** Your ship fires `shot` at an enemy; `hit` (an effect) where it lands. Sound on firing, or on the hit. */
function fire(t: number, shot: string, opts: { speed?: number; hit?: string; cueOnHit?: boolean; foe?: boolean } = {}): SoundScene {
  const speed = (opts.speed ?? 420) * 1.2 ** (t - 1);
  const fly = (2 * gap(t) - 16) / speed;
  const at = 0.3;
  const items: SceneItem[] = [you(t), { shot, x: -gap(t) + 12, y: 0, angle: 0, speed, at, until: at + fly }];
  if (opts.foe !== false) items.push(foe(t));
  if (opts.hit) items.push({ fx: opts.hit, x: gap(t) - 10, y: 0, at: at + fly });
  return { items, cue: opts.cueOnHit ? at + fly : at, length: at + fly + 1 };
}

/** An enemy ship that's replaced by `fx` at the cue (explosions). */
function blowUp(ship: string, fx: string): SoundScene {
  const cue = 0.5;
  return { items: [{ ship, x: 0, y: 0, until: cue }, { fx, x: 0, y: 0, at: cue }], cue, length: cue + 2 };
}

/** Your ship uses a skill: `fx` at `dx` ahead of it (0 = on it). */
function skill(t: number, fx: string, dx = 0, extra: SceneItem[] = [], opts: { until?: number; scale?: number } = {}): SoundScene {
  const cue = 0.4;
  return {
    items: [you(t, { x: -gap(t) / 2 }), ...extra, { fx, x: -gap(t) / 2 + dx * 1.5 ** (t - 1), y: 0, at: cue, until: opts.until, scale: opts.scale }],
    cue,
    length: (opts.until ?? cue + 1.4) + 0.6,
  };
}

/** Your ship uses a beam skill toward an enemy. */
function beamAt(t: number, beam: string, time = 0.5, extra: SceneItem[] = []): SoundScene {
  const cue = 0.4;
  return {
    items: [you(t), foe(t), { beam, x: -gap(t) + 12, y: 0, angle: 0, length: 2 * gap(t) - 12, at: cue, until: cue + time }, ...extra],
    cue,
    length: cue + time + 0.8,
  };
}

/** A Leviathan image (its art faces up, so it's turned to face right). */
const lev = (fx: string, at: number, extra: Partial<Extract<SceneItem, { fx: string }>> = {}): SceneItem => ({ fx, x: 0, y: 0, at, angle: Math.PI / 2, ...extra });

// ---------- The sounds ----------

export const SOUND_INFO: Record<string, SoundInfo> = {
  // Weapons and guns
  'sfx.shoot': { group: 'Weapons and guns', use: "When your ships fire their standard guns. Wingmen play it quieter than the ship you fly (CONFIG.audio.allyShotVolume).", scene: (t) => fire(t, 'projectile', { hit: 'vfx.hit' }) },
  'sfx.shoot.enemy': {
    group: 'Weapons and guns',
    use: 'When enemy ships fire their standard guns.',
    scene: (t) => ({ items: [you(t), foe(t), { shot: 'projectile', x: gap(t) - 12, y: 0, angle: Math.PI, speed: 420, at: 0.3, until: 0.3 + (2 * gap(t) - 16) / 420, enemy: true }], cue: 0.3, length: 1.6 }),
  },
  'sfx.hit': { group: 'Weapons and guns', use: 'When a shot hits a ship without destroying it (also mines and some skills).', scene: (t) => fire(t, 'projectile', { hit: 'vfx.hit', cueOnHit: true }) },
  'sfx.laser': { group: 'Weapons and guns', use: 'When the Laser skill fires, and when an energy gun (purple enemies, energy turrets) starts its beam.', scene: (t) => beamAt(t, 'vfx.laser', 0.4) },
  'sfx.laser-sear': {
    group: 'Weapons and guns',
    use: 'Loops while energy-gun beams are burning something on screen; louder with more beams at once (CONFIG.audio.searLevelPerBeam).',
    loop: true,
    scene: (t) => ({ ...beamAt(t, 'vfx.laser', 1.6, [{ fx: 'vfx.laser-impact', x: gap(t) - 10, y: 0, at: 0.4, until: 2 }]), loopUntil: 2 }),
  },
  'sfx.missile': { group: 'Weapons and guns', use: 'When missiles launch: the Missiles skill, and explosive guns (orange enemies, missile turrets).', scene: (t) => fire(t, 'projectile.missile', { speed: 260 }) },
  'sfx.missile-ignite': { group: 'Weapons and guns', use: "When a launched missile's engine fires up (a moment after launch).", scene: (t) => fire(t, 'projectile.missile', { speed: 300 }) },
  'sfx.missile-hit': { group: 'Weapons and guns', use: 'When a missile hits (a small blast, not a ship explosion). Also when the PDC shoots a missile down.', scene: (t) => fire(t, 'projectile.missile', { speed: 300, hit: 'vfx.missile-hit', cueOnHit: true }) },
  'sfx.mine': { group: 'Weapons and guns', use: 'When the Mines skill drops its mines behind your ship.', scene: (t) => skill(t, 'projectile.mine', -24, [], { until: 1.8 }) },
  'sfx.mine-blast': { group: 'Weapons and guns', use: 'When a mine blows up (an enemy came near).', scene: () => ({ items: [{ fx: 'projectile.mine', x: 0, y: 0, at: 0, until: 0.5 }, { fx: 'vfx.mine-blast', x: 0, y: 0, at: 0.5 }], cue: 0.5, length: 2 }) },
  'sfx.pdc': {
    group: 'Weapons and guns',
    use: 'When the Point Defense Cannons fire at an enemy missile.',
    tiered: false,
    scene: (t) => ({ items: [you(t), { shot: 'projectile.pdc', x: -gap(t) + 8, y: 0, angle: -0.2, speed: 500, at: 0.3, until: 0.7 }, { shot: 'projectile.missile', x: gap(t) * 1.5, y: -70, angle: Math.PI, speed: 200, at: 0, until: 0.75 }, { fx: 'vfx.missile-hit', x: gap(t) * 1.5 - 150, y: -70, at: 0.75 }], cue: 0.3, length: 1.8 }),
  },

  // Skills
  'sfx.gatling': { group: 'Skills', use: 'Each bolt of the Gatling Laser skill.', scene: (t) => fire(t, 'projectile.gatling', { speed: 600 }) },
  'sfx.crescent': { group: 'Skills', use: 'When Crescent Strike fires its curving blade.', scene: (t) => skill(t, 'vfx.crescent', 40) },
  'sfx.arc': { group: 'Skills', use: 'When Arc Impulse fires its lightning at an enemy in front.', scene: (t) => beamAt(t, 'vfx.arc', 0.4, [{ fx: 'vfx.arc-hit', x: gap(t) - 10, y: 0, at: 0.4 }]) },
  'sfx.ion-cloud': { group: 'Skills', use: 'When Ion Cloud releases its cloud.', scene: (t) => skill(t, 'vfx.ion-ball', 50, [], { until: 2 }) },
  'sfx.ion-pop': { group: 'Skills', use: 'When an Ion Cloud zaps an enemy inside it.', scene: (t) => ({ items: [foe(t, { x: 0 }), { fx: 'vfx.ion-pop', x: 0, y: 0, at: 0.4 }], cue: 0.4, length: 1.6 }) },
  'sfx.plasma-lance': { group: 'Skills', use: 'When Plasma Lance thrusts its lance.', scene: (t) => beamAt(t, 'vfx.plasma-lance', 0.5, [{ fx: 'vfx.plasma-hit', x: gap(t) - 10, y: 0, at: 0.4 }]) },
  'sfx.split-beam': { group: 'Skills', use: 'When Splitting Beam fires, and each time it splits.', scene: (t) => fire(t, 'vfx.split-beam', { speed: 500, hit: 'vfx.split-burst' }) },
  'sfx.pods': { group: 'Skills', use: 'When Laser Pods launches its pods.', scene: (t) => skill(t, 'vfx.pod', 0, [{ fx: 'vfx.pod', x: -gap(t) / 2, y: -30, at: 0.4, until: 1.8 }], { until: 1.8 }) },
  'sfx.pod-shot': { group: 'Skills', use: 'Each shot from a Laser Pod.', scene: (t) => ({ items: [{ fx: 'vfx.pod', x: -40, y: 0, at: 0, until: 1.4 }, foe(t, { x: 60 }), { shot: 'projectile.pod-shot', x: -34, y: 0, angle: 0, speed: 500, at: 0.4, until: 0.6 }], cue: 0.4, length: 1.4 }) },
  'sfx.gravity-well': { group: 'Skills', use: 'When Gravity Well opens its well at the cursor.', scene: (t) => skill(t, 'vfx.gravity-well', 90, [], { until: 2.2 }) },
  'sfx.scramble': { group: 'Skills', use: "When Scramble sends out its wave (enemies' controls go wrong).", scene: (t) => skill(t, 'vfx.scramble-wave', 0, [foe(t), { fx: 'vfx.scrambled', x: gap(t), y: 0, at: 0.8, until: 2 }]) },
  'sfx.wrecksplosion': { group: 'Skills', use: 'When Wrecksplosion blows up a wreck (switched off in the game for now).', scene: () => ({ items: [{ ship: 'ship.fighter{t}.wreck', x: 0, y: 0, until: 0.5 }, { fx: 'vfx.wreck-blast', x: 0, y: 0, at: 0.5 }], cue: 0.5, length: 2 }) },
  'sfx.tractor-beam': { group: 'Skills', use: 'When Tractor Beam grabs a wreck (switched off in the game for now).', scene: (t) => beamAt(t, 'vfx.tractor-beam', 1) },
  'sfx.force-wall': { group: 'Skills', use: 'When you draw a Force Wall (right click held).', tiered: false, scene: (t) => skill(t, 'vfx.force-wall', 60, [], { until: 2 }) },
  'sfx.force-wall-hit': { group: 'Skills', use: 'When a shot or missile is stopped by a Force Wall.', tiered: false, scene: () => ({ items: [{ fx: 'vfx.force-wall', x: 0, y: 0, at: 0, until: 1.6, angle: Math.PI / 2 }, { fx: 'vfx.force-wall-hit', x: 0, y: 0, at: 0.5 }], cue: 0.5, length: 1.6 }) },
  'sfx.cloak': { group: 'Skills', use: 'When Cloaking hides your fleet.', scene: (t) => skill(t, 'vfx.cloak') },
  'sfx.hijack': { group: 'Skills', use: 'When Hijack takes over enemy ships.', scene: (t) => skill(t, 'vfx.hijack-pulse', 0, [foe(t, { x: gap(t) / 2 })]) },
  'sfx.shield': { group: 'Skills', use: 'When the Shield skill puts its bubble on your ships.', scene: (t) => skill(t, 'vfx.shield', 0, [], { until: 2 }) },
  'sfx.repulse': { group: 'Skills', use: 'When Repulse sends out its shockwave.', scene: (t) => skill(t, 'vfx.repulse') },
  'sfx.freeze': { group: 'Skills', use: 'When Freeze fires its cone and stops enemies in front.', scene: (t) => skill(t, 'vfx.freeze', 40, [foe(t), { fx: 'vfx.frozen', x: gap(t), y: 0, at: 0.7, until: 2 }]) },
  'sfx.time-dilation': { group: 'Skills', use: 'When Time Dilation slows everything but your fleet.', tiered: false, scene: (t) => skill(t, 'vfx.time-dilation') },
  'sfx.cannibalize': { group: 'Skills', use: 'When Cannibalize turns one of your ships into repairs (uses the recruit sound file).', scene: (t) => skill(t, 'vfx.cannibalize') },
  'sfx.warp': {
    group: 'Skills',
    use: 'When Crisis Jump warps your fleet away (uses the dash sound file).',
    scene: (t) => ({ items: [you(t, { until: 0.4 }), { fx: 'vfx.warp-out', x: -gap(t), y: 0, at: 0.4 }, { fx: 'vfx.warp-in', x: gap(t), y: 0, at: 0.4 }, you(t, { x: gap(t), from: 0.7 })], cue: 0.4, length: 2 }),
  },

  // Explosions
  'sfx.explosion': { group: 'Explosions', use: 'When a ship is destroyed. Each tier has its own file (Tier 1–4); bigger tiers play the T4 one deeper.', scene: () => blowUp('ship.enemy{t}', 'vfx.explosion') },
  'sfx.flagship-explosion': { group: 'Explosions', use: 'When the ship you fly is destroyed (with a screen shake and debris). Each tier has its own file.', scene: () => blowUp('ship.fighter{t}', 'vfx.flagship-explosion') },

  // Ship
  'sfx.engine-move': {
    group: 'Ship',
    use: 'Loops while the ship you fly is moving; deeper for bigger ships. Silent while paused.',
    loop: true,
    scene: (t) => ({ items: [you(t, { x: -2 * gap(t), state: 'move', vx: 120 })], cue: 0.2, length: 2.6, loopUntil: 2.4 }),
  },
  'sfx.engine-boost': {
    group: 'Ship',
    use: 'Loops instead of the hum while the ship you fly boosts (Shift).',
    loop: true,
    scene: (t) => ({ items: [you(t, { x: -2 * gap(t), state: 'boost', vx: 260 })], cue: 0.2, length: 2.2, loopUntil: 2 }),
  },
  'sfx.boost': { group: 'Ship', use: 'Once, when you start boosting (Shift).', scene: (t) => ({ items: [you(t, { x: -2 * gap(t), state: 'move', vx: 100, until: 0.5 }), you(t, { x: -2 * gap(t) + 50, state: 'boost', vx: 260, from: 0.5 })], cue: 0.5, length: 2 }) },
  'sfx.dash': { group: 'Ship', use: 'When your fleet dashes (Space).', scene: (t) => ({ items: [you(t, { x: gap(t), from: 0.4 }), { fx: 'vfx.dash', x: gap(t), y: 0, at: 0.4 }, you(t, { until: 0.4, x: -gap(t) })], cue: 0.4, length: 1.8 }) },
  'sfx.recruit': { group: 'Ship', use: 'When one of your ships flies into a wreck and recruits it; brighter for bigger wrecks (its own pitchPerTier in the manifest).', scene: (t) => ({ items: [{ ship: 'ship.fighter{t}.wreck', x: 0, y: 0, until: 0.5 }, { fx: 'vfx.recruit', x: 0, y: 0, at: 0.5 }, you(t, { x: 0, from: 0.5 })], cue: 0.5, length: 2 }) },
  'sfx.merge': { group: 'Ship', use: 'When ships merge into a bigger one (deeper for bigger merges), and when the Merge Module merges items.', scene: (t) => ({ items: [{ fx: 'vfx.merge', x: 0, y: 0, at: 0.3 }, you(t + 1, { x: 0, from: 0.9 })], cue: 0.3, length: 2.2 }) },
  'sfx.command': { group: 'Ship', use: 'When command passes to another of your ships (the one you flew was destroyed, or a bigger one took over).', tiered: false, scene: (t) => ({ items: [you(t, { x: 0 }), { fx: 'ui.command-ring', x: 0, y: 0, at: 0.4, until: 1.6 }], cue: 0.4, length: 2 }) },

  // Alerts and menus
  'sfx.alert': { group: 'Alerts and menus', use: 'When an enemy fleet or an elite arrives.', tiered: false, label: 'An enemy fleet arrives! / Elite incoming!' },
  'sfx.swarm': { group: 'Alerts and menus', use: 'The klaxon when a swarm wave comes ("Swarm incoming!").', tiered: false, label: 'Swarm incoming!' },
  'sfx.reinforcements': { group: 'Alerts and menus', use: 'When Fleet HQ warps in reinforcements.', tiered: false, label: 'Fleet HQ is warping in reinforcements!' },
  'sfx.levelup': { group: 'Alerts and menus', use: 'When you gain a level (the cards appear).', tiered: false, label: 'Level up! Pick a card' },
  'sfx.card': { group: 'Alerts and menus', use: 'When you pick a card.', tiered: false, label: 'A card is picked' },
  'sfx.loot': { group: 'Alerts and menus', use: 'When your ships pick up an item ("Found: …").', tiered: false, scene: (t) => ({ items: [{ fx: 'ui.loot.rare', x: 0, y: 0, at: 0, until: 0.5 }, you(t, { x: -60, vx: 120, until: 0.5 }), you(t, { x: 0, vx: 120, from: 0.5 })], cue: 0.5, length: 1.6 }) },
  'sfx.gameover': { group: 'Alerts and menus', use: 'When the run ends (your whole fleet is gone).', tiered: false, label: 'Game over' },

  // Leviathan (the boss; hidden on the published ShipArt until it's revealed)
  'sfx.leviathan-charge': { group: 'Leviathan', use: 'While the Leviathan charges its beam (its mouth glows).', tiered: false, scene: () => ({ items: [lev('boss.leviathan.head-side-mouth-open', 0, { until: 2.4 }), { fx: 'boss.leviathan.charge-ball', x: 30, y: 0, at: 0.3, until: 2.3 }], cue: 0.3, length: 2.6 }) },
  'sfx.leviathan-beam': {
    group: 'Leviathan',
    use: 'Loops while the Leviathan fires its beam.',
    tiered: false,
    loop: true,
    scene: () => ({ items: [lev('boss.leviathan.head-side-mouth-open', 0, { until: 2.4 }), { beam: 'boss.leviathan.beam', x: 30, y: 0, angle: 0, length: 400, at: 0.3, until: 2.2, width: 1 }], cue: 0.3, length: 2.6, loopUntil: 2.2 }),
  },
  'sfx.leviathan-bump': { group: 'Leviathan', use: "When a ship bumps into the Leviathan's body and is knocked away.", tiered: false, scene: () => ({ items: [lev('boss.leviathan.segment', 0, { until: 1.6 }), you(1, { x: -60, vx: 80, until: 0.5 }), you(1, { x: -30, vx: -160, from: 0.5 }), { fx: 'boss.leviathan.bump', x: -20, y: 0, at: 0.5 }], cue: 0.5, length: 1.6 }) },
  'sfx.leviathan-roar': { group: 'Leviathan', use: 'Its roar: when it first comes near, now and then in the fight (mouth open), before a ram, and as it dies.', tiered: false, scene: () => ({ items: [lev('boss.leviathan.head', 0, { until: 0.4 }), lev('boss.leviathan.head-side-mouth-open', 0.4, { until: 3 })], cue: 0.4, length: 3.2 }) },
  'sfx.leviathan-deeproar': { group: 'Leviathan', use: 'Its deep roar from beyond the rift, as the rift tears open in its entrance.', tiered: false, scene: () => ({ items: [{ fx: 'boss.leviathan.rift', x: 0, y: 0, at: 0.3, until: 3 }], cue: 0.3, length: 3.2 }) },
  'sfx.leviathan-rift': { group: 'Leviathan', use: 'The rift tearing open (with the flash) in its entrance.', tiered: false, scene: () => ({ items: [{ fx: 'boss.leviathan.rift', x: 0, y: 0, at: 0.3, until: 2.4 }], cue: 0.3, length: 2.6 }) },
  'sfx.leviathan-thunder': { group: 'Leviathan', use: 'Distant lightning in its entrance (the strikes also destroy the enemies left).', tiered: false, scene: () => ({ items: [{ fx: 'boss.leviathan.lightning', x: 0, y: 0, at: 0.3, until: 0.7, scale: 2 }], cue: 0.3, length: 1.4 }) },
  'sfx.leviathan-orb': { group: 'Leviathan', use: 'When the Leviathan lets go of an energy ball.', tiered: false, scene: () => ({ items: [{ fx: 'boss.leviathan.orb', x: 0, y: 0, at: 0.3, until: 1.8, vx: 30 }], cue: 0.3, length: 2 }) },
  'sfx.leviathan-pulse': { group: 'Leviathan', use: 'When an energy ball pulses (hurting ships near it).', tiered: false, scene: () => ({ items: [{ fx: 'boss.leviathan.orb', x: 0, y: 0, at: 0, until: 1.6 }, { fx: 'boss.leviathan.orb-pulse', x: 0, y: 0, at: 0.5 }], cue: 0.5, length: 1.6 }) },
  'sfx.leviathan-wound': { group: 'Leviathan', use: 'When it takes a heavy wound (every 1/20 of its health): blood sprays and parasites burst out.', tiered: false, scene: () => ({ items: [lev('boss.leviathan.segment', 0, { until: 1.8 }), { fx: 'boss.leviathan.blood-hit', x: 0, y: 0, at: 0.4 }, ...[0, 1, 2, 3, 4, 5].map((i): SceneItem => ({ shot: 'boss.leviathan.blood', x: 0, y: 0, angle: (i * Math.PI) / 3, speed: 160, at: 0.4, until: 1.4 }))], cue: 0.4, length: 1.8 }) },
  'sfx.parasite-latch': { group: 'Leviathan', use: 'When a parasite latches onto one of your ships.', tiered: false, scene: () => ({ items: [you(1, { x: 0 }), { fx: 'boss.leviathan.parasite', x: 40, y: -30, at: 0, until: 0.5, vx: -70, vy: 50 }, { fx: 'boss.leviathan.parasite', x: 6, y: -6, at: 0.5, until: 1.6 }], cue: 0.5, length: 1.6 }) },
  'sfx.parasite-shake': { group: 'Leviathan', use: 'When a dash shakes the parasites off your ships.', tiered: false, scene: () => ({ items: [you(1, { x: -40, until: 0.4 }), { fx: 'boss.leviathan.parasite', x: -34, y: -6, at: 0, until: 0.4 }, { fx: 'vfx.dash', x: 40, y: 0, at: 0.4 }, you(1, { x: 40, from: 0.4 }), { fx: 'boss.leviathan.parasite', x: -34, y: -6, at: 0.4, until: 1.6, vx: -40, vy: -30 }], cue: 0.4, length: 1.8 }) },
};

/** "sfx.explosion.t3" → "sfx.explosion"; tier versions are listed under their base sound. */
export const soundBaseOf = (name: string) => name.replace(/\.t\d+$/, '');
