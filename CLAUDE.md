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
- Public repo: https://github.com/SDC-jpg/fleet-game. Live game: https://sdc-jpg.github.io/fleet-game/ (the user shares this with a teammate).
- Every push to `main` rebuilds and republishes through `.github/workflows/deploy.yml`, with test keys on (`VITE_TEST_KEYS`). Pushing publishes publicly. **Only push when the user says to.** Don't ask after each change, because the user will say when.
- Commits use the user's GitHub noreply email (set in this repo's git config). Never commit with their personal email.

## Seeing the game (for Claude)
- The container has Chromium (installed by the Dockerfile at build time, no firewall change needed). `tools/screenshot.mjs` drives it with `playwright-core` and saves screenshots that Claude can view with the Read tool. It also prints browser errors.
- Example (dev server must be running): `node tools/screenshot.mjs --out <scratchpad>/shots 'wait:1500' 'press:Equal*10' 'hold:KeyD:800' 'shot:fleet'`. Quote the steps, because the shell (zsh) treats `*` as a filename wildcard. Run it with no steps for a single screenshot.
- Dev-only test keys help set up scenes: `=`/`-` add/remove ship, `]` add 16 ships, `G` invincible, `K` destroy on-screen enemies.
- Use it to check visual changes before handing them to the user. The browser has no graphics card, so it can't judge smoothness or performance. The user does that.

## Code layout
- `src/engine/`: the small homegrown engine (asset loading from the manifest, pixel renderer with whole-number zoom, sound playback (`sound.ts`), input, fixed 60 Hz game loop).
- `src/game/config.ts`: every tuning number (speeds, health, waves, zoom steps, ship types and their hit sizes).
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
  - **Sounds follow the same rules:** sound effects only (no music for now), each in `public/assets/sfx/`, listed by name in the manifest's `"sounds"` section with volume and overlap limits, with `.t2`… tier versions falling back to a lower-pitched smaller tier. Sound is on by default, M or the HUD button toggles it, and wingmen's shots play quieter (`CONFIG.audio.allyShotVolume`; may become silent if distracting).
  - Placeholder art should follow the same conventions, so swapping in real art means replacing files (and maybe editing the manifest), not changing code.

### Game concept: pixel-art spaceship fleet combat
- The player starts as a single spaceship and grows a fleet. As the fleet grows, the camera zooms out and the fights get bigger, eventually fleet against fleet.
- **Fleet control:** the player flies one ship directly (WASD/arrows to move, mouse to aim and fire). The other ships follow in formation and shoot nearby enemies on their own. Simple fleet orders (formation spacing, attack target, hold back) come later.
- **Zoom:** in steps at whole-number pixel scales (e.g. 4× → 3× → 2× → 1×) so pixel art stays crisp, with a quick smooth transition between steps. Steps trigger at fleet-size thresholds.
- **Getting new ships:** start with flying into wrecks to recruit them. Other ways (buying, capturing enemies) may come later.
- **Flagship death:** command passes to another ship in the fleet, and it's game over only when the whole fleet is gone. Later, the player should be able to switch to any owned ship at will, because ships will eventually have different modules and weapons.
- **Mode:** endless survival for now. Track a "max fleet size reached" stat to measure how well a run went.
- **Ship size:** the starter ship is about 32×32 pixels. Larger ships must be possible, so don't assume a fixed sprite size.
- **Ship types:** all ships are the same type for now. Different types are a nice-to-have for later.
- **Tiers and merging** (numbers in `CONFIG.tiers`):
  - Fleet value = what every ship is worth in tier-1 ships (T2 = 16, T3 = 256...). It's the score.
  - Once fleet value reaches 32, any 16 ships of one tier merge into one of the next tier, so there are never more than 15 per tier. Merging is automatic for now; merging by choice may come later.
  - Each tier: 12× health and 12× damage per volley, always 2 shots per volley for T2+ (6× per shot at T2, 72× at T3...), 1.5× size, shots 1.2× faster and travelling 1.5× further.
  - Merge moment: the ships fly into the core, flash, big ship appears. They can't shoot or be hit meanwhile.
  - You always fly one of your biggest ships (promoted after a merge or recruiting a bigger wreck). A dead ship takes its whole worth; merged ships never split.
  - Enemy fleets use the same tier rule. Bigger enemies leave wrecks of their tier, less often (×0.4 per tier).
  - Formation by size: biggest ships in the inner rings.
  - Zoom follows the highest tier: 1× at T2, 0.75× from T3 on (art shrunk smoothly). Tried and rejected as too zoomed out: 0.5× at T3, 0.25× at T4.
  - Each tier has its own art (`ship.fighter.t2`...), canvases growing 1.5× per tier from the 64 px fighter.

### First prototype scope
1. Fly a ship around empty space and shoot.
2. Enemy ships come in waves. Some leave wrecks you can fly into to recruit them.
3. Recruited ships follow in a simple formation and shoot automatically.
4. The camera zooms out a step when the fleet reaches a size threshold.
5. A small enemy fleet appears once the player's fleet is big enough.

Not in the first prototype: upgrades, ship types, menus, sound, story.
