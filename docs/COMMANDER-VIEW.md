# Commander view (big fleets as a HUD)

Status: **built 2026-11-16** from the teammate's mockup and the user's answers. Numbers
and art are first versions, to be tuned by playing.

## The idea

With big fleets the screen gets chaotic. Like a fleet commander's HUD, only the top three
tiers are drawn as ships; everything smaller becomes a symbol, so the eye goes to the big
ships and their weapons. Drawing only: nothing about play changes.

## Rules

- **When:** your biggest ship *right now* is tier 4 or more (`CONFIG.commander.fromTier`). It
  switches off again if you lose your big ships.
- **What stays a ship:** your biggest tier and the two below it (`realTiers` 3). Smaller ships,
  on both sides, measured against *your* biggest ship, become symbols. Elites always stay ships.
- **Symbols by tier** (`ui.hud.<side>.t<tier>`, side = player, enemy, enemy-energy,
  enemy-explosive): T1 dot, T2 hollow square, T3 diamond with a dot, T4 ring with a dot, T5
  diamond with a square, T6 triangle, T7 double diamond, T8 square with a diamond. Fixed
  size on screen, soft glow, in the side's colour (no recolouring). They replace the
  detail-step icons: ships that would be smaller than a tier-1 ship after the detail steps
  are symbols too.
- **Weapons of symbol ships:**
  - Targeting lines: a faint line from each symbol toward what it's aiming at, fading out
    toward the target, so it doesn't look like a sure hit. Settings → "Commander view:
    targeting lines" turns them off.
  - Shots (and missiles) are drawn as HUD shots (`projectile.hud`, a ShipArt object with
    its own emitters). Settings → "Commander view: show symbol ships' shots" hides them.
  - Beams are thin lines in the side's colour.
- **Wrecks** of symbol tiers are grey dots (`ui.hud.wreck`).
- **Background:** stars dimmed and blue-shifted while the commander view is on, fading in
  and out over a second. During Time Dilation it's red-shifted instead (replacing the blue
  glow at the screen's edges), with the stars smeared like a long exposure along your
  movement.

## Where it lives

- `CONFIG.commander` (and `redShift`, `redHaze`, smear settings in `CONFIG.timeDilation`).
- `symbolTierMax` / `drawnAsSymbol` in world.ts; `Ship.target` (set by the AI's aiming).
- render.ts: `drawBackground`, `symbolSprite`, symbol branches for ships, wrecks, shots and
  beams; renderer.ts: `drawLine` (fading), `fillView` (colour layers), `drawTiled` alpha/offset.
- Game.ts: `viewOptions` (fades, smear, the two settings), particles skip symbol ships.

## Open for later

- Elites could get the mockup's bold reticle ring instead of the current marker.
- Explosions and hit sparks of symbol ships still use normal effects.
- A red shift for other situations (e.g. heavy losses) if wanted.
