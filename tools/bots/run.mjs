// Bot test runs: many "average player" bots play the real game at once, without a browser.
//
//   node tools/bots/run.mjs --minutes 10            play for 10 minutes (real time), then stop starting runs
//   options: --workers 14 (bots at once)  --careers 4 (of those, bots playing run after run, keeping equipment)
//            --career-runs 25 (runs in each career)  --cap 1500 (game seconds a run may last)  --groups laser,shield,...  (default: every skill + baseline)
//            --out bot-results/<name>  (results.jsonl there; default a new folder per session)
//
// Experiments (one "group" each): "baseline" = normal card picks; "<skill>" = the run starts with
// that skill and the bot never takes another of its side (weapons, defences, passives compared);
// "career-N" = consecutive runs keeping equipment. Results: one JSON line per run.

import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const minutes = Number(arg('minutes', 10));
const workers = Number(arg('workers', Math.max(1, cpus().length - 2)));
const careers = Number(arg('careers', 8));
const careerRuns = Number(arg('career-runs', 25));
const cap = Number(arg('cap', 1500));
const out = join(ROOT, arg('out', `bot-results/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`));
mkdirSync(out, { recursive: true });
const results = join(out, 'results.jsonl');

// The worker, bundled for Node (the game's code as is; Vite-only values filled in).
const bundle = join(ROOT, 'tools/bots/.build/worker.mjs');
await build({
  entryPoints: [join(ROOT, 'tools/bots/worker.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  logLevel: 'error',
  define: { 'import.meta.env': JSON.stringify({ BASE_URL: '/', DEV: false, VITE_BUILD: 'dev' /* 'dev' loads 'dev' saves, so careers keep their equipment */ }), __BUILD_TIME__: '0' },
});

// Which groups: every skill that's switched on (asked of the game's own code), plus the baseline.
const bySide = JSON.parse(execFileSync(process.execPath, [bundle, 'list'], { encoding: 'utf8' }));
const skills = [...bySide.left, ...bySide.right, ...bySide.passive];
const groups = (arg('groups', '') || ['baseline', ...skills].join(',')).split(',');
// --no-elites: elites switched off (as test key O), to see what they change.
const noElites = process.argv.includes('--no-elites');
// --leviathan-at 30: every run gets a Leviathan at that wave (the run ends when the fight is decided).
const leviathanAt = Number(arg('leviathan-at', 0)) || undefined;

const deadline = Date.now() + minutes * 60_000;
let running = 0;
let done = 0;
let next = 0;
const started = Date.now();
const log = (msg) => console.log(`[${((Date.now() - started) / 60000).toFixed(1)} min] ${msg}`);

function launch(job, onExit) {
  running++;
  const child = spawn(process.execPath, [bundle, JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      appendFileSync(results, line + '\n');
      done++;
      const r = JSON.parse(line);
      const b = r.boss ? ` · Leviathan: ${r.boss.killed ? 'killed' : `lost (${Math.round(r.boss.hpLeft * 100)}% left)`} in ${Math.round(r.boss.end - r.boss.start)}s` : '';
      log(`${r.group}${r.kind === 'career' ? ` run ${r.run}` : ''}: wave ${r.wave}, tier ${r.maxTier}, best value ${r.bestValue}, gearscore ${r.gearEnd}${r.capped ? ' (capped)' : ''}${b} [${r.realSeconds}s]`);
    }
  });
  child.on('exit', () => {
    running--;
    onExit();
  });
}

// Careers: each a bot of its own, playing run after run until the deadline.
// (When one finishes its runs, its bot takes single runs like the others.)
for (let c = 1; c <= Math.min(careers, workers); c++)
  launch({ kind: 'career', group: `career-${c}`, cap, until: deadline, runs: careerRuns, leviathanAt }, () => {
    fill();
    check();
  });
// The other bots take single runs from the groups in turn, so each group gets about as many.
function fill() {
  while (running < workers && Date.now() < deadline) {
    const group = groups[next++ % groups.length];
    launch({ kind: 'single', group: noElites ? `${group}-no-elites` : group, forced: group === 'baseline' ? null : group, cap, noElites, leviathanAt }, () => {
      fill();
      check();
    });
  }
}
function check() {
  if (running === 0) log(`finished: ${done} runs in ${out}/results.jsonl`);
}
log(`${workers} bots (${Math.min(careers, workers)} careers), ${groups.length} groups, ${minutes} min, runs capped at ${cap} game seconds`);
fill();
