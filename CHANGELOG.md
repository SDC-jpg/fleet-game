# What's new

Player-facing changes, newest first. When a new version goes live, the lines
added here since the last version are posted to the Discord build-log channel.
Keep each change on one line starting with `- `.

## 2026-11-13

- New ship art for tiers 2–4, with new thrusters (including an animated boost flame) in new spots.
- ShipArt remembers what you were looking at after a reload (object, state, zoom, Fly/Spin and the rest), and the mouse wheel zooms the preview.
- ShipArt: an animated part can now be a folder of PNG frames (one file per frame) instead of a single sheet.
- ShipArt: mines, gun shots, lasers and wrecks can now be previewed and dressed up too (flashes, sparks, smoke emitters, and where their blast or hit appears).
- ShipArt: an effect's image can be swapped for another PNG, or for a zip of PNG frames, which is unpacked into its own folder.
- ShipArt: an Effects section plays every effect (explosions, hits, shields...) over the stars, with its speed and looping adjustable.
- Missiles now leave a faint smoke trail once they fire up.
- ShipArt: a rollout menu with Ships and Objects. Missiles can be previewed inert, fired up, at impact, or as a full launch sequence, and their flame, smoke trail and impact point can be moved and edited.
- Missiles leave the ship with a soft thump, then each one fires up its own little thruster (with a whoosh) before blasting off, and bursts in a small round explosion on impact.
- Run log: the "Fleet destroyed" screen now lists every run you've played (with its version), with bars to compare best value, time, waves, ships and value destroyed and lost.
- The "Fleet value over time" graph is wider, marks every 5th wave (labelling a few), and has faint lines every 100 fleet value.
- The version and its date are shown at the bottom right of the screen.
- Missiles now drop out of your ship side by side, turn to face their targets, then blast off. A volley spreads across every enemy in a wide cone ahead of you (up to 900 away), and only focuses on one enemy when it's the only one in range.
- The starting zoom now matches your monitor's real resolution: Windows display scaling (125%, 150%) no longer makes the game zoom in too far, and bigger monitors show the same view in sharper pixels.
- Testing three ways of drawing rotated ships, to reduce the jagged "laddering" when they turn: Grid (as before), Hi-res and RotSprite. Switch with the U key in the game or the Rotation buttons in ShipArt.
- New thruster placement on the first two ship sizes: the smallest ship has one centre thruster with fewer sparks, and the tier 2 ship has two thrusters drawn over its hull.
- ShipArt: thruster particles have an Angle setting, the width of the cone they spray in (360 = every direction).
- ShipArt: a purple VFX panel shows each thruster's particle settings (image, spawn rate, life, speed, drag) with a preview of the particle image.
- ShipArt: a Stars button switches the preview background between stars and plain black (remembered).
- Ships now have separate thruster flames, placed per ship with the new ShipArt tool, and they give off small orange sparks when moving and purple ones when boosting. Some bigger ships have extra thrusters that only light up while boosting.
- Dashing no longer switches ships to their boosting look.
- ShipArt (view only): see every ship tier with its thrusters in each state at https://sdc-jpg.github.io/fleet-game/shipart.html
- Your equipment is now kept between games, even if you reload the page. Each new version of the game starts everyone with empty equipment again.
- New equipment screen (Esc): slots in a ring, 3 per ship tier up to tier 10, with your fleet bonuses in the middle. Drag items into slots to equip, move or swap them; drag them to the inventory to take them off; right-click is a shortcut for both. Hover any item for its details. The inventory can be filtered by rarity and sorted.
- Your level and XP bar moved to the bottom centre, under the skills, with counters for ships destroyed and their total value.
- Smoother movement on fast screens (120 Hz and up): ships and shots no longer look blurry or doubled while boosting or dashing.
- Ship tiers are back to the original pace: 16 ships merge into one bigger ship, starting once your fleet is worth 32.
- Elites are one tier bigger than the normal enemies of their wave.
- Level-up cards appear half a second after the kill, so you see it happen first.
- Press Q to switch auto-fire on or off (fires as if you held left click).
- Missiles launch a little faster (40 instead of 30).
- Shots fly further before fading out.
- Levelling up takes more XP (the first level needs 50).
- Skills can now be upgraded up to rank 10 instead of 5.
- Dropped items stay for 2 minutes before disappearing.
- Missiles launch slowly, then speed up to a much higher speed in half a second.

## 2026-11-12

- Elite enemies: from wave 10, every 5 waves a strong enemy with an orange ring arrives. It uses skills like yours (watch for the dashed line before its laser fires) and always drops a wreck, an item, or both, with better odds of rare items.
- Freeze from an elite only stops your ships shooting; they can still move.
- The control help lines moved to a thin bar at the very top of the screen.
- **Equipment!** Destroyed enemies sometimes drop items (bigger enemies more often). Fly over them to pick them up. Each item boosts your whole fleet: damage, fire rate, health, speed, boost time, boost speed or skill recharge. Rarer items give bigger boosts.
- Press **Esc** to pause and manage your equipment. You get 3 slots per ship tier you reach.
- **Skill upgrades:** level-up cards can now rank up a skill you have (up to rank 5), improving its damage, fire rate or size. Upgrade cards come in four rarities: Common, Uncommon, Rare (gold) and Epic (purple). Rarer cards give bigger bonuses.
- New defence skill: **Freeze**. Enemies in a cone in front of you stop moving and shooting for a moment.
- A **skill bar** at the bottom of the screen shows your skills, their cooldowns and their ranks.
- **Levels and skills!** Destroying enemies earns XP. Each level-up pauses the game and lets you pick one of three cards: a new skill or a fleet bonus.
- Five skills to start: **Laser**, **Missiles** and **Mines** fire with your gun while you hold left click; **Shield** and **Repulse** go off when you right-click. You can stack up to 3 weapons and 2 defences.
- Enemy fleets now grow steadily with each wave instead of matching your fleet size.
- **Rolled back to version 11.** Ship classes, loot, the body shop and the new HUD are gone for now (they're saved for later). Some favourites come back below.
- Back: bigger ships turn more slowly (25% slower per tier), so they feel heavier and you have to aim ahead. Small ships stay nimble.
- Back: boost (Shift) now runs on stamina: about 3 seconds from full, shown by the ring around your ship, which refills when you let go. Boost is faster to make up for it.
- Back: the dash is much stronger: it now starts at 8× speed and carries your fleet much further.
- Back: bigger ships have more boost (+50% boost time per tier).
- Back: your first kill always leaves a wreck, so you get a wingman early.
- Back: new art for tier 2 ships.
- Back: **Space** dashes, and only the left mouse button fires (right-click does nothing for now).
- Back: the boost ring around your ship is a smooth line instead of dots.
- Back: the camera zooms out less with bigger ships (2× at tier 2, 1× from tier 3).

## 2026-11-11

- Testing setup: bigger ships come 4× faster (4 ships merge into the next tier, starting at fleet value 8), and big enemies leave wrecks more often. Fleet values are smaller numbers for now.
- New: a **tuning settings page** listing every adjustable number in the game with its current value. It updates itself with each new version.
- Dash cooldown shortened from 30 to 18 seconds.
- The dash now goes further when the camera is zoomed out, so it stays useful with a big fleet.
- New: **right-click to dash**. Your whole fleet bursts to 3× speed for a moment, with a speed trail. 30 second cooldown.
- Your ship is 20% faster flying toward your cursor and about 18% slower backing away.
- **Esc pauses** the game. It also pauses by itself when you click another window.
- End screen report: ships destroyed and lost, and a graph of your fleet's value over the run.
- Waves come slightly faster as the game goes on, with a random rhythm: some arrive early, some late.
- Merging 16 ships now fires a ring of shots in every direction.
- Bigger ships fire a little slower but hit harder (same damage overall).
- Wrecks have a yellow marker so they're easy to spot when zoomed out.
- Bigger wrecks make a brighter sound when you recruit them.
- Fixed: the survival timer kept running after your fleet was destroyed.
- Wingmen now fire where you aim: they only turn up to 15° away from their leader's facing. Enemy fleets follow the same rule.
- Sound effects! Press **M** or click the speaker button to turn them on or off.
- Big fleets (tier 3 and up) are less zoomed out, so ships stay readable.
- Frames-per-second counter in the HUD.
- Ship tiers: 16 ships of one tier merge into one bigger, stronger ship.
