// The list of placeholder art files: each file the placeholder tools generated, with a
// fingerprint (hash) of its contents, in tools/placeholders.json. A file whose contents
// no longer match its fingerprint has been replaced by the artist's own art, so the art
// sheet (tools/art-sheet.mjs) leaves it out. The generators update the list when they
// write a file; `node tools/art-sheet.mjs scan` rebuilds it from scratch.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PLACEHOLDERS_FILE = fileURLToPath(new URL('./placeholders.json', import.meta.url));
export const ASSETS_DIR = fileURLToPath(new URL('../public/assets/', import.meta.url));

export const hashOf = (bytes) => createHash('sha1').update(bytes).digest('hex');

/** { "vfx/explosion.png": "<sha1>", ... } (paths relative to public/assets). */
export function loadPlaceholders() {
  if (!existsSync(PLACEHOLDERS_FILE)) return {};
  return JSON.parse(readFileSync(PLACEHOLDERS_FILE, 'utf8')).files ?? {};
}

export function savePlaceholders(files) {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const note = 'Placeholder art files and their fingerprints. Made by the placeholder tools; see tools/placeholders.mjs.';
  writeFileSync(PLACEHOLDERS_FILE, JSON.stringify({ _readme: note, files: sorted }, null, 2) + '\n');
}

/** Record that a tool just wrote this placeholder file (path relative to public/assets). */
export function recordPlaceholder(file, bytes) {
  const files = loadPlaceholders();
  files[file] = hashOf(bytes);
  savePlaceholders(files);
}

/** Is this file (relative to public/assets) still the placeholder that was generated? */
export function isPlaceholder(file, files = loadPlaceholders()) {
  const path = ASSETS_DIR + file;
  return !!files[file] && existsSync(path) && hashOf(readFileSync(path)) === files[file];
}
