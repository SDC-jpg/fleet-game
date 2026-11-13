// The run log on the "Fleet destroyed" screen: every run played in this
// browser, newest first, one line each. Each number sits on a dark red bar
// sized against the highest value in its column, so runs compare at a glance.

import type { RunRecord } from './game/runLog';

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026/11/13 14:05" in the player's own time zone. */
const formatEnded = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const formatTime = (t: number) => `${Math.floor(t / 60)}:${pad(Math.floor(t % 60))}`;

const COLUMNS: { key: keyof RunRecord; label: string; format?: (v: number) => string }[] = [
  { key: 'best', label: 'Best value' },
  { key: 'time', label: 'Time', format: formatTime },
  { key: 'waves', label: 'Waves' },
  { key: 'kills', label: 'Destroyed' },
  { key: 'losses', label: 'Lost' },
  { key: 'killValue', label: 'Value destroyed' },
  { key: 'lossValue', label: 'Value lost' },
];

export function RunLog({ runs }: { runs: RunRecord[] }) {
  const newestFirst = [...runs].reverse();
  const max = Object.fromEntries(COLUMNS.map((c) => [c.key, Math.max(1, ...runs.map((r) => Number(r[c.key]) || 0))]));
  return (
    <div className="run-log">
      <h2>Run log</h2>
      <div className="run-grid">
        <div className="run-head">Ended</div>
        {COLUMNS.map((c) => (
          <div key={c.key} className="run-head">
            {c.label}
          </div>
        ))}
        {newestFirst.map((r, i) => (
          <div key={r.ended + i} className={'run-row' + (i === 0 ? ' latest' : '')}>
            <div className="run-when">
              <span className="run-version">{r.build === 'dev' ? 'dev' : `v${r.build}`} · </span>
              {formatEnded(r.ended)}
            </div>
            {COLUMNS.map((c) => {
              const v = Number(r[c.key]) || 0;
              return (
                <div key={c.key} className="run-cell">
                  <span className="run-bar" style={{ width: `${(v / max[c.key]) * 100}%` }} />
                  <span className="run-value">{c.format ? c.format(v) : v}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
