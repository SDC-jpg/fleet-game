// Builds a web page listing every tuning setting in src/game/config.ts, with its
// current value and description (taken from the comment above it).
// Runs as part of `npm run build`, so the published site always matches the game.
//
//   node tools/make-tuning-page.mjs [output file]   (default: dist/tuning.html)
//
// It reads config.ts as text (with the TypeScript parser) instead of running it,
// so it can see the comments. See the notes at the top of config.ts.

import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = process.argv[2] ?? `${ROOT}dist/tuning.html`;
const REPO = 'https://github.com/SDC-jpg/fleet-game';

const text = readFileSync(`${ROOT}src/game/config.ts`, 'utf8');
const file = ts.createSourceFile('config.ts', text, ts.ScriptTarget.Latest, true);
const missing = [];

// ---------- Reading comments and values ----------

/** Comments written just above a node. */
const commentsAbove = (node) =>
  (ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []).map((r) => text.slice(r.pos, r.end));

/**
 * The `/** ... *\/` description above a node, as one line of text.
 * Detail lines starting with "- " are for the code only and left out.
 */
function docOf(node) {
  const doc = commentsAbove(node).filter((c) => c.startsWith('/**')).pop();
  if (!doc) return '';
  const lines = doc
    .replace(/^\/\*\*|\*\/$/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim());
  const details = lines.findIndex((l) => l.startsWith('- '));
  return (details >= 0 ? lines.slice(0, details) : lines).filter(Boolean).join(' ');
}

/** A `// == Title: note ==` section heading above a node, if there is one. */
function sectionMarker(node) {
  for (const c of commentsAbove(node)) {
    const m = c.match(/^\/\/\s*==\s*(.+?)\s*==\s*$/);
    if (m) {
      const [title, ...note] = m[1].split(':');
      return { title: title.trim(), note: note.join(':').trim() };
    }
  }
  return null;
}

/** Strip `x as T` and `x satisfies T` to get at the value itself. */
function unwrap(node) {
  while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node) || ts.isParenthesizedExpression(node)))
    node = node.expression;
  return node;
}

/** How a value is shown on the page. */
function valueText(node) {
  node = unwrap(node);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isObjectLiteralExpression(node))
    return node.properties.map((p) => `${p.name.getText()}: ${valueText(p.initializer)}`).join(', ');
  return node.getText().replace(/\s+/g, ' ');
}

const nameOf = (p) => p.name.getText();
/** "teamColors" -> "Team colors" */
const humanize = (s) => s.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (c) => c.toUpperCase());

function row(prop, where, description) {
  const name = nameOf(prop);
  if (!description) missing.push(`${where}.${name}`);
  return { name, value: valueText(prop.initializer), description };
}

function findVariable(name) {
  for (const st of file.statements)
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) if (d.name.getText() === name) return { statement: st, decl: d };
  throw new Error(`config.ts has no "${name}"`);
}

// ---------- Collect the sections ----------
const sections = [];

// Ship types: values from SHIP_TYPES, descriptions from the ShipType interface.
const shipDocs = {};
const shipInterface = file.statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === 'ShipType');
for (const m of shipInterface?.members ?? []) shipDocs[m.name.getText()] = docOf(m);
const shipTypes = findVariable('SHIP_TYPES');
for (const type of unwrap(shipTypes.decl.initializer).properties) {
  const where = `SHIP_TYPES.${nameOf(type)}`;
  sections.push({
    title: `Ship stats: ${nameOf(type)}`,
    where,
    intro: docOf(shipTypes.statement),
    rows: unwrap(type.initializer).properties.map((p) => row(p, where, shipDocs[nameOf(p)])),
  });
}

// CONFIG: an object setting is its own section; plain settings go under the last `// ==` heading.
let flat = null;
for (const prop of unwrap(findVariable('CONFIG').decl.initializer).properties) {
  const name = nameOf(prop);
  const value = unwrap(prop.initializer);
  const marker = sectionMarker(prop);
  if (marker) {
    flat = { title: marker.title, where: 'CONFIG', intro: marker.note, rows: [] };
    sections.push(flat);
  }
  if (ts.isObjectLiteralExpression(value)) {
    const where = `CONFIG.${name}`;
    sections.push({
      title: humanize(name),
      where,
      intro: docOf(prop),
      rows: value.properties.map((p) => row(p, where, docOf(p))),
    });
    flat = null;
  } else if (ts.isArrayLiteralExpression(value)) {
    // A list of steps (like zoomSteps): one table row per item, one column per key.
    const items = value.elements.map(unwrap).filter(ts.isObjectLiteralExpression);
    const columns = [...new Set(items.flatMap((o) => o.properties.map(nameOf)))];
    sections.push({
      title: humanize(name),
      where: `CONFIG.${name}`,
      intro: docOf(prop),
      columns,
      items: items.map((o) => columns.map((c) => {
        const p = o.properties.find((q) => nameOf(q) === c);
        return p ? valueText(p.initializer) : '';
      })),
    });
    if (!docOf(prop)) missing.push(`CONFIG.${name}`);
    flat = null;
  } else {
    if (!flat) {
      flat = { title: 'General', where: 'CONFIG', intro: '', rows: [] };
      sections.push(flat);
    }
    flat.rows.push(row(prop, 'CONFIG', docOf(prop)));
  }
}

// Per-art and per-sound options in the asset manifest (these are features of the engine, not numbers).
sections.push({
  title: 'Art and sound options',
  where: 'public/assets/manifest.json',
  intro: 'Set per art or sound entry in the manifest. See public/assets/README.md for details.',
  head: ['Option', 'For', 'What it does'],
  rows: [
    ['file / files', 'both', 'Which file (or list of frame files) to use'],
    ['frameWidth, frameHeight', 'art', 'Size of one flipbook frame in a sprite sheet'],
    ['frames, fps, loop', 'art', 'Flipbook frame count, speed, and whether it repeats'],
    ['anchorX, anchorY', 'art', 'The pixel that sits on the object’s position'],
    ['volume', 'sound', 'Loudness of that sound, 0–1'],
    ['pitchVariation', 'sound', 'Random pitch change per play (0.05 = ±5%)'],
    ['maxVoices', 'sound', 'How many copies can play at once'],
    ['minGap', 'sound', 'Shortest time between two plays'],
    ['pitchPerTier', 'sound', 'Its own pitch per tier (above 1 = brighter for bigger tiers)'],
  ].map(([name, value, description]) => ({ name, value, description })),
});

if (missing.length) console.warn(`Settings without a description (add a /** */ comment in config.ts):\n  ${missing.join('\n  ')}`);

// ---------- Version info ----------
let commit = process.env.GITHUB_SHA ?? '';
try {
  commit ||= execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
} catch {
  // Not a git checkout: leave it out.
}
const built = new Date().toISOString().slice(0, 10);

// ---------- Page ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function sectionHtml(s) {
  const heading = `<h2>${esc(s.title)}<small>${esc(s.where)}</small></h2>${s.intro ? `<p class="intro">${esc(s.intro)}</p>` : ''}`;
  let table;
  if (s.items) {
    table = `<thead><tr>${s.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${s.items.map((r) => `<tr>${r.map((v) => `<td class="num">${esc(v || '–')}</td>`).join('')}</tr>`).join('')}</tbody>`;
  } else {
    const h = s.head ?? ['Setting', 'Now', 'What it does'];
    table = `<thead><tr>${h.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${s.rows.map((r) => `<tr><td class="name">${esc(r.name)}</td><td class="val">${esc(r.value)}</td><td>${esc(r.description)}</td></tr>`).join('')}</tbody>`;
  }
  return `<section id="${slug(s.title)}">${heading}<div class="table"><table>${table}</table></div></section>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fleet Game Tuning</title>
<link rel="icon" type="image/png" href="assets/ships/fighter.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root {
  --bg: #f4f6fa; --surface: #ffffff; --fg: #141a2b; --muted: #5b6480; --line: #dde2ee;
  --accent: #1f7fb5; --accent-soft: #e3f1fa;
  --display: "Space Grotesk", system-ui, sans-serif;
  --body: "Inter", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #070912; --surface: #0e1222; --fg: #dfe6ff; --muted: #8f9bbf; --line: #232a44;
    --accent: #7ecff2; --accent-soft: #10243a; color-scheme: dark; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 var(--body); }
a { color: var(--accent); }
.wrap { max-width: 1100px; margin: 0 auto; padding: 40px 16px 64px;
  display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 40px; }
header { grid-column: 1 / -1; display: grid; gap: 8px; }
h1 { font: 700 clamp(28px, 4vw, 40px)/1.1 var(--display); margin: 0; letter-spacing: -0.01em; }
.lede { color: var(--muted); max-width: 70ch; margin: 0; }
.meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.meta span, .meta a { font: 12px var(--mono); padding: 3px 8px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); text-decoration: none; }
nav { position: sticky; top: 24px; align-self: start; display: grid; gap: 2px; }
nav a { color: var(--muted); text-decoration: none; font-size: 13px; padding: 4px 8px; border-radius: 4px; }
nav a:hover, nav a:focus-visible { color: var(--fg); background: var(--surface); outline: none; }
main { display: grid; gap: 36px; min-width: 0; }
section { display: grid; gap: 8px; min-width: 0; }
h2 { font: 700 20px/1.2 var(--display); margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
h2 small { font: 400 12px var(--mono); color: var(--muted); }
.intro { margin: 0; color: var(--muted); max-width: 75ch; font-size: 14px; }
.table { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; min-width: 560px; }
th, td { text-align: left; padding: 8px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: none; }
th { font: 500 11px var(--body); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
td.name { font: 13px var(--mono); white-space: nowrap; }
td.val, td.num { font: 600 13px var(--mono); color: var(--accent); font-variant-numeric: tabular-nums; }
td.val { max-width: 220px; }
@media (max-width: 820px) { .wrap { grid-template-columns: minmax(0, 1fr); gap: 24px; } nav { display: none; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Fleet Game: tuning settings</h1>
    <p class="lede">Every number you can change to tune the game, with its current value. Made automatically from
      <a href="${REPO}/blob/${commit || 'main'}/src/game/config.ts">src/game/config.ts</a> each time a new version goes live,
      so it always matches the game. Distances are in game pixels, times in seconds, speeds in pixels per second.</p>
    <div class="meta">
      <a href="./">▶ Play the game</a>
      <span>built ${built}</span>
      ${commit ? `<a href="${REPO}/commit/${commit}">version ${commit.slice(0, 7)}</a>` : ''}
    </div>
  </header>
  <nav aria-label="Sections">${sections.map((s) => `<a href="#${slug(s.title)}">${esc(s.title)}</a>`).join('')}</nav>
  <main>
${sections.map((s) => '    ' + sectionHtml(s)).join('\n')}
  </main>
</div>
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
const count = sections.reduce((n, s) => n + (s.rows?.length ?? s.items.length), 0);
console.log(`tuning page: ${count} settings in ${sections.length} sections -> ${OUT}`);
