# Sound tool (plan agreed 2026-11-19, built 2026-11-20)

A Sounds section in ShipArt for the teammate: see where each sound is used, play it with
a visual example, and try replacement audio. Requested by the user for their teammate.

## Where it lives

In **ShipArt** (`shipart.html`, `src/shipart/`), as a **Sounds** entry in the left rollout
menu (next to Ships, Objects, Effects, Bosses).

- The teammate already uses the view-only ShipArt link:
  https://sdc-jpg.github.io/fleet-game/shipart.html
- ShipArt already previews the game's real effects over stars (Effects section), which is
  most of what a visual example needs.

## What it shows

Every sound in the manifest's `"sounds"` section (58 on 2026-11-19), grouped:
Weapons and guns, Skills, Explosions, Ship (engine, boost, dash), Leviathan,
Alerts and UI. For each sound:

- **Where it's used**, in plain words. Written from the game code, for example
  "When any of your ships fires its gun. Wingmen play it quieter (`CONFIG.audio.allyShotVolume`)."
  Kept in one list file, for example `src/shipart/soundInfo.ts`: sound name → group, description,
  example scene. A sound missing from the list shows "not described yet", so new sounds are
  never hidden.
- **Its settings** from the manifest: volume, overlap limit, loop, `pitchPerTier`, and its
  tier versions (`.t2`…`.t4`), each with its own play button. A tier with no file of its own
  says it falls back to the smaller tier, lower-pitched.
- **A play button with a visual example**: the preview replays the moment the sound belongs
  to, using the game's own art and drawing code (`drawLayoutArt`, effects via `Effect.at`).
  For example: a T3 explosion flipbook, a missile launching, igniting and hitting, the
  Leviathan's charge and beam, the shield bubble.
  - Looping sounds (engine hum, laser sear, Leviathan beam) play for as long as their
    example runs, through `Sounds.setLoop`.
  - Menu and UI sounds (level-up, card, game over) get a simple label instead of a scene.

## Replacing a sound: drag and drop (no URL paste)

URL pasting was considered and dropped:

- Share links from Google Drive, Dropbox and OneDrive lead to a web page, not the audio file.
- Most sites block other sites from loading their files (CORS).
- Discord file links expire.

Drag and drop always works. The flow:

1. **The teammate, on the live site:** they drop an audio file (WAV, MP3 or OGG; anything the
   browser can decode) onto a sound's row.
   - The file is kept in their browser (IndexedDB) and used at once in the preview.
   - An optional switch makes the game use it too, in their browser only, so they can hear
     it in a real fight.
   - "Use original" reverts it.
2. **"Download my replacements"** gives them one zip with:
   - the files already named for the sounds they replace (for example
     `sfx/explosion.t3.wav`; the original extension is kept if it isn't WAV);
   - a small text file listing which sound each file replaces.

   They send the zip to the user.
3. **The user, on the dev copy (`npm run dev`):** they drop the zip (or single files) on the
   same Sounds section.
   - A dev-server route (like `/__shipart/import-zip` in `tools/shipart-plugin.ts`) writes the
     files into `public/assets/sfx/`.
   - It updates the manifest entries' file names (only the changed lines, like
     `/__shipart/manifest`).
   - The files then count as the user's uncommitted art and go live at the next push, under
     the push rule in CLAUDE.md, with a CHANGELOG line such as "New sound: …".

The live site can't save files for everyone; that's why ShipArt is view-only there and why
replacements travel as a zip through the user.

## As built (2026-11-20)

- All three steps below, in one go. Visual examples are short scripted scenes (`scene` in
  `src/shipart/soundInfo.ts`) drawn with the game's art, not the full game rules.
- On the dev copy, dropped files and zips go into the same browser list first (so you can
  listen), then **Write into the game files** copies them into `public/assets/sfx/` and the
  manifest.
- The Leviathan's sounds are listed only on the dev copy while it's a secret.

## Build order

Each step works on its own:

1. Sound list: groups, "where used", settings, play buttons (incl. tier versions).
2. Visual examples in the preview.
3. Drag-and-drop replacing (browser-only), the download zip, and importing the zip on the
   dev copy.

## Open ideas (not agreed)

- A volume slider per sound that the teammate could adjust and hand back with the files
  (written into the manifest on import).
- A separate page instead of the ShipArt section.
