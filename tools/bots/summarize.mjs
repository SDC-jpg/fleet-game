// Turns a bot batch's results.jsonl into the CSV files the report page reads:
//   runs.csv     one row per run (group, its side, waves reached, highest tier, best fleet value, gearscore...)
//   sources.csv  one row per run and damage source (damage dealt, kills, value destroyed)
//   waves.csv    one row per run and wave reached (time, fleet value, level, tier): progress curves
//
//   node tools/bots/summarize.mjs bot-results/batch-1

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const runs = readFileSync(join(dir, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// Each skill's side and name, from config.ts.
const config = readFileSync(join(ROOT, 'src/game/config.ts'), 'utf8');
const block = config.slice(config.indexOf('export const SKILLS = {'), config.indexOf('export type SkillId'));
const info = {};
for (const m of block.matchAll(/\n {2}(\w+): \{\s*name: "([^"]+)"[\s\S]*?side: "(\w+)"/g)) info[m[1]] = { name: m[2], side: m[3] };
const SIDE = { left: 'Weapon', right: 'Defence', passive: 'Passive' };
// (Runs with elites switched off are a separate test, not one of the skill groups.)
const sideOf = (r) => (r.kind === 'career' ? 'Career' : r.group.endsWith('-no-elites') ? 'Test' : r.forced ? SIDE[info[r.forced]?.side] : 'Baseline');
const nameOf = (g) => info[g]?.name ?? (g === 'baseline-no-elites' ? 'Baseline, elites off' : g === 'baseline' ? 'Baseline (normal picks)' : g === 'gun' ? 'Guns' : g === 'merge' ? 'Merge bursts' : g.replace(/^career-/, 'Career '));

const csv = (rows) => {
  const cols = Object.keys(rows[0]);
  const cell = (v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v ?? '');
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
};

const runRows = runs.map((r, i) => {
  const dmg = Object.values(r.damageBySource ?? {}).reduce((a, b) => a + b, 0);
  return {
    id: i + 1,
    group: r.group,
    name: nameOf(r.group),
    side: sideOf(r),
    career_run: r.kind === 'career' ? r.run : '',
    wave: r.wave,
    max_tier: r.maxTier,
    best_value: r.bestValue,
    level: r.level,
    gear_start: r.gearStart,
    gear_end: r.gearEnd,
    capped: r.capped ? 1 : 0,
    minutes: Math.round((r.time / 60) * 10) / 10,
    kills: r.kills,
    kill_value: r.killValue,
    losses: r.losses,
    merge_module: r.mergeLevel,
    items_looted: r.looted,
    forced_damage_share: r.forced && dmg > 0 ? Math.round(((r.damageBySource?.[r.forced] ?? 0) / dmg) * 1000) / 1000 : '',
    skills: r.skills.map((k) => `${nameOf(k.id)} ${k.rank}`).join('; '),
  };
});
const sourceRows = [];
runs.forEach((r, i) => {
  const ids = new Set([...Object.keys(r.damageBySource ?? {}), ...Object.keys(r.killsBySource ?? {})]);
  for (const s of ids)
    sourceRows.push({
      id: i + 1,
      group: r.group,
      side: sideOf(r),
      source: nameOf(s),
      source_side: info[s] ? SIDE[info[s].side] : 'Fleet',
      damage: Math.round(r.damageBySource?.[s] ?? 0),
      kills: r.killsBySource?.[s]?.kills ?? 0,
      kill_value: r.killsBySource?.[s]?.value ?? 0,
    });
});
const waveRows = [];
runs.forEach((r, i) => {
  for (const w of r.waves) waveRows.push({ id: i + 1, group: r.group, side: sideOf(r), wave: w.wave, minutes: Math.round((w.time / 60) * 10) / 10, fleet_value: w.value, level: w.level, tier: w.tier });
});
writeFileSync(join(dir, 'runs.csv'), csv(runRows));
writeFileSync(join(dir, 'sources.csv'), csv(sourceRows));
writeFileSync(join(dir, 'waves.csv'), csv(waveRows));
console.log(`${runRows.length} runs, ${sourceRows.length} source rows, ${waveRows.length} wave rows → ${dir}`);
