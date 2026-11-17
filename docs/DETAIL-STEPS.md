# Detail steps for very big fleets

Status: **built 2026-11-16** (after [SHIP-GUNS-AND-VARIANTS.md](SHIP-GUNS-AND-VARIANTS.md)).
How it was built is under "As built" at the end.

## The problem

The camera stops zooming out at 1× (from T3 on), and it must never go below 1×:
below 1× the visible pixel look is lost. But ships keep growing 1.5× per tier, so
from about T7 the biggest ship outgrows the screen (a T10 ship nearly fills it).

## The idea: draw everything one tier smaller per step, with crisp art

A **detail step** works like zooming out, but instead of shrinking images it swaps
in smaller, lower-resolution versions of them, still drawn at 1 screen pixel per art
pixel. Nothing is blurred.

- **When it starts:** nothing is ever drawn bigger than a T6 ship. When your biggest
  ship reaches T7, one detail step applies; T8 gives two, and so on
  (steps = biggest tier − 6, never below 0).
- **Everything steps down, the top ship included:** with one step, a T7 looks the size
  of a T6, a T4 the size of a T3, and so on. The top ship stays the biggest and most
  detailed thing on screen, and the view keeps widening as fights grow.
- **Drawing only:** hit sizes, ranges, speeds and distances are unchanged. The whole
  world is drawn smaller together (like a zoom), so what you see still matches what hits.
- **Smallest ships become icons:** a ship that would be drawn smaller than a T1 ship
  becomes a **small diamond** (a square turned 45°): blue for you, red for enemies,
  purple/orange for enemy variants (see "Settled while building").

## Where the smaller versions come from

- **Ships:** each ship design gets smaller versions of itself (e.g. the T4 design at T3
  size, T2 size...). **For now they're made automatically** by shrinking the full-size
  art. They'll look a bit rough: thin lines can vanish. **Later the user draws them by
  hand** and replaces the automatic ones one by one (hand-drawn small pixel art reads
  much better than shrunk art).
- **Effects** (explosions, shots, shields, rings, markers...): use the art of the tier
  below, which already exists.
- **Mounts** (thrusters, flames) and particle emitters: positions shrink with the ship;
  their images need smaller versions too (automatic first, like ships).

## Build order

1. Ships and wrecks: the detail step, automatic smaller versions, the camera widening.
2. Effects, shots, mounts and particles.
3. Icons (blue diamonds) for ships below T1 size.
4. Hand-drawn small versions: a way to add and preview them (likely in ShipArt).

## Settled while building

- **Automatic shrinking keeps only the art's own colours:** each pixel of the small copy
  takes the colour covering most of its square (ties go to the darker one, so outlines
  tend to survive); see-through only if most of it is.
- **Hand-drawn small versions** are manifest sprites named `<ship>.d<steps>`, e.g.
  `ship.fighter.t7.d1` = the tier-7 design one step smaller (tier-6 size). When one
  exists the game uses it instead of the automatic copy.
- **Icons:** replaced on 2026-11-16 by the commander view's tier symbols
  (`ui.hud.<side>.t<tier>`, see COMMANDER-VIEW.md).

## As built

- `CONFIG.detail.fullSizeUpTo` 6; `detailSteps(state)` = biggest tier this run − 6;
  `detailFactor` = 1.5^−steps. Game.ts gives it to the renderer (`setDetail`) and to
  render.ts (`setDetailSteps`). The zoom itself stays at 1×.
- The renderer draws the world `detail` times smaller inside its buffer. Art drawn at a
  tier size step of that scale uses crisp copies (`src/engine/shrink.ts`, cached);
  anything else (freely growing effects) is smoothed as before. Copies are only used once
  the change has settled (smoothed during the short transition). RotSprite falls back to
  Grid while shrunk.
- `tierArt(..., detail = true)` picks the art of `steps` tiers lower for effects, shots,
  markers, rings...; ships and wrecks pass `false` and use shrunk copies of their own design.
- Ships smaller than tier 1 after the steps are drawn as icons (no thruster particles).
- ShipArt: "Detail Full / −1 / −2 / −3" previews a ship as the game draws it, and says
  whether it's the automatic copy or a hand-drawn one.
