# Plan: separate enemy ships, gun mounts and weapon variants (not built yet)

Status: **agreed in principle 2026-11-16, under discussion.** The user wants to
discuss it more before anything is built. Related: [DETAIL-STEPS.md](DETAIL-STEPS.md)
(to be built after this one).

## Goals

- More variety in enemies, with art and colours chosen by hand, not recoloured by code.
- Guns placed by hand in ShipArt (number, position, type), on enemy **and** player ships,
  independent from skills: a ship's guns are its base weapon.
- Every ship of a tier stays about as dangerous as the others, whatever its guns:
  balancing is automatic.

## Decisions so far

1. A recruited enemy wreck becomes **your own standard ship of that tier**.
2. A hijacked ship keeps its enemy art while fighting for you, with a **marker**
   (outline or icon) showing which side it's on.
3. Your own ships **can have weapon types too**, but everything stays **ballistic for now**.
4. Shots, lasers, shields and other effects **keep their team recolouring** for now (they
   may later be coloured by weapon type instead). Only ships stop being recoloured.

## Stages (each one playable before the next)

### 1. Separate enemy ships (art only)

- Every player ship gets an enemy copy: `ship.enemy.t1` … `t8`, made from today's art
  already turned red, keeping that tier's mounts (thrusters...) from `art.json`.
- Ships are no longer recoloured per team: each copy uses its own colours. ShipArt lists
  player and enemy ships separately.
- Wrecks keep one grey version.
- Adding the enemy layouts edits `art.json` (the user's ShipArt file): do it when the
  user has no unsaved ShipArt changes.

### 2. Gun mounts in ShipArt (all ships)

- A new mount category, **Gun**, with: position, facing, gun size (which tier's shot it
  fires), weapon type, fixed or turret, turret turn speed and firing arc.
- The default gun layout reproduces today's guns (1 gun at T1, a double cannon from T2),
  so nothing changes until a layout is edited.
- **Turrets** turn on their own, faster than the hull. On the ship you fly they track the
  cursor within their arc; on wingmen and enemies they track the nearest target. Example:
  a T4 with four small T3 turrets swivelling while the hull turns slowly.
- Guns are separate from skills. Their kills count as "gun" in the statistics, split by
  weapon type.

### 3. Automatic balancing

- Each tier has a damage-per-second budget (today's numbers).
- The budget is shared out between a ship's guns by their size: more guns means less
  damage per shot. A T4 with four T3 guns does the same total damage as with two T4
  cannons, in smaller, more frequent shots.
- Each weapon type has its own fire rate (a stronger weapon fires slower) and an
  **efficiency number** in config, because equal raw damage isn't equal danger: lasers
  hit everything in a line, missiles rarely miss, bullets miss a lot. Example: energy
  damage × 0.6. Tuned by playing.

### 4. Weapon types

- **Ballistic:** today's shots.
- **Energy:** a short beam that hurts every ship in a line.
- **Explosive:** small missiles (one or several).
- Energy and explosive reuse the Laser and Missiles skill code with their own numbers
  (in config). Their art can be swapped like everything else.

### 5. Enemy variants

- Each tier gets a ballistic, an energy and an explosive enemy design, each with its own
  art and gun layout.
- A config table sets which waves bring which mix of variants (and what elites use).
- Missile-firing enemies make PDC, Force Wall and Repulse more useful; watch performance
  with hundreds of missile-firing enemies.

## How it affects the detail-steps plan

- **Build this plan first:** detail steps make smaller versions of every ship design, so
  the designs and gun mounts should be settled before that.
- **More art to shrink:** player + 3 enemy variants × 8 tiers, each with smaller
  versions. This is why small versions are automatic first, hand-drawn only where it matters.
- **Gun mounts shrink with their ship,** like thrusters. At the smallest sizes, separate
  turrets aren't worth drawing: bake them into the automatic small ship image.
- **Icons:** without recolouring, the blue diamond needs a red enemy version. Icons could
  also differ by variant (e.g. a shade or a dot) so a distant swarm's threat is readable.
- **Balance is unaffected:** detail steps only change drawing.
- **Less memory:** ships no longer need a recoloured copy per team.

## Open questions

- The marker for hijacked ships: outline, small icon, or something else.
- Variant mix per wave, and when energy and explosive enemies first appear.
- Turret arcs and turn speeds as defaults per gun size, or set per mount.
- Starting efficiency numbers for energy and explosive.
