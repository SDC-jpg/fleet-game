# Ship damage (plan agreed 2026-11-20; steps 1–4 built the same day)

Procedural damage on ships: marks that stick to the hull where hits land, debris, burns, smoke and
sparks. Hand-painted damaged states of big ships' base images may come later (not part of this).

## The user's choices (2026-11-20)
1. Both teams (your ships and enemies). Not the Leviathan (it has its own wounds and blood).
2. Missiles push ships; **a lighter push on the ship you fly**.
3. Marks come from real hits; a ship low on health with few marks gets extra ones, so it always
   looks as hurt as it is.
4. Simple placeholder textures the user repaints later (art-swap rules).
5. Hits on a Shield bubble (or while immune) leave no marks.

## How it works
- **Marks live in the ship's own pixels** (x forward, y right, from its anchor), so they turn,
  move and bank with it. A hit point is slid inward to the nearest solid pixel of the ship's image.
- **Hit strength** = damage ÷ the ship's max health: it sets the mark's size, debris chance and
  amount, and the missile push (÷ ship size).
- **A mark** = a small jagged blob generated per hit, clipped to the hull's pixels, coloured from a
  texture image (innards for gun hits, scorch for energy and missiles). Drawn over the hull as its
  own tiny image (not by repainting the ship, which would break the 3D tilt's picture cache);
  with the 3D tilt it follows the hull like the thrusters do.
- A cap per ship (more for big tiers); past it, new hits grow or replace old marks.
- **Repairs remove marks** in proportion to the health they give back.
- Not drawn for commander-view symbols or ships too small on screen (detail steps).

## Per damage type
- **Gun shots:** innards mark; debris cut from the ship's own image (its real colours), more and
  likelier for harder hits.
- **Energy:** a hot core cooling white → yellow → red → dark over 1–2 s, on a scorch mark.
  Beams follow into the hull to its first solid pixel (they stop at the hit circle today, often
  outside the hull); a tracking energy-gun beam leaves a cooling searing line; the Laser skill
  (piercing) scorches a line across the hull from entry to exit. Strong hits puff smoke for a while.
- **Missiles:** burn mark, debris, and a push (strength ÷ size; lighter on your flagship).
- **Low health:** below 50% sparks from the marks now and then; below 25% steady smoke. Ships
  with no marks get spots picked on the hull.

## ShipArt and testing
ShipArt **Damage** preview: health slider, hit buttons (gun / energy / missile / laser). A dev
test key that damages ships on screen. Placeholder art: innards and scorch textures, hot-core
flipbook, spark and smoke particles.

## Build order
1. Hull marks for gun shots: clipping, cap, repairs, ShipArt preview.
2. Energy: hot cores, scorch, beams into the hull, searing lines, Laser line, smoke.
3. Debris cut from the ship's image; missile burns and push.
4. Low health: sparks below 50%, smoke below 25%.
5. Performance caps (the user checks smoothness).
