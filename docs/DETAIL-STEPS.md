# Plan: detail steps for very big fleets (not built yet)

Status: **agreed in principle 2026-11-16, on hold.** The user wants to discuss other
changes that may affect it before anything is built. To be built after
[SHIP-GUNS-AND-VARIANTS.md](SHIP-GUNS-AND-VARIANTS.md) (separate enemy ships, gun mounts,
weapon variants), which changes the set of ship art this plan shrinks.

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
  becomes a **small blue diamond** (a square turned 45°), recoloured per team like all
  art (blue for you, red for enemies).

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

## Build order (when it's picked up)

1. Ships and wrecks: the detail step, automatic smaller versions, the camera widening.
2. Effects, shots, mounts and particles.
3. Icons (blue diamonds) for ships below T1 size.
4. Hand-drawn small versions: a way to add and preview them (likely in ShipArt).

## Open questions (to settle before building)

- How the automatic shrinking picks colours (keep only the art's own colours, like
  RotSprite does, so it stays pixel art).
- Naming of hand-drawn small versions in the manifest/art files.
- Icons without team recolouring: a red version for enemies, maybe different per enemy
  variant (see SHIP-GUNS-AND-VARIANTS.md).
