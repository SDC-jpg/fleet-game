# New skills: specification

Status (2026-11-15): all three batches built. Wrecksplosion and Tractor Beam are switched off (`enabled: false`) at the user's request (2026-11-15). 14 new skills to add to the 6 that already exist. Numbers below are the starting values in `config.ts`.

## Background: how skills work today

Every new skill follows the same rules as the existing six (Laser, Missiles, Mines, Shield, Repulse, Freeze):

- **Picking:** you get skills from level-up cards. You can hold up to 3 left-click skills (weapons) and 2 right-click skills (defences) at once (`CONFIG.cards`). Skills reset every run.
- **Firing:** holding left click (or auto-fire, Q) fires the gun plus every ready weapon. Pressing right click fires every ready defence. Each skill then waits out its cooldown.
- **Ranks:** rank-up cards (up to rank 10) improve one stat from that skill's own list:
  - **power:** damage, strength or duration.
  - **rate:** shorter cooldown.
  - **size:** a bigger area, beam or blade.
  - **count:** whole extra things (missiles, bounces, pods…), adding 1/1/2/2/3/4/5 by rarity.
  - **reach:** range, ×1.2 per card.
- **Card strength:** each card's bonus depends on its rarity, about +10% (Common) to +95% (Mythic). Mythic items can also carry a skill upgrade.
- **Scaling:** damage and size grow with the tier of the ship you fly and with the fleet damage bonus. Every skill cast comes from the ship you fly.
- **Damage units:** all damage below is in the same units as the existing skills. For scale, Laser does 6 damage per 3-second cooldown at T1, which is about 2 damage per second; the new weapons aim for the same.
- **Art and sound:** each skill has an icon (`ui.skill.<id>`), its effects (`vfx.<id>…`) and a sound (`sfx.<id>`). All are placeholders listed in the manifest, so the art can be swapped without code changes. Sizes from size upgrades also scale the effect art.

### Rules that apply to every new skill

- **On/off switch:** each skill gets `enabled: true | false` in its `SKILLS` entry in `config.ts`. A disabled skill:
  - never appears on new-skill or rank-up cards, or in the Card index;
  - is never rolled as a Mythic item's skill bonus (an existing item's bonus for it is hidden and does nothing);
  - is never given to elites;
  - leaves no effects, sounds or HUD icons behind.

  Turning one off is a one-word change.
- **Elites use any switched-on skill** (the user's note), through `CONFIG.elite.skillDamage` (a quarter of yours) and 1.5× cooldowns like before. Where a skill would feel unfair against you, the elite's version is limited. Each limit is a setting in `CONFIG.elite`:
  - Crescent Strike stops after 3 ships.
  - Arc Impulse makes 1 bounce.
  - Plasma Lance flickers as a warning for 0.6 s, then cuts at half damage, at most 2 times per ship.
  - Splitting Beam splits at most 2 times.
  - Gravity Well pulls your ships at half strength.
  - Scramble lasts half as long.
  - Gravity Well and Scramble (anyone's) never affect the ship you fly, so you always keep control.
  - Elites never use wrecks (they're your recruits). An elite's Wrecksplosion is a scrap charge at your ship: a ring warns for 0.8 s, then it blows up at half the wreck damage and 60% of the radius. Its Tractor Beam throws a lump of scrap from its side, at half damage.
  - An elite's Force Wall is a straight wall built at once between it and you, 60% as long and lasting 60% as long.
  - An elite's Cloaking lasts 60% as long, and you still see it faintly (its arrow and marker stay).
  - An elite's Hijack takes over a quarter of the fleet value yours would, at most 3 of your ships, never the one you fly, for 60% of the time; they rejoin your fleet afterwards. Destroying one of them gives XP and maybe a wreck, like any enemy.
- **Wreck skills hit harder** (the user's note). Wrecksplosion and Tractor Beam use up wrecks you could have recruited, so they do about twice the damage of other skills, and more for bigger wrecks.
- **Targeting:**
  - "Closest to the cursor" means the enemy nearest the cursor position in the world.
  - "In range" uses the distance from the ship you fly.
  - Hidden (cloaked) or hijacked ships are never targets.
- **Player shots and skills never hurt your own ships.**

### Things the engine needs that it doesn't have yet

- **Right click held (Force Wall):** today the game only knows the moment right click is pressed.
- **A temporary team switch (Hijack).**
- **A "last known position" for enemies to aim at (Cloaking).**
- **A refraction draw mode for ship silhouettes (Cloaking).**
- **Walls that block enemy ships and shots (Force Wall).**
- **A "scrambled" state on ships (Scramble),** like the existing frozen state.

### Suggested build order

The batches are ordered by how much new engine work they need:

1. **Plain weapons:** Gatling Laser, Crescent Strike, Arc Impulse, Ion Cloud, Plasma Lance.
2. **Smarter weapons and simple defences:** Splitting Beam, Laser Pods, Gravity Well, Scramble.
3. **New systems:** Wrecksplosion, Tractor Beam, Force Wall, Cloaking, Hijack.

---

## Skill specification

### Left Click

**Gatling Laser** (`gatling`)
- **Behavior:** fires a volley of 6 thin yellow laser bolts (yellow for every team, so they stand out), one every 0.06 s, toward the cursor with ±4° random spread.
  - Bolts fly at 1200 px/s for 450 px.
  - Each bolt does 0.7 damage and stops at the first ship it hits.
  - Cooldown 1.2 s, so it is almost continuous while held.
- **Upgrades:** power (bolt damage), rate (cooldown), count (+bolts per volley).
- **Art:** `vfx.gatling-bolt` (short glowing bolt), `vfx.gatling-muzzle` (muzzle flash at the ship's gun point).

**Crescent Strike** (`crescent`)
- **Behavior:** a spinning golden crescent, 40 px across, leaves the ship and flies along a curve that always passes through the cursor, then keeps curving past it.
  - The curve is a circle sized so a full flight (600 px in 0.6 s) turns 90°. It fades at the end, and alternates left and right on each cast.
  - It passes through enemies, hitting each one once for 5 damage.
  - Cooldown 2.5 s.
- **Upgrades:** power (damage), rate (cooldown), size (crescent size and hit width).
- **Art:** `vfx.crescent` (spinning flipbook), plus a faint golden trail emitter.

**Arc Impulse** (`arcImpulse`)
- **Behavior:** an electric arc strikes the enemy closest to the cursor, within 500 px of the ship.
  - It then bounces 3 times, each time to the nearest enemy within 220 px of the last one that hasn't been hit yet.
  - The first hit does 5 damage. Each bounce does 85% of the one before.
  - The jumps happen 0.05 s apart, so the chain can be seen.
  - If nothing is in range when fired, the skill stays ready.
  - Cooldown 3 s.
- **Upgrades:** count (+bounces, the main upgrade), power (damage), rate (cooldown).
- **Art:** `vfx.arc` (jagged bolt stretched between two points, flipbook), `vfx.arc-hit` (spark).

**Splitting Beam** (`splitBeam`)
- **Behavior:** fires a fast beam (1000 px/s) toward the cursor. On hitting an enemy it does 5 damage, then splits into 2 beams.
  - The new beams fly ±35° from its direction and travel up to 300 px.
  - Each split beam does 60% of its parent's damage, and can split again if it has generations left.
  - Starts with 1 split generation (1 beam, then 2).
  - A beam that hits nothing just fades.
  - Cooldown 3 s.
- **Upgrades:** count (+split generations, the main upgrade; capped at 5 generations, so at most 32 beams at the end), power (damage), rate (cooldown).
- **Art:** `vfx.split-beam` (beam segment), `vfx.split-burst` (flash at each split).

**Laser Pods** (`laserPods`)
- **Behavior:** launches 3 pods in a 60° cone in front of the ship. They glide 80 px out over 0.3 s, then hold still in space.
  - Each pod picks the closest enemy between 100 and 600 px that no other pod has picked, or shares a target if there aren't enough.
  - Each pod fires a fast (1500 px/s), perfectly aimed laser shot that leads moving targets, every 0.5 s, for 2.5 s. Each shot does 1 damage.
  - When its target dies, a pod picks a new one.
  - Cooldown 4 s.
- **Upgrades:** count (+pods, the main upgrade), power (shot damage), rate (cooldown).
- **Art:** `vfx.pod` (small pod, idle flipbook), `vfx.pod-shot` (thin laser), `vfx.pod-fade`.

**Wrecksplosion** (`wrecksplosion`)
- **Behavior:** every wreck within 300 px of the cursor explodes at once.
  - Each blast hits enemies within 90 px for 16 damage, about twice a normal skill's damage, to make up for losing the recruits. Bigger wrecks have a bigger and harder blast (×1.5 size and ×1.5 damage per tier above 1).
  - The exploded wrecks are gone. Trade-off: those ships can no longer be recruited.
  - The 300 px radius flashes as a ring around the cursor for 0.4 s.
  - If there are no wrecks in the radius, nothing happens and the skill stays ready.
  - Cooldown 4 s.
- **Upgrades:** power (blast damage, the main upgrade), rate (cooldown).
- **Art:** `vfx.wreck-blast` (explosion, scaled by wreck tier), `vfx.wreck-radius` (ring).

**Tractor Beam** (`tractorBeam`)
- **Behavior:** a beam from the ship grabs the nearest wreck within 350 px. It then hurls the wreck at the enemy closest to the cursor.
  - The wreck speeds up to 900 px/s and homes in gently, with a turn rate like Missiles.
  - On hit it does 20 damage (×1.5 per wreck tier above 1) to that enemy and 50% of that to enemies within 50 px. The wreck is used up. That's about twice a normal skill's damage, to make up for losing the recruit.
  - The beam stays visible from the ship to the wreck while it accelerates (0.3 s).
  - If there's no wreck in range, the skill stays ready.
  - Cooldown 3.5 s.
- **Upgrades:** count (+beams, so more wrecks thrown per cast, each at its own target if possible; the main upgrade), power (damage), rate (cooldown).
- **Art:** `vfx.tractor-beam` (tiled beam). The impact uses the normal explosion.

**Ion Cloud** (`ionCloud`)
- **Behavior:** fires a cloud of 8 small glowing balls toward the cursor.
  - The cloud's centre travels 300 px over 0.5 s and slows to a stop. The balls spread within 60 px of it, drifting slightly.
  - Each ball explodes after a random 0.6–1.2 s, hitting enemies within 35 px for 1.5 damage.
  - Cooldown 3.5 s.
- **Upgrades:**
  - size: cloud spread and blast radius.
  - count: +balls.
  - power: damage.
  - rate: cooldown.

  "Bigger cloud and more balls" are two separate card types (size and count), so they can stack.
- **Art:** `vfx.ion-ball` (glowing flipbook), `vfx.ion-pop` (small burst).

**Plasma Lance** (`plasmaLance`)
- **Behavior:** an energy blade, 180 px long and 12 px wide, sticks out from the front of the ship for 1.5 s and turns with it.
  - Every enemy touching the blade takes 1.5 damage every 0.25 s.
  - Cooldown 4 s.
- **Upgrades:** power (damage), rate (cooldown), size (blade length and width).
- **Art:** `vfx.plasma-lance` (blade flipbook, stretched to length), `vfx.plasma-hit`.

### Right Click

**Force Wall** (`forceWall`)
- **Behavior:**
  - **Drawing:** while right click is held, a shimmering wall is drawn along the cursor's path. Drawing time is 0.6 s, and the length budget is 800 px per second of drawing time (480 px at rank 1).
  - **Early release:** letting go ends the wall where it is (no autocomplete, removed 2026-11-15). A click without drawing makes no wall.
  - **Lifetime:** the wall lasts 4 s.
  - **Blocking:** enemy ships can't cross it and slide along it. Enemy shots, missiles and moving skill effects (crescents, beams, ion balls, thrown scrap) that hit it are destroyed. Instant beams (Laser) and arcs are not blocked. Your ships and shots pass through.
  - **Cooldown:** 6 s, starting when the wall is finished.
- **Upgrades:** power (drawing time, and so the length budget; the main upgrade), rate (cooldown).
- **Art:** `vfx.force-wall` (shimmering segment, tiled along the path), `vfx.force-wall-hit` (ripple where a shot is stopped).

**Gravity Well** (`gravityWell`)
- **Behavior:** a well opens at the cursor for 2.5 s, with a radius of 250 px.
  - Radius 125 px (halved 2026-11-15); its swirl is drawn at 70% opacity.
  - Enemies inside are pulled toward its centre. The pull is strongest at the centre and fades to nothing at the edge, up to 300 px/s at the centre.
  - Pulled ships can still turn and shoot.
  - The radius shows as a faint swirling ring.
  - Cooldown 5 s.
- **Upgrades:** size (radius, the main upgrade), power (pull strength), rate (cooldown).
- **Art:** `vfx.gravity-well` (swirl flipbook, scaled to radius).

**Cloaking** (`cloak`)
- **Behavior:** your whole fleet turns invisible to enemies for 3 s.
  - Enemies keep aiming and flying at where each of your ships was when the cloak started, and fire at those spots.
  - Elites aim their skills there too.
  - Shots that happen to hit still do damage.
  - Your own firing doesn't break the cloak.
  - Ships that join during the cloak are cloaked too.
  - Cooldown 9 s.
- **Upgrades:** power (duration), rate (cooldown).
- **Art:** ships draw with a refractive effect. Only the outline of the silhouette shows (1 px light edge at 30%), and the starfield behind it is shifted a few pixels, like looking through glass. You still see your own ships faintly. A short `vfx.cloak` shimmer plays as the cloak starts and ends.

**Hijack** (`hijack`)
- **Behavior:** a pulse ring expands from the ship to a radius of 400 px over 0.4 s.
  - Enemies it reaches are hijacked, nearest first, until their total fleet value reaches the budget. Ships that would go over the budget are skipped. The budget is a quarter of your own fleet's value (2026-11-15; fleet value cards raise it), at least one tier-1 ship.
  - For 5 s, hijacked ships fight on your side: they shoot enemies, enemies shoot them, and they fly toward the nearest enemy.
  - They don't join your fleet and can't merge.
  - Kills they make count as yours (XP, drops).
  - If one dies while hijacked, it still drops a wreck and XP as normal.
  - Afterwards they return to the enemy.
  - Elites can't be hijacked.
  - Cooldown 8 s.
- **Upgrades:** power (fleet value budget, the main upgrade), rate (cooldown).
- **Art:** `vfx.hijack-pulse` (ring). Hijacked ships switch to your team colours and flicker in the last second.

**Scramble** (`scramble`)
- **Behavior:** a wave of disruption, 150 px wide, shoots straight out of the front of the ship at 900 px/s for 700 px.
  - Enemies it touches are scrambled for 2.5 s.
  - A scrambled ship turns toward a random new direction every 0.4 s and drifts that way.
  - It keeps firing wherever it happens to face. Its shots still only hurt your team.
  - Cooldown 5 s.
- **Upgrades:** power (duration), rate (cooldown), size (wave width).
- **Art:** `vfx.scramble-wave` (moving band flipbook), `vfx.scrambled` (small static/glitch marker over affected ships).

### Passive

None in this batch. Passive skills would need a third group on the skill bar and in the card limits (e.g. up to 2 passives), and would act all the time without a button.
