# Art guide

All game art lives in this folder. `manifest.json` lists each sprite by name
(like `vfx.explosion`) and says which file to use. The game code only uses the
names, never the file paths, so you can swap art without touching code.

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

**Any sprite can be animated.** For example, give a ship a 4-frame engine
flicker by turning its single image into a sheet and adding `frameWidth`,
`frameHeight` and `fps`.

## Engine states for ships

A ship can have extra images for when its engine is running. Add manifest
entries named after the ship's sprite plus `.move` or `.boost`:

```json
"ship.fighter":       { "file": "ships/fighter.png" },
"ship.fighter.move":  { "file": "ships/fighter-move.png" },
"ship.fighter.boost": { "file": "ships/fighter-boost.png" }
```

- `.move` shows while the ship is flying, and `.boost` while boosting (Shift).
- Any of them can be missing. Boost falls back to move, and move falls back to
  the normal image.
- Each one can be a flipbook too (e.g. a flickering flame).

## Team colours (one image set for both sides)

You paint each ship **once**. Your ships and enemy ships use the same images.
The game recolours the "team colour" parts for each side when it starts.

- Paint team-colour parts (stripes, accents, lights) in a **strong sky
  blue**: hues from 180° to 230° on the colour wheel, at least 40% saturation.
  Faintly blue-tinted greys (like a cool metal hull) are left alone.
- Keep every other colour **outside** that range: grey hull, orange flames,
  purple boost glow and so on. Those stay exactly as painted on both sides.
- Shading works. Only the hue turns, so light and dark blues become light
  and dark reds.
- The hue range and how far each team turns it are in `teamColors` in
  `src/game/config.ts`. For example, `enemy: 170` turns sky blue (200°) into
  red (10°), and `enemy: 100` would turn it into purple-pink.

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
| `vfx.laser` (+ tiers) | One short **segment** of the laser beam, repeated along its length. Faces right; plays once (the beam narrows away). Sky blue = team colour |
| `projectile.missile` (+ tiers) | Homing missile, faces right, team-coloured |
| `projectile.mine` (+ tiers) | Mine, loops (blinking light), team-coloured |
| `vfx.mine-blast` (+ tiers) | Mine explosion, plays once, sized for the blast reach (112 px at tier 1) |
| `vfx.shield` (+ tiers) | Bubble over a shielded ship, loops |
| `vfx.repulse` (+ tiers) | Shockwave ring, plays once, sized for its reach (304 px at tier 1) |

Sounds: `sfx.laser`, `sfx.missile`, `sfx.mine` (dropped), `sfx.mine-blast`,
`sfx.shield`, `sfx.repulse`, `sfx.levelup`, `sfx.card` (card picked).

## Tiers (bigger ships)

16 ships of one tier merge into one ship of the next tier. Each tier has its
own art, named by adding `.t2`, `.t3`, `.t4` to the tier-1 name:

| Art | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
| --- | --- | --- | --- | --- |
| Ship (+ `.move`, `.boost`, `.wreck`) | `ship.fighter` | `ship.fighter.t2` | `ship.fighter.t3` | `ship.fighter.t4` |
| Shot | `projectile` | `projectile.t2` | `projectile.t3` | `projectile.t4` |
| Explosion, hit spark, recruit ring | `vfx.explosion` etc. | `vfx.explosion.t2` etc. | … | … |
| Merge flash (sized for the new ship) | — | `vfx.merge` | `vfx.merge.t3` | `vfx.merge.t4` |
| Command ring | `ui.command-ring` | `ui.command-ring.t2` | … | … |
| Wreck marker | `ui.wreck-marker` | `ui.wreck-marker.t2` | … | … |
| Dash trail | `vfx.dash` | `vfx.dash.t2` | … | … |

- Suggested canvas sizes (each tier is 1.5× the last): ships 64 → 96 → 144 →
  216 px. The game doesn't care about the exact size: hit sizes are in
  `src/game/config.ts`.
- Any tier can be missing: the game uses the closest smaller tier's art.
- Ships and shots are recoloured per team like tier 1, so paint team-colour
  parts in strong sky blue.
- Tier 3 and up are seen zoomed out below 1×, where the art is shrunk and
  looks a little softer.

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
| `sfx.recruit` | `recruit.wav` | you pick up a wreck |
| `sfx.merge` | `merge.wav` | 16 ships start merging (charge-up, then flash ~0.5 s in) |
| `sfx.boost` | `boost.wav` | you start boosting |
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
