// Pause screen, Lifetime tab: every finished run in this browser added up
// (src/game/lifetime.ts): totals, then kills and fleet value destroyed per
// weapon and skill (the same chart as the end-of-run report).

import { loadLifetime } from './game/lifetime';
import { KillChart } from './KillChart';

/** Seconds → "3 h 05 min" or "12 min 30 s". */
function playTime(t: number) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s).padStart(2, '0')} s`;
}

const num = (n: number) => Math.round(n).toLocaleString('en');

export function LifetimeStats() {
  const life = loadLifetime();
  const rows: [string, string][] = [
    ['Runs', num(life.runs)],
    ['Time played', playTime(life.time)],
    ['Ships destroyed', num(life.kills)],
    ['Fleet value destroyed', num(life.killValue)],
    ['Ships lost', num(life.losses)],
    ['Fleet value lost', num(life.lossValue)],
    ['Items collected', num(life.itemsCollected)],
    ['Items merged', num(life.merges)],
    ['Best fleet value', num(life.bestValue)],
    ['Furthest wave', num(life.bestWave)],
  ];
  return (
    <div className="lifetime">
      <div className="note">All your finished runs in this browser, added up.</div>
      <div className="lifetime-grid">
        {rows.map(([label, value]) => (
          <div key={label} className="lifetime-row">
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      {Object.keys(life.killsBySource).length > 0 && <KillChart bySource={life.killsBySource} />}
    </div>
  );
}
