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
