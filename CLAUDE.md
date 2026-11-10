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
- Keep LF line endings in `.devcontainer` files (enforced by `.gitattributes`).
- `.devcontainer/init-firewall.sh` uses `ipset add -exist` to fix a duplicate-IP startup error. This is the user's own fix. Don't revert it.

## Decisions
<!-- Things the user asked to remember, or asked Claude not to suggest again. -->
- **Art must be easy to swap.** The user is a digital artist and will eventually replace all placeholder art with their own: images with transparency (alpha), flipbook (frame-by-frame) animations, VFX such as explosions, and characters. Build with this in mind from the start:
  - Draw everything visual from image or sprite assets. Don't hard-code shapes into game logic.
  - Keep art files in one clear folder, and list them in a single asset manifest (a file mapping names like `player.idle` or `vfx.explosion` to their files and frame settings).
  - Support flipbook animations from sprite sheets or numbered frame files, with frame size, frame count, frame rate and looping set in the manifest, not in code.
  - Don't let gameplay depend on the exact pixel size of the art. Use separate collision sizes and anchor points.
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

### First prototype scope
1. Fly a ship around empty space and shoot.
2. Enemy ships come in waves. Some leave wrecks you can fly into to recruit them.
3. Recruited ships follow in a simple formation and shoot automatically.
4. The camera zooms out a step when the fleet reaches a size threshold.
5. A small enemy fleet appears once the player's fleet is big enough.

Not in the first prototype: upgrades, ship types, menus, sound, story.
