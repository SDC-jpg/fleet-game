# What's new

Player-facing changes, newest first. When a new version goes live, the lines
added here since the last version are posted to the Discord build-log channel.
Keep each change on one line starting with `- `.

## 2026-11-15
- Late waves now get much harder: from wave 30, enemy fleets (and elites) grow stronger every wave, doubling about every 14 waves.
- Only one weapon skill fires at a time now: pick it with 1, 2, 3 or the mouse wheel (tap it on touch screens). The selected one is highlighted in the skill bar. Defence skills still all go off together with right click.
- Phones and tablets get on-screen controls: a thumbstick to move and aim, Attack and Defend buttons, Dash and Boost, and a pause button.
- New Run log tab in the pause screen, also opened with the Tab key, to look at your past runs mid-game.
- Late waves hit harder: from wave 30, each wave brings more lone enemies and bigger enemy fleets (about twice as many by wave 55, three times by wave 80).
- The defeat screen now shows items collected and merges, plus a "Destroyed by" chart of kills (or fleet value) per weapon and skill. The game also starts keeping lifetime statistics for a future stats screen.
- Merge Mk. III/IV settings: a ▲▼ button flips whether QuickMerge and AutoMerge use your least rare or your rarest items first; the rarity list is now one column, shown in the order it will be used.
- Splitting Beam is switched off for now (no more cards for it).
- If your game is interrupted (browser crash, closed tab, reload), it now offers to resume your run: your fleet, level and skills come back and the wave you were on starts again.
- Off-screen loot now shows as a dot in its rarity's colour, a little further in from the edge than the enemy arrows so they don't overlap.
- Fixed a likely cause of the screen going black after merging items (items with two identical bonus lines). If the game ever hits an error, it now shows what went wrong instead of a black screen.
- Right-clicking or dragging over menus and the HUD no longer opens the browser menu or selects text.
- New particle settings: missiles leave a fuller, longer smoke trail, and thrusters puff less while cruising.
- Gatling Laser: each bolt now fires where your ship is facing at that moment, so turning sweeps the volley.
- Hijack: takes over half as much as before (a twelfth of your fleet's value instead of a sixth), still always at least one ship.
- Force Wall: you now have 0.24 seconds to draw the wall (was 0.6), so walls are quicker and shorter.
- Smoother particle trails behind fast things like missiles: the puffs now spread evenly along the path instead of bunching up.
- Merge Module upgrades: after 300, 900 and 2700 items looted, Merge Mk. II (Load: fills the slots with your lowest-rarity items), Mk. III (QuickMerge in one click, with a ⚙ to choose which rarities it may use) and Mk. IV (AutoMerge every 12 seconds) drop.
- Missiles with nothing to lock onto now turn toward where your ship was facing when you fired (and still lock on if a target shows up).
- Missiles: smaller, launched in a fan around your ship before they turn and home in, twice as fast, with a longer lock range. They run on 2 seconds of fuel; after that they tumble harmlessly for a moment and disappear.
- New test key T: adds one ship of the next tier up and moves you into it, to try bigger ships quickly.
- Your saved equipment is back: items from before version 25 load again (if you picked up items in version 25, those are what's saved now).
- Skill tuning: Wrecksplosion and Tractor Beam are switched off for now; Force Wall ends where you stop drawing; Hijack takes over about a sixth of your own fleet's value; Gravity Well is half the size and fainter; Gatling Laser bolts are yellow.

## 2026-11-14
- Five more skills: Wrecksplosion and Tractor Beam (left click; they use up wrecks but hit twice as hard), Force Wall (hold right click to draw a wall), Cloaking and Hijack (right click). Elites can use them too, in fair versions: they never use your wrecks.
- Four more skills: Splitting Beam and Laser Pods (left click), Gravity Well and Scramble (right click). Elites can use them too, toned down; they never pull or scramble the ship you fly.
- Five new weapon skills on level-up cards: Gatling Laser, Crescent Strike, Arc Impulse, Ion Cloud and Plasma Lance. Elites can use them too, toned down so they stay fair.
- Elites are fairer: their toughness now grows steadily with the waves (with some variety) instead of jumping hugely at waves 20 and 106, and one elite gives at most about 2 level-ups.
- Settings → General has a "Clear saved progress" button (asks first) that deletes your items, slots and Merge Module to start over. Your run log stays.
- Swarm waves: sometimes, instead of an elite, a big swarm of small ships sweeps in from one side in V formations, curving around you (with a "Swarm incoming!" warning and klaxon).
- The first 10 waves bring about 30% more lone enemies, so the early game gets going faster.
- Gearscore: the rarity of everything you have equipped, added up (Common 1 to Mythic 7). It shows under Fleet bonuses on the equipment screen and is recorded with each run.
- The run log has "My runs" and "Leaderboard" views, a two-letter code for each player, and a Gearscore column; the top bar in each column is now orange.

- Rarities now go from 1 to 7: Common, Uncommon, Superior (blue, was Rare), Rare (purple, was Epic), and new Epic (yellow), Legendary (red) and Mythic (holographic). Your saved items keep their bonuses.
- Legendary items come with an extra Damage or Hitpoints bonus, Mythic items with two, and some Mythic items also carry a level-up card's bonus.
- New: the Merge Module. After looting 100 items it drops from the next enemy you destroy. Use it on the pause screen to merge 3 items of the same rarity into a better one; merging Mythic items makes "+1", "+2"... versions with bigger bonuses.
- Inventory filters are now small colour squares, and one ▲▼ button flips rarest first / rarest last.
- New Settings tab: "Keep the mouse inside the game" for players with several monitors, and a card index showing every level-up card.
- Missile and mine upgrade cards now add whole missiles or mines (mines can drop several at once). Freeze can get range upgrades (×1.2 each).
- Missiles turn more slowly (2 instead of 4).
- Level-up cards now wait until the explosion of the kill that levelled you up has finished.

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
