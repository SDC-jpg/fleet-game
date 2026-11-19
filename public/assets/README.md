# Art guide

All game art lives in this folder. `manifest.json` lists each sprite by name
(like `vfx.explosion`) and says which file to use. The game code only uses the
names, never the file paths, so you can swap art without touching code.

## Art sheets: painting many placeholders at once

Every placeholder that isn't one of your ships goes on a few big PNG pages you can paint
over in Photoshop; Claude then puts what you changed back into the game. Each round, the
pages only show what's still a placeholder.

1. Ask Claude for an art sheet (or run `npm run art-sheet`). The pages appear in the
   `art-sheet` folder of the project:
   - `ui.png`, `projectiles.png`, `backgrounds.png`, `effects.png` (+ `-2`, `-3`...: VFX,
     thrusters and flames). Projectiles up to tier 6, the rest up to tier 4 for now
     (`--all-tiers` adds their tier 5–6 pages). Tier 7–8 versions of non-ship art never go on
     a sheet: the game never shows them (past tier 6 the detail steps use the tier-6 image).
   - Pages are laid out roughly square; flipbook frames sit in a compact grid.
   - If the current pages have painting that wasn't applied yet, new pages aren't made
     (so nothing is lost).
   - `ships-t1.png` … `ships-t8.png`: that tier's enemy ships (standard, energy, explosive),
     wreck and turret. Your own player ships aren't on them.
2. Each image sits in its own box at its exact size, with its name above it and a thin
   magenta outline just outside it. Flipbooks show every frame in a grid. Names in light
   blue with "(team)" contain team colour (keep those parts in strong sky blue).
3. Paint **inside the boxes** only. Don't resize the canvas or move anything; the size of
   each box is the size of the image in the game. The names, outlines and gaps are ignored,
   so stray strokes there don't matter.
4. Save over the same PNG (File → Export → Export As → PNG, transparency on, "Convert to
   sRGB" on, size 100%). You can edit just one page.
5. Tell Claude to apply the art sheet (`npm run art-sheet:apply` lists the changes;
   `-- --write` writes them). Only images you changed are replaced, and a "New art: …" line
   goes into CHANGELOG.md. An image swapped by hand in the meantime is left alone.

Which files are still placeholders is kept in `tools/placeholders.json` (the placeholder
tools add their files to it; `node tools/art-sheet.mjs scan` rebuilds it).

## Swapping in your own art

> **Edit art here, in `public/assets/`, never in `dist/`.** `dist/` is a
> temporary copy made by `npm run build`. The game doesn't read from it, and
> it's wiped and rebuilt every time.

1. Save your PNG (transparency is supported) somewhere in this folder.
2. Either overwrite the placeholder file with the same name, or point the
   manifest entry at your new file.
3. Refresh the browser. If a file can't be found, the game shows a warning in
   the top-left and draws a pink checkerboard in its place.

## Manifest options (all optional except the file)

| Option | Meaning | Default |
| --- | --- | --- |
| `file` | One image. Can be a single picture or a sprite sheet. | — |
| `files` | Instead of `file`: a list of separate images, one per frame, e.g. `["vfx/boom_01.png", "vfx/boom_02.png"]` | — |
| `frameWidth`, `frameHeight` | Size of one frame in a sprite sheet | the whole image |
| `frames` | Number of frames | as many as fit in the sheet |
| `fps` | Animation speed (frames per second) | 12 |
| `loop` | `true` to repeat forever, `false` to play once (effects) | `true` |
| `anchorX`, `anchorY` | The pixel that sits on the object's position (and that it rotates around) | the centre of the frame |

**Sprite sheets** are read left to right, then top to bottom, row by row.

**Any sprite can be animated.** For example, give a ship a 4-frame light
flicker by turning its single image into a sheet and adding `frameWidth`,
`frameHeight` and `fps`.

## Ships, objects and their effects (the ShipArt tool)

A ship's image stays the same whether it's idle, moving or boosting.
Thrusters, flames and particle emitters are **separate pieces placed on the
ship or object** with the ShipArt tool, so changing a ship's image never means
redrawing its flames.

**Open ShipArt:** run the game locally (`npm run dev`) and go to
http://localhost:5173/shipart.html. The published copy
(https://sdc-jpg.github.io/fleet-game/shipart.html) is view-only.

- **The rollout menu** (left) lists **Ships**, **Objects** and **Effects**. Each
  object has its own states:
  - **Missile:** Inert, Fired up, Impact, and Sequence (plays them all).
  - **Mine:** Armed, Blast. **Gun shot:** Flying, Hit.
  - **Laser:** Warning (an elite's aim line), Beam. Its mounts sit at the muzzle.
  - **Wreck:** Drifting (shown on its marker, in its own colours).
- **Parts live in `parts/`**, named `<category>-<anything>.png`, e.g.
  `thruster-move-1.png`, `flame-missile.png`. The first word is the
  category. New files appear in ShipArt by themselves (refresh the page); no
  manifest entry needed. A new first word (e.g. `turret-…`) makes a new category.
- **Mounts:** each piece placed on a ship or object is a mount, with an image for
  each state it shows in (unticked = hidden then), a position, angle, size,
  mirroring, and behind or on top. **+ Emitter** adds a mount with no image that
  only gives off particles (like the missile's smoke trail).
- **VFX point** (pink): where the mount's particles come from. It starts at the
  image's centre; drag it anywhere, or "Reset VFX point to centre".
- **Points** (yellow diamonds, objects only): where an object's effect appears:
  the missile's **Impact** burst, the mine's **Blast**, the gun shot's **Hit** spark.
  The states with the same names play the effect there, with the object faint.
- **Base image:** each state can also use a different main image.
- **Animated parts**, two ways (set Speed (FPS) and Loop in ShipArt's purple panel):
  - **A folder of frames:** a folder in `parts/` named like a part, one PNG per
    frame, e.g. `parts/thruster-boost-3/thruster-boost-3-001.png`, `-002.png`...
    It shows in ShipArt as `thruster-boost-3 (folder)`. Frames play in name
    order (numbers count properly, so 2 comes before 10) and must all be the
    same size. Add or remove frames, then refresh ShipArt.
  - **A sheet:** the frames side by side in one file; also set Frames.
- **Effects** (rollout section): every `vfx.*` image plays in the big preview
  over the stars, with buttons for its tier versions. The purple panel sets its
  Speed (FPS) and Loop, for all tiers or only the one shown; Save writes them
  into `manifest.json`.
- **Changing an effect's image** (purple panel, "Image source", per tier):
  - **Use another PNG**: pick any image in the art folder and say how many
    frames sit side by side in it.
  - **Import zip of PNG frames**: a zip of separate frames (e.g. exported from
    your animation app). They're used in name order (frame 2 before frame 10),
    must all be the same size, and are unpacked into their own folder, e.g.
    `vfx/explosion-t2/frame-01.png`… Importing again replaces that folder's frames.
  - Either change is kept when you **Save** (Undo can take it back first).
  Particle images (`particle.*` in the list) work the same way.
- **Particles** (purple **VFX** panel): per state, on or off, and the particle
  image, spawn rate, life, speed, drag and angle (the width of the spawn cone,
  0 = a straight line, 360 = every direction). Edit them for one mount, or as the
  **defaults for every mount of that category** (e.g. all thrusters). Any
  manifest sprite named `vfx.particle.<name>` can be picked as the particle image.
  "Copy folder path" copies the image's Windows folder for File Explorer.
- **Save** writes `art.json` in this folder; the game reads it. Draw parts
  facing **right** like the ships (a flame's nozzle end on the right).
- Dash doesn't change thrusters; it adds the dash trail (`vfx.dash`).
- **Hit shape** (ships only, the Hit shape section): green circles along the hull
  that shots, missiles and beams hit, so they respect the ship's general shape
  (shots pass between the wings). **Fit to art** places them from the image's
  solid pixels; drag a circle's centre to move it, or the gold square on the
  selected one's edge to resize it (or type x, y, r). **Fit all ships…** fits
  every ship image. When you change a ship's image (its outline, not just its
  colours), ShipArt asks "Autofit collision to the new art?" when you view it.
  Without circles a ship uses one round hit circle (dashed).
- **Guns** (ships only, the Guns section): where each gun sits (drag its orange
  ring), which way it points, its size (the tier of shot it fires), weapon type,
  fixed or **turret** (turns on its own, faster than the hull, within the dashed
  arc), and an optional image from `parts/gun-<anything>.png` (drawn facing
  right, centred on its pivot; placeholders `gun-turret-1`…`4`). Damage isn't set
  by hand: every ship of a tier shares the same damage per second between its guns
  by size, so four small turrets fire smaller, quicker shots than two big cannons.
  The panel shows the numbers. Weapon types: **ballistic** (normal shots),
  **energy** (a searing beam drawn with the laser art, `vfx.laser`, of the gun's
  size) and **explosive** (small missiles drawn with `projectile.missile`; set
  "Missiles per shot" per gun, default 1, and they share the shot's damage).
  A ship with no guns placed uses the standard ones
  (1 at tier 1, 2 side by side above); "Use standard guns" goes back to them.
- The old `fighter-*-move.png` and `fighter-*-boost.png` images are no longer
  used by the game, but they're still in `ships/` and can be picked as a
  base image in ShipArt.

## Enemy ships and team colours

**Ships are not recoloured.** Your ships (`ship.fighter`, `.t2`…) and enemy ships
(`ship.enemy`, `.t2`…, files `ships/enemy*.png`) each have their own images, drawn
exactly as painted. Repaint the enemy ones however you like (any colours).

- The first enemy images were made from your ships with their sky-blue parts
  turned red (`node tools/make-enemy-ships.mjs`; it never overwrites existing
  files unless run with `--force`).
- Enemy ships have their own layouts in ShipArt (Ships → Enemy), so their
  thrusters can sit somewhere else than on your ships.
- **Enemy variants** have their own images too: `ship.enemy-energy` (purple,
  fires beams) and `ship.enemy-explosive` (orange, fires missiles), each with
  `.t2`… versions and its own layouts and guns in ShipArt. Their standard guns
  fire their weapon type.
- Wrecks stay one grey image for both sides.
- A **hijacked** ship keeps its old side's art and gets a small heart above it
  (`ui.hijack-heart`) in the colour of the side it now fights for.

**Shots, lasers, shields and other effects are still shared** by both sides and
recoloured when the game starts:

- Paint their team-colour parts in a **strong sky blue**: hues from 180° to
  230° on the colour wheel, at least 40% saturation. Faintly blue-tinted greys
  are left alone.
- Keep every other colour **outside** that range. Those stay exactly as painted
  on both sides.
- Shading works. Only the hue turns, so light and dark blues become light
  and dark reds.
- The hue range and how far each team turns it are in `teamColors` in
  `src/game/config.ts`. For example, `enemy: 170` turns sky blue (200°) into
  red (10°).

## Dash trail, wreck marker and stamina ring

- **`ui.command-ring`** circles the ship you fly and doubles as the **boost
  stamina meter**. It's a flipbook whose frames are fill levels: the **first
  frame is empty, the last is full**, and the game shows the frame matching the
  stamina left (it doesn't play as an animation). Use as many frames as you
  like (the placeholder has 33). It's drawn faded while boost is locked after
  running dry. Not team-recoloured.

- **`vfx.dash`** plays once behind every ship in your fleet when you dash
  (Space), pointing back along its movement. Draw it **facing right with
  the ship at the right edge**: the trail streams off to the left. `anchorX` in
  the manifest is the frame width, which puts the ship at that edge. It lasts
  0.5 s, so 6 frames at 12 fps fits. Sky blue parts get team colours.
- **`ui.wreck-marker`** is drawn under every wreck and loops. It's never shrunk
  when the camera zooms out, so wrecks stay easy to spot against the stars.

## Skills and level-up cards

| Name | What it is |
| --- | --- |
| `ui.skill.laser`, `.missiles`, `.mines`, `.shield`, `.repulse` | Skill icons (cards and HUD; placeholders 16 px) |
| `ui.card.damage`, `ui.card.fire-rate`, `ui.card.repair` | Icons for the fleet bonus cards |
| `vfx.laser` (+ tiers) | One short **segment** of the laser beam, repeated along its length. Faces right; plays once (the beam narrows away). Sky blue = team colour. Also the energy guns' beams (they stay on 0.8 s and hold the last frame; set it to loop in ShipArt → Effects to keep it moving) |
| `vfx.laser-impact` (+ `.t2`…`.t4`) | Where an energy gun's beam burns something: a **looping** searing spot, turned so the image's right side faces back up the beam toward the shooter (sparks spray that way). Sky blue = team colour |
| `projectile.missile` (+ tiers) | Homing missile, faces right, team-coloured. No flame painted on: the flame is separate |
| `vfx.missile-hit` (+ tiers) | Small round burst when a missile hits, plays once |
| `projectile.mine` (+ tiers) | Mine, loops (blinking light), team-coloured |
| `vfx.mine-blast` (+ tiers) | Mine explosion, plays once, sized for the blast reach (112 px at tier 1) |
| `vfx.shield` (+ tiers) | Bubble over a shielded ship, loops |
| `vfx.repulse` (+ tiers) | Shockwave ring, plays once, sized for its reach (304 px at tier 1) |
| `ui.skill.freeze` | Freeze skill icon |
| `vfx.freeze` (+ tiers) | Freeze cone, plays once. Faces right with the ship at the **left middle** (`anchorX` 2): 220 px long, ±30° at tier 1 |
| `vfx.frozen` (+ tiers) | Icy shell over a frozen ship, loops |

Effects grown by "size" upgrades (Repulse, mine blasts, Freeze, the laser's
width) are drawn enlarged, so they look a little blockier; that's expected.

Sounds: `sfx.laser`, `sfx.laser-sear` (looping hiss while energy beams burn something on screen; louder with more), `sfx.missile` (launch "thump"), `sfx.missile-ignite` (fire-up), `sfx.missile-hit`, `sfx.mine` (dropped), `sfx.mine-blast`,
`sfx.shield`, `sfx.repulse`, `sfx.freeze`, `sfx.levelup`, `sfx.card` (card picked).

### Newer skills

Each newer skill has an icon `ui.skill.<name>` (16 px placeholders): `gatling`,
`crescent`, `arc-impulse`, `ion-cloud`, `plasma-lance`, `split-beam`, `laser-pods`,
`gravity-well`, `scramble`, `wrecksplosion`, `tractor-beam`, `force-wall`, `cloak`,
`hijack`. Their art is made for a tier-1 ship; the game scales it up for bigger
ships and size upgrades (no `.t2`… versions needed). Sky blue = team colour
(red for elites), except the golden crescent.

| Name | What it is |
| --- | --- |
| `projectile.gatling` | Gatling Laser bolt, faces right |
| `vfx.crescent` | Crescent Strike blade (40 px = its hit size); the game spins it |
| `vfx.arc`, `vfx.arc-hit` | Arc Impulse: one **segment** of the arc (repeated between two ships, plays once), and the spark where it strikes |
| `vfx.ion-ball`, `vfx.ion-pop` | Ion Cloud: a ball (loops), and its burst (72 px = its blast size, plays once) |
| `vfx.plasma-lance`, `vfx.plasma-hit` | Plasma Lance: one **segment** of the blade (repeated along it, loops), and the flash where it cuts |
| `vfx.split-beam`, `vfx.split-burst` | Splitting Beam: one segment of its streak, and the flash where it splits |
| `vfx.pod`, `projectile.pod-shot` | Laser Pods: a pod (faces right, loops) and its laser shot |
| `vfx.gravity-well` | Gravity Well swirl, loops; 256 px = a 128 px radius (scaled to the well's radius) |
| `vfx.scramble-wave`, `vfx.scrambled` | Scramble: the wave (a tall band facing right, loops), and the marker over a scrambled ship |
| `vfx.wreck-blast`, `vfx.wreck-radius` | Wrecksplosion: a wreck's blast (184 px = its blast size, plays once), and the ring showing its reach around the cursor (also an elite's scrap-charge warning) |
| `vfx.tractor-beam` | Tractor Beam: one segment of the beam (repeated, loops). The thrown wreck uses the wreck art |
| `vfx.force-wall`, `vfx.force-wall-hit` | Force Wall: one segment of the wall (repeated along it, loops), and the ripple where a shot is stopped |
| `vfx.cloak` | Sparkle ring when a fleet cloaks (also when a ship is hijacked). Cloaked ships themselves are drawn by the game (see-through) |
| `vfx.hijack-pulse` | Hijack ring (256 px = a 128 px radius, grown as it spreads) |

Sounds: `sfx.gatling` (each bolt), `sfx.crescent`, `sfx.arc`, `sfx.ion-cloud`, `sfx.ion-pop`, `sfx.plasma-lance`, `sfx.split-beam`,
`sfx.pods`, `sfx.pod-shot`, `sfx.gravity-well`, `sfx.scramble`, `sfx.wrecksplosion`, `sfx.tractor-beam`, `sfx.force-wall`,
`sfx.force-wall-hit`, `sfx.cloak`, `sfx.hijack`.

### Skills added 2026-11-15

Icons `ui.skill.<name>`: `pdc`, `cannibalize`, `time-dilation`, `force-dash`, `crisis-jump`, `tech-scanner`, `radar`.

| Name | What it is |
| --- | --- |
| `pdc.cannon` | Point Defense Cannon turret (8×6, faces right, sky blue = team colour). Two sit on the flagship and turn toward missiles; scaled with the ship |
| `projectile.pdc` | Its tiny shot (2×2) |
| `vfx.time-dilation` | Time Dilation ring of clock ticks, plays once (the blue edge tint while it lasts is drawn by the page, `.time-dilation-tint`) |
| `vfx.cannibalize` | Where a ship is taken apart, and on the repaired flagship (**uses the recruit art for now**: point it at your own file) |
| `vfx.warp-out`, `vfx.warp-in` (+ `.t2`–`.t4`) | Crisis Jump: where each ship leaves (a ring collapsing, streaks stretching forward) and arrives (streaks rushing in, a flash, a ring bursting out). Drawn facing the jump direction (right = forward), play once |

The Long-Range Radar minimap is drawn by the game (1 px frame, coloured dots; colours in `CONFIG.radar.colors`).

Sounds: `sfx.pdc` (a quiet tick for some of the shots), `sfx.time-dilation`, `sfx.cannibalize` (**the recruit sound for now**),
`sfx.warp` (**the dash sound for now**).

## Equipment

| Name | What it is |
| --- | --- |
| `ui.item.damage`, `.fire-rate`, `.health`, `.speed`, `.stamina`, `.boost-speed`, `.skill-rate` | Item icons (16 px placeholders), one per bonus type |
| `ui.loot.common`, `.uncommon`, `.superior`, `.rare`, `.epic`, `.legendary`, `.mythic` | A dropped item floating in space, one per rarity (white, green, blue, purple, yellow, red, holographic), loops. Never shrunk |
| `ui.loot.merge-module` | The Merge Module floating in space (a one-time drop), loops |
| `ui.loot.merge-module-2`, `-3`, `-4` | Its upgrades Merge Mk. II, III and IV (ring in Uncommon green, Superior blue, Rare purple), same layout |
| `vfx.shimmer` | Sparkles around special drops like the Merge Module, played once each |
| `ui.cursor` | The game's own cursor, shown while "Keep the mouse inside the game" (Settings) is on |
| `ui.dot.loot.<rarity>` (`common` … `mythic`, `merge-module`) | Dot at the screen edge toward an off-screen dropped item, in its rarity's colour (7×7; Mythic is a looping flipbook). Doesn't turn. Sits further in than the arrows (`CONFIG.edgeMarkers`) |
| `ui.arrow.loot` | No longer used (loot uses the dots above) |

Sound: `sfx.loot` (item picked up).

## Elite enemies

| Name | What it is |
| --- | --- |
| `ui.elite-marker` (+ `.t2`…`.t4`) | Ring drawn under an elite enemy, loops. One size per tier |
| `ui.arrow.elite` | Edge arrow pointing to an elite (bigger than the enemy arrow) |
| `vfx.laser-warning` (+ `.t2`…`.t4`) | Warning line before an elite's laser fires: one short segment repeated along the beam, loops. Same height as `vfx.laser` of its tier. Sky blue parts take the team colour |

Elites use the normal ship art and the normal skill art and sounds.

Rank-up cards are coloured by rarity: Common white, Uncommon green, Rare gold,
Epic purple (`RARITIES` in `src/game/config.ts`).

## Leviathan (boss)

The Leviathan is a head plus a chain of body pieces in `bosses/leviathan/`, all drawn
**facing up** (the game turns them): `head.png` (top view, while flying straight),
`head-side.png` (side view, while turning; drawn for right turns and mirrored for left
turns, `CONFIG.leviathan.sideViewForRightTurns`), `segment.png` (repeated),
`segment-antepenultimate.png`, `segment-penultimate.png` and `tail.png`. The head is drawn
under everything and each piece toward the tail on top of the one before. Each piece
turns around its pivot (`anchorX`/`anchorY` in the manifest; the image's centre if not
set): both heads pivot on their round neck, so they line up when they swap, and the tail
pivots near its top. Set it all up in **ShipArt → Bosses → Leviathan**: it swims a figure
eight (or **Lay straight** holds it still); pick a piece to drag its image around its pivot
(saved as its anchor in the manifest) and size its hit circle; the panel has the number of
repeating segments, the gaps between pieces (saved in `art.json`) and which way the side
head is drawn. **Bulges** make one piece bigger or smaller, fading over its neighbours
(falloff) along a curve.
**Fins** (`fin.png`, or any image in `bosses/` with "fin" in its name, any size, pointing
right from its root) sit on a piece, in front of or behind it, and bend as the creature swims;
add, move, turn, size, mirror and swap them in the Fins section, and click the fin image there
to set where it attaches.
**Gradients** colour the body from head to tail, like a Photoshop gradient overlay: colour stops
on a bar (click to add, drag to move, drag down off the bar to remove; each with its own colour,
opacity and location), a blend mode (Multiply, Screen, Color Dodge, Linear Dodge (Add), Soft
Light, Hard Light, Hue, Color) and an opacity. 0% is the tip of the head and 100% the end of the
tail; **Starts at / Ends at** can move the gradient's ends past either. Several stack, top first,
each mixing into the result of the ones above. Fins take the colour where they attach.
The panel's sections (Body, Bulges, Fins, Gradients, Pieces) fold away by their titles.

## Tiers (bigger ships)

16 ships of one tier merge into one ship of the next tier. Each tier has its
own art, named by adding `.t2`, `.t3`, `.t4` to the tier-1 name:

| Art | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
| --- | --- | --- | --- | --- |
| Ship (+ `.move`, `.boost`, `.wreck`) | `ship.fighter` | `ship.fighter.t2` | `ship.fighter.t3` | `ship.fighter.t4` |
| Shot | `projectile` | `projectile.t2` | `projectile.t3` | `projectile.t4` |
| Explosion, hit spark, recruit ring | `vfx.explosion` etc. | `vfx.explosion.t2` etc. | … | … |
| Flagship explosion (the ship you fly is destroyed: bigger, longer, with a shockwave ring) | `vfx.flagship-explosion` | `vfx.flagship-explosion.t2` etc. | … | … |
| Flagship debris: each frame is a **different piece** (not an animation); the game picks one per piece, spins it and fades it out. Sky blue = team colour | `vfx.debris` | (scaled with the ship) | … | … |
| Merge flash (sized for the new ship) | — | `vfx.merge` | `vfx.merge.t3` | `vfx.merge.t4` |
| Command ring | `ui.command-ring` | `ui.command-ring.t2` | … | … |
| Wreck marker | `ui.wreck-marker` | `ui.wreck-marker.t2` | … | … |
| Dash trail | `vfx.dash` | `vfx.dash.t2` | … | … |

- Suggested canvas sizes (each tier is 1.5× the last): ships 64 → 96 → 144 →
  216 px. The game doesn't care about the exact size: hit sizes are in
  `src/game/config.ts`.
- Any tier can be missing: the game uses the closest smaller tier's art, drawn 1.5× bigger per missing tier so it still fits the ship (art with no tier versions at all keeps its size). Tiers 5–8 have generated placeholders; very large sheets (Repulse, Freeze, big explosions...) were left out on purpose and use this scaling instead.
- Enemy ships have their own tier versions (`ship.enemy.t2`…). Shots and
  effects are recoloured per team like tier 1, so paint their team-colour parts
  in strong sky blue.
- Tier 3 and up are seen zoomed out below 1×, where the art is shrunk and
  looks a little softer.

## Detail steps (very big fleets) and small versions

The camera never zooms out below 1×. Once your biggest ship is past tier 6, the game
draws everything one tier smaller per tier beyond (tier 7 → one step, tier 8 → two...),
still at 1 screen pixel per art pixel:

- **Ships and wrecks** use automatic small copies of their own image (only its own
  colours, no blur). Thin lines can vanish, so you can draw your own: add a manifest
  sprite named `<ship>.d<steps>`, e.g. `"ship.fighter.t7.d1": { "file": "ships/fighter-t7-d1.png" }`
  for the tier-7 ship one step smaller (drawn at tier-6 size, so about 2/3 of its
  width). Preview it in ShipArt with **Detail −1/−2/−3**.
- **Effects, shots, rings and markers** use the art of the tier below automatically.
- Ships that would be smaller than a tier-1 ship become commander-view symbols (below).

## Commander view (HUD symbols)

Once you fly a tier-4 ship, only your top three ship sizes are drawn as ships; smaller
ships become symbols (docs/COMMANDER-VIEW.md). All of it is art you can replace:

| Name | What it is |
|---|---|
| `ui.hud.<side>.t1` … `t8` | The symbol for a ship of that tier. `<side>`: `player`, `enemy`, `enemy-energy`, `enemy-explosive`. Drawn in its own colours (not recoloured), fixed size on screen, centred; paint any glow into the image. A missing tier uses the closest smaller one. Placeholders: dot, hollow square, diamond with a dot, ring, diamond with a square, triangle, double diamond, square with a diamond |
| `ui.hud.wreck` | A wreck of a symbol tier (grey dot) |
| `projectile.hud` | Shots and missiles of symbol ships (one image for all tiers; sky blue = team colour). It's an object in ShipArt (Objects → HUD shot), so it can have particle emitters |

The targeting lines, symbol beams, star dimming and blue/red shifts are colours in
`CONFIG.commander` and `CONFIG.timeDilation` (tuning page).

## Screen effect (old CRT screen)

The game can be shown through an old tube-screen effect (glow, colour fringes, curved glass,
colour stripes; Settings → Screen effect). Its stripes come from one image:

| Name | What it is |
|---|---|
| `ui.crt-mask` | One repeat of the screen's colour stripes, left to right (placeholder: 3×1 pixels, red, green, blue). It's tiled across the whole screen, each pixel as wide as the "Stripe size" setting. Any width works (e.g. add dark gap columns, or soften the colours); a 1-pixel-tall image gives vertical stripes. The effect makes up for how much darker it makes the picture. |

## Sounds

Sound effects live in `sfx/` and are listed in the `"sounds"` section of
`manifest.json`, the same way as art. To replace one, overwrite its file
(`.wav`, `.ogg` and `.mp3` all work; if you change the format, update the
file name in the manifest).

| Name | File | When it plays |
| --- | --- | --- |
| `sfx.shoot` | `shoot.wav` | your ships fire (wingmen quieter than your own ship) |
| `sfx.shoot.enemy` | `shoot-enemy.wav` | enemies fire |
| `sfx.hit` | `hit.wav` | a shot hits a ship |
| `sfx.explosion` (+ `.t2`–`.t4`) | `explosion.wav`, `explosion-t2.wav`… | a ship is destroyed |
| `sfx.flagship-explosion` (+ `.t2`–`.t4`) | `flagship-explosion.wav`, `flagship-explosion-t2.wav`… | the ship you fly is destroyed |
| `sfx.recruit` | `recruit.wav` | you pick up a wreck |
| `sfx.merge` | `merge.wav` | 16 ships start merging (charge-up, then flash ~0.5 s in) |
| `sfx.boost` | `boost.wav` | you start boosting |
| `sfx.engine-move` | `engine-move.wav` | **loop** while the ship you fly moves (a faint hum). Must loop seamlessly; the game fades it in and out and plays it deeper for bigger tiers |
| `sfx.engine-boost` | `engine-boost.wav` | **loop** while you boost, playing instead of the hum (for now a copy of the hum, a little louder). Same rules |
| `sfx.dash` | `dash.wav` | you dash (Space) |
| `sfx.alert` | `alert.wav` | an enemy fleet arrives |
| `sfx.command` | `command.wav` | your flagship dies and command passes on |
| `sfx.gameover` | `gameover.wav` | your whole fleet is destroyed |

| Option | Meaning | Default |
| --- | --- | --- |
| `volume` | Loudness of this sound, 0–1 | 1 |
| `pitchVariation` | Random pitch change per play (0.05 = ±5%), so repeats sound less robotic | 0.05 |
| `maxVoices` | How many copies can play at once (stops 15 ships firing from becoming noise) | 4 |
| `minGap` | Shortest time between two starts, in seconds | 0.03 |
| `pitchPerTier` | When a bigger tier has no file of its own, play this sound at this pitch per tier up (above 1 = brighter, below 1 = deeper) | 0.85 (from `config.ts`) |

- **Tiers:** any sound can have `.t2`, `.t3`, `.t4` versions for bigger ships
  (e.g. `sfx.shoot.t3`). If one is missing, the smaller tier's sound plays at
  a lower pitch, or a higher one if the sound has `pitchPerTier` above 1 (the
  recruit sound does: bigger wrecks sound brighter).
- Sounds are louder near the middle of the screen, fade off-screen, and pan
  left/right. Overall volume and wingman volume are in `audio` in
  `src/game/config.ts`.
- **M** or the speaker button turns sound on/off (remembered by the browser).
- `npm run make-sfx` recreates any missing placeholder sounds, and never
  overwrites existing files unless you add `-- --force`.

## Conventions

- **Ships face right** in the image. The game rotates them.
- **Pixel size:** 1 pixel in your image = 1 game pixel. The game zooms in
  whole steps (4×, 3×, 2×, 1×), so pixels stay crisp.
- **Size doesn't affect gameplay.** Hit areas are set separately in
  `src/game/config.ts`, so bigger or smaller art is fine.
- **Backgrounds** (`bg.*`) tile seamlessly in every direction.

## Placeholder art

`npm run make-art` recreates any missing placeholder files. It never overwrites
existing files unless you add `-- --force`, which replaces **all** of them.
