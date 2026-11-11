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
