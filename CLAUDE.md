# Project notes for Claude

## About the user
- New to coding and to AI-assisted development. This is a learning project to try making games with Claude.
- Explain what you're doing in plain language. Keep changes small.

## Goal and stack
- A simple browser game the user can play and keep improving.
- TypeScript + React, built with Vite.
- No game engine. Write a small engine of our own, made just for this game.

## Workflow
1. Build a quick, rough playable prototype first, before any design doc.
2. The user plays it and sends batches of notes. Implement them.
3. Once the design settles, write a short design doc.
4. When the user says "remember this" or "don't suggest that again", record it in the Decisions section below.
5. Commit to git whenever the game is in a working state.

## Environment
- The user is on a Windows PC. Claude runs inside Anthropic's reference dev container (Docker), and its firewall only allows npm, GitHub, the Claude API and a few others.
- Permission prompts stay on. Ask before running commands.
- Start the dev server with `npm run dev`. It already runs `vite --host`, so the user can open http://localhost:5173 in their Windows browser.
- File-change alerts don't reliably reach the container from the Windows folder, so `vite.config.ts` uses polling (`server.watch.usePolling`). Keep it. If the browser ever shows stale code, restart the dev server.
- Keep LF line endings in `.devcontainer` files (enforced by `.gitattributes`).
- `.devcontainer/init-firewall.sh` uses `ipset add -exist` to fix a duplicate-IP startup error. This is the user's own fix. Don't revert it.

## Publishing (GitHub Pages)
- Public repo: https://github.com/SDC-jpg/fleet-game. Live game: https://sdc-jpg.github.io/fleet-game/ (the user shares this with a teammate). View-only ShipArt for the teammate: https://sdc-jpg.github.io/fleet-game/shipart.html.
- Every push to `main` rebuilds and republishes through `.github/workflows/deploy.yml`, with test keys on (`VITE_TEST_KEYS`). Pushing publishes publicly. **Only push when the user says to.** Don't ask after each change, because the user will say when.
- **The user's own art work goes out with each push (agreed 2026-11-13):** when the user says "push", first check for their uncommitted ShipArt/art changes (`public/assets/ships.json`, new or changed files in `public/assets/`), commit them in a separate commit (with a player-facing CHANGELOG line if players would notice, e.g. new thruster positions), and say so in the reply. Skip this only if they say "push, but not my ship layouts" (or similar). Between pushes, leave their `ships.json` edits uncommitted; they may be mid-experiment.
- **Discord logs** (webhook URLs are GitHub secrets, never in files):
  - The `notify` job in `deploy.yml` runs `.github/scripts/discord-build-log.sh`, which posts "version N is live" plus the `- ` lines added to `CHANGELOG.md` since the last successful publish to the build-log channel (`DISCORD_WEBHOOK_BUILD`), or a failure notice.
  - **For every player-facing change, add one plain-language line to `CHANGELOG.md`** (under today's `## YYYY-MM-DD` heading, newest first) in the same commit. Write it for players, not as a code note.
- Commits use the user's GitHub noreply email (set in this repo's git config). Never commit with their personal email.

## Seeing the game (for Claude)
- The container has Chromium (installed by the Dockerfile at build time, no firewall change needed). `tools/screenshot.mjs` drives it with `playwright-core` and saves screenshots that Claude can view with the Read tool. It also prints browser errors.
- Example (dev server must be running): `node tools/screenshot.mjs --out <scratchpad>/shots 'wait:1500' 'press:Equal*10' 'hold:KeyD:800' 'shot:fleet'`. Quote the steps, because the shell (zsh) treats `*` as a filename wildcard. Run it with no steps for a single screenshot. Steps also include `rclick` and `wheel:down`/`wheel:up`.
- Dev-only test keys help set up scenes: `=`/`-` add/remove ship, `]` add 16 ships, `G` invincible, `K` destroy on-screen enemies, `X` end the run (to see the report), `L` gain a level, `J` get every skill, `I` drop 3 items next to you, `E` spawn an elite, `O` switch elites on/off (remembered in that browser via localStorage, overrides `CONFIG.elite.enabled`), `U` cycle the rotation mode (Grid / Hi-res / RotSprite, shared with ShipArt's Rotation buttons, remembered). The controls and test-key lines sit in a thin bar at the top of the screen.
- Use it to check visual changes before handing them to the user. The browser has no graphics card, so it can't judge smoothness or performance. The user does that.

## Code layout
- `src/engine/`: the small homegrown engine (asset loading from the manifest, pixel renderer with whole-number zoom, sound playback (`sound.ts`), input, fixed 60 Hz game loop; `settings.ts` for remembered browser settings; on faster screens ships and shots are drawn between steps (`drawAtSmoothPositions` in `Game.ts`) to avoid a double-image stutter).
- `src/game/config.ts`: every tuning number (speeds, health, waves, zoom steps, ship types and their hit sizes). Its comments also feed the public tuning page: give every new setting a one-line `/** */` description, and start a group of plain settings with a `// == Title: note ==` line.
- `tools/make-tuning-page.mjs`: runs at the end of `npm run build` and writes `dist/tuning.html`, a table of every setting with its value and description, read from `config.ts`. It's published at https://sdc-jpg.github.io/fleet-game/tuning.html (the user's teammate uses it) and linked in the Discord build post. It warns about settings with no description.
- `src/game/save.ts`: saving and loading equipment (see Progression).
- `src/game/shipLayout.ts`, `particles.ts`: ship layouts from `public/assets/ships.json` (base image per state, mounts such as thrusters with per-state images and VFX points) and thruster particles. `drawShipArt` in `render.ts` draws a ship with its layout (used by the game and ShipArt).
- **ShipArt tool** (`shipart.html`, `src/shipart/`): browse ship tiers, preview Idle/Move/Boost/Dash (Fly, Spin, team colours, zoom), place and drag mounts and VFX points, choose part images per state, Save. The purple **VFX panel** (between the preview and the mounts panel) holds everything about the selected mount's effects: VFX point, and per-state particle settings (image, spawn rate, life, speed, drag, angle = spawn cone width in degrees, 360 = every direction; stored per mount in `ships.json` as `vfx`, falling back to `CONFIG.particles`), a particle image preview on black/gray/white, "Open image" and "Copy folder path". New VFX settings go in this panel. `/__shipart/info` gives the project's Windows path (read from the container's mounts at run time; never write it to a file, it contains the user's name). `tools/shipart-plugin.ts` (in `vite.config.ts`) gives the dev server `/__shipart/files` (lists art) and `/__shipart/save` (writes `ships.json`), and writes `assets/art-files.json` into builds so the published copy (view-only) knows the art. Screenshot it with `--url http://localhost:5173/shipart.html`.
- `src/game/skills.ts`, `progress.ts`, `curves.ts`: pilot skills; XP, levels and cards; progression formulas.
- `src/game/world.ts`: game rules (no drawing; it queues sound events in `state.sounds`, which `Game.ts` plays). `src/game/render.ts`: drawing. `src/game/Game.ts`: connects input, rules and drawing.
- `src/App.tsx`: React canvas and HUD.
- `public/assets/`: all art and sound effects (`sfx/`), plus `manifest.json` (sprite and sound names → files) and `README.md` (art and sound guide for the user).
- `tools/make-placeholder-art.mjs` (`npm run make-art`): generates placeholder PNGs and never overwrites existing files unless run with `--force`.
- `tools/make-placeholder-sfx.mjs` (`npm run make-sfx`): generates placeholder WAV sound effects (simple retro synth), same no-overwrite rule.
- Claude can't hear sounds in the container: check them by recording which sounds start (patch `AudioBufferSourceNode.prototype.start` in a Playwright script). The user judges how they sound.

## Decisions
<!-- Things the user asked to remember, or asked Claude not to suggest again. -->
- **Art must be easy to swap.** The user is a digital artist and will eventually replace all placeholder art with their own: images with transparency (alpha), flipbook (frame-by-frame) animations, VFX such as explosions, and characters. Build with this in mind from the start:
  - Draw everything visual from image or sprite assets. Don't hard-code shapes into game logic.
  - Keep art files in one clear folder, and list them in a single asset manifest (a file mapping names like `player.idle` or `vfx.explosion` to their files and frame settings).
  - Support flipbook animations from sprite sheets or numbered frame files, with frame size, frame count, frame rate and looping set in the manifest, not in code.
  - Don't let gameplay depend on the exact pixel size of the art. Use separate collision sizes and anchor points.
  - **One image set per ship design, used by both teams.** Team-colour parts are painted in strong sky blue; the game recolours them per team at load time (`CONFIG.teamColors`). Never ask the user for separate player/enemy versions.
  - **Placeholders must stand out from the user's art.** Never imitate the user's art style when generating new assets. Keep the original placeholder style (simple flat-coloured shapes with a dark 1 px outline, like the first 32×32 fighters).
  - **Sounds follow the same rules:** sound effects only (no music for now), each in `public/assets/sfx/`, listed by name in the manifest's `"sounds"` section with volume and overlap limits, with `.t2`… tier versions falling back to a lower-pitched smaller tier. The recruit sound gets brighter with the wreck's tier (manifest `pitchPerTier`). Sound is on by default, M or the HUD button toggles it, and wingmen's shots play quieter (`CONFIG.audio.allyShotVolume`; may become silent if distracting).
  - **Ship parts are separate from the ship image (2026-11-13):** the base ship image stays the same in every state; thrusters (and later turrets etc.) are mounts placed with ShipArt. Part images live in `public/assets/parts/` named `<category>-…png` and are found automatically (no manifest entry). A mount has an image per state or none (hidden), so boost-only thrusters are possible. Dash doesn't change thrusters. The old `.move`/`.boost` ship images are no longer in the manifest.
  - **Rotation and laddering (comparison built 2026-11-13, choice pending):** rotating pixel art on the game-pixel grid makes laddering. `renderer.rotation` has three modes to compare: `grid` (original), `hires` (whole scene drawn at screen resolution, so art pixels tilt as solid squares; no help at 1× zoom, where T3+ are seen), `rotsprite` (`src/engine/rotsprite.ts`: Scale2x ×3 to 8×, rotated copy per angle step made on first use and kept; 128 steps; ships, their mounts and wrecks only, other sprites use grid). Default is grid until the user picks.
  - Placeholder art should follow the same conventions, so swapping in real art means replacing files (and maybe editing the manifest), not changing code.

### Game concept: pixel-art spaceship fleet combat
- The player starts as a single spaceship and grows a fleet. As the fleet grows, the camera zooms out and the fights get bigger, eventually fleet against fleet.
- **Movement:** the flagship is 20% faster moving toward where it faces (the cursor) and 18% slower backing away, blended smoothly (`directionalSpeed`). **Shift boost** (2.2× speed) runs on stamina (`CONFIG.boost`): 3 s from full, refills in 6 s after a 0.75 s rest; running dry locks it until 30% refilled. Boost time grows 1.5× per tier of the ship you fly (`durationPerTier`). The flagship's command ring is the stamina meter (a flipbook whose frames go empty → full, dimmed while locked). **Space dash:** the whole fleet is kicked to 8× speed at once, fading back over 0.5 s, with an 18 s cooldown. The extra speed scales with zoom (3/zoom) so the dash covers the same share of the screen at every zoom and a flipbook trail (`vfx.dash`) behind each ship (`CONFIG.dash`).
- **Auto-fire:** Q toggles it; it acts like holding left click (gun plus weapon skills).
- **Pause:** Esc toggles it. While stopped (pause, equipment, cards) the loop runs at 30 FPS. The game also pauses by itself when the window loses focus, and the screen isn't redrawn while paused.
- **The first kill of a run always leaves a wreck** (`firstKillWreck`).
- **End-of-run report:** ships destroyed and lost (count and value; merged ships aren't losses), and a graph of fleet value with one point per wave start.
- **Waves:** each gap is 0.5% shorter than the last (starting at 12 s), then randomly ±20%, never below 4 s, to vary pressure and calm.
- **Fleet control:** the player flies one ship directly (WASD/arrows to move, mouse to aim, left-click to fire; right-click is free for now). The other ships follow in formation and shoot nearby enemies on their own. They only aim and fire within ±15° of their leader's current facing (`allyFireArc`; enemy fleets too, `enemyFireArc`), so the fleet fires where the player aims. Simple fleet orders (formation spacing, attack target, hold back) come later.
- **Zoom is measured against a 1080-pixel-tall monitor in real (physical) pixels** (2026-11-13, teammate's report): zoom 3 = 3 screen pixels per art pixel on 1080p whatever the Windows scaling or browser zoom, 4 on 1440p, 6 on 4K (same view). The test bar shows monitor size, scaling and pixels per art pixel. ShipArt's zoom stays plain pixels.
- **Zoom:** in steps at whole-number pixel scales (e.g. 4× → 3× → 2× → 1×) so pixel art stays crisp, with a quick smooth transition between steps. Steps trigger at fleet-size thresholds.
- **Getting new ships:** start with flying into wrecks to recruit them. Other ways (buying, capturing enemies) may come later.
- **Flagship death:** command passes to another ship in the fleet, and it's game over only when the whole fleet is gone. Later, the player should be able to switch to any owned ship at will, because ships will eventually have different modules and weapons.
- **Mode:** endless survival for now. Track a "max fleet size reached" stat to measure how well a run went.
- **Ship size:** the starter ship is about 32×32 pixels. Larger ships must be possible, so don't assume a fixed sprite size.
- **Ship types:** all ships are the same type for now. Different types are a nice-to-have for later.
- **Tiers and merging** (numbers in `CONFIG.tiers`):
  - Fleet value = what every ship is worth in tier-1 ships (T2 = 16, T3 = 256...). It's the score.
  - Once fleet value reaches 32, any 16 ships of one tier merge into one of the next tier, so there are never more than 15 per tier. Merging is automatic for now; merging by choice may come later.
  - The testing values (4 / 8 / 0.6, 2026-11-11 to 11-13) were removed on 2026-11-13: tiers are back to version 10 (16 / 32 / 0.4).
  - Each tier: 12× health and 12× damage per volley, always 2 shots per volley for T2+ (6× per shot at T2, 72× at T3...), 1.5× size, shots 1.2× faster and travelling 1.5× further.
  - Each tier turns 25% slower (`turnRatePerTier` 0.75), so big ships feel heavy and reward aiming ahead.
  - Each tier fires 1.25× slower with harder shots, so damage per second still grows exactly 12× (`fireIntervalPerTier`). Prepares for different shot types later.
  - Merge moment: the ships fly into the core, flash, big ship appears. They can't shoot or be hit meanwhile. The finished merge fires a ring of 16 shots, each as strong as the new ship's normal shot (`mergeBurstShots`).
  - You always fly one of your biggest ships (promoted after a merge or recruiting a bigger wreck). A dead ship takes its whole worth; merged ships never split.
  - Enemy fleets use the same tier rule. Bigger enemies leave wrecks of their tier, less often (×0.4 per tier).
  - Formation by size: biggest ships in the inner rings.
  - Zoom follows the highest tier: 2× at T2, 1× from T3 on (the user's choice, 2026-11-11). Tried earlier: 1× at T2 and 0.75× at T3; rejected as too zoomed out: 0.5× at T3, 0.25× at T4.
  - Each tier has its own art (`ship.fighter.t2`...), canvases growing 1.5× per tier from the 64 px fighter.

### Rollback to version 11 (2026-11-12)
- Versions 12–13 explored ship classes (Lancer/Knight/Ballista modules, combos, right-click abilities, wheel switching), loot (rare modules, elites, module drops, scrap), a body shop, a bottom HUD with pixel font, class icons and a flagship marker. **The user and teammate found them not convincing** and rolled back to version 11 (`f45f444`). Don't bring those features back unless the user asks.
- That work is kept on the `explore/classes-and-shop` branch (also on GitHub), including its design doc `docs/DESIGN.md`. Pieces can be copied from there when asked.
- Kept from the exploration: boost stamina and its ring (continuous line), +50% boost time per tier, 8× dash, 25% slower turning per tier, the user's zoom steps, the user's T2 art, first kill always leaves a wreck, Space dash and left-click-only fire. The testing merge values (4 / 8 / 0.6) stayed until 2026-11-13.

### Progression: levels, skills, equipment (planned 2026-11-12)
- **Pilot vs fleet:** XP, levels and skills belong to the pilot (they act from the ship you fly and survive flagship changes); equipment bonuses apply to the whole fleet.
- **Enemy pressure grows by wave, not with your fleet:** enemy fleet value = `enemyFleetValueStart + enemyFleetValuePerWave × wave^enemyFleetValueCurve` (from `enemyFleetsFromWave`, every `enemyFleetEveryNthWave`). Formulas live in `src/game/curves.ts`; the tuning page shows a preview table worked out with that code.
- **XP** = enemy value × `levels.xpPerValue`; XP for the next level = `firstLevelXp × growth^(level − 1)` (firstLevelXp 50 since 2026-11-13; growth 1.15; 1.25 was too steep).
- **Level-up:** after 0.5 s (`levels.cardDelay`, so the kill can play out) the game pauses and shows 3 cards (`src/CardScreen.tsx`; click or keys 1–3): new skills (more likely), or fleet bonus cards (damage, fire rate, repair). Rules in `src/game/progress.ts`.
- **Skills** (`SKILLS` in config, rules in `src/game/skills.ts`): they stack, up to 3 weapons and 2 defences. Holding left click fires the gun plus every ready weapon; right click fires every ready defence. Cooldowns about 3 s. Damage and size grow with the flagship's tier and the fleet damage bonus. Weapons: Laser (instant piercing beam), Missiles (homing cluster; launch at 40 and ramp to 500 speed in 0.5 s), Mines (dropped behind, blow up when an enemy comes near, fizzle after 6 s). Defences: Shield (bubble on you and nearby ships), Repulse (pushback shockwave that also wipes enemy shots), Freeze (cone in front: enemies can't move, turn or shoot for 2 s).
- **Ranks (Phase 2, done):** rank-up cards (only for skills you have, up to rank 10; was 5 until 2026-11-13) improve one random stat: power (damage/strength/force/freeze duration), rate (shorter cooldown) or size (beam size, blast size, reach, cone size, or more missiles). Each card has a rarity (`CONFIG.rarity`: weights 60/25/11/4, bonuses ~10/15/22/32% ±20%); upgrades are stored as multipliers in `OwnedSkill.mods`. Size upgrades also scale the effect art (`drawSprite` scale, `Effect.scale`).
- **Bottom-centre HUD** (`src/BottomHud.tsx`): skill bar, then level + XP bar (¼ screen wide), then ships destroyed and value destroyed.
- **Skill bar** (`src/SkillBar.tsx`, bottom centre): skill icons grouped by mouse button, dark while recharging and refilling from the bottom, with rank dots.
- **Equipment (Phase 3, done; `ITEM_STATS`, `CONFIG.items`, rules in `src/game/equipment.ts`, screen in `src/EquipmentScreen.tsx`):** items drop from kills (3% × enemy value^0.5), float as rarity-coloured crates with an edge arrow, and any of your ships picks them up (filling a free slot automatically; a "Found: …" message shows). Esc opens the pause/equipment screen (redesigned 2026-11-13 from the user's mockup): 30 slots in a ring of 10 groups (3 per tier, T1 top-right then clockwise, up to `items.maxSlotTier` 10) around the fleet-bonus totals, inventory grid below with rarity filter and sort (rarest first / last / bonus type). Drag (left button) into a slot to move or swap; drag onto the inventory to take off; right-click equips to the first free slot or takes off. Hover tooltips. Slots are stored by position (`state.slots`); a tier's slots unlock when you reach it (`unlockedTier`). Inventory unlimited. Seven fleet-wide stats: damage, fire rate, max health, speed, boost time, boost speed, skill recharge. Rarity uses the card odds; bonuses scale like card bonuses (Epic ≈ 3.2× Common). All fleet bonuses (cards + equipment) are combined in `state.bonus` by `updateBonuses`.
- **Plan:** Phase 1 (done): curves, XP, levels, cards, 5 skills at rank 1. Phase 2 (done): ranks 2–5 with rarity, Freeze, skill bar. Phase 3 (done): equipment (rare drops you fly over; 3 slots per tier reached, up to T10; unlimited inventory; Esc screen; fleet-wide stat bonuses with rarity ranges). Phase 4: balancing.
- **Rarity** (items and cards): Common white, Uncommon green, Rare gold (not blue: that's the team colour), Epic purple.
- Everything resets each run **except equipment** (since 2026-11-13): items, their slots and unlocked slot tiers are saved in the browser (`src/game/save.ts`, localStorage) after every change and survive restarts and reloads. Saves are tagged with the build number (`VITE_BUILD` = GitHub run number, set in `deploy.yml`; "dev" locally); a different build ignores them, so each publish starts everyone fresh. Only elites use skills.
- **Elites (2026-11-12; `CONFIG.elite`, `enabled` turns them all off):** one strong enemy every 5 waves from wave 10 (`firstWave`; the wave-5 one was too early) (waits one wave if that wave brings an enemy fleet). Tier = the biggest tier in that wave's enemy fleet plus 1 (`extraTiers`, since the version-10 tiers), 4× health, 3× XP. Random skills (1, then +1 per elite up to 3; ranks rise from the 4th elite), used by simple rules in `updateEliteSkills` (`skills.ts`), at 25% of your skill damage and 1.5× cooldowns. Its laser shows a 0.6 s dashed warning line first. Drops: wreck 40 / item 40 / both 20, items with better rarity odds (20/35/30/15). Its wreck is never more than 1 tier above your biggest ship (the user asked to limit skipping ahead). Freeze on your ships only stops shooting (they still move); on enemies it stops everything.

### First prototype scope
1. Fly a ship around empty space and shoot.
2. Enemy ships come in waves. Some leave wrecks you can fly into to recruit them.
3. Recruited ships follow in a simple formation and shoot automatically.
4. The camera zooms out a step when the fleet reaches a size threshold.
5. A small enemy fleet appears once the player's fleet is big enough.

Not in the first prototype: upgrades, ship types, menus, sound, story.
