// End-of-run chart: what destroyed the enemies (your ships' guns, merge
// bursts, each skill), one bar per weapon in a single column. A toggle shows
// either kills or the fleet value destroyed; the biggest bar is full width and
// the rest are scaled to it (same look as the run log's bars).

import { useState } from 'react';
import { SKILLS } from './game/config';
import type { RunStats } from './game/world';

/** A weapon's name on screen. */
export function sourceName(id: string) {
  if (id === 'gun') return 'Base weapon';
  if (id === 'gun-energy') return 'Base weapon (energy)';
  if (id === 'gun-explosive') return 'Base weapon (explosive)';
  if (id === 'merge') return 'Merge burst';
  return (SKILLS as Record<string, { name: string }>)[id]?.name ?? id;
}

export function KillChart({ bySource }: { bySource: RunStats['killsBySource'] }) {
  const [show, setShow] = useState<'kills' | 'value'>('kills');
  const rows = Object.entries(bySource)
    .map(([id, v]) => ({ id, n: show === 'kills' ? v.kills : v.value }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="kill-chart">
      <div className="kill-chart-head">
        <span>Destroyed by</span>
        <span className="kill-chart-toggle">
          <button className={show === 'kills' ? 'on' : ''} onClick={() => setShow('kills')}>
            Kills
          </button>
          <button className={show === 'value' ? 'on' : ''} onClick={() => setShow('value')}>
            Fleet value
          </button>
        </span>
      </div>
      {rows.length === 0 && <div className="note">Nothing destroyed.</div>}
      {rows.map((r) => (
        <div key={r.id} className="kill-row">
          <span className="kill-name">{sourceName(r.id)}</span>
          <span className="run-cell">
            <span className={'run-bar' + (r.n === max ? ' best' : '')} style={{ width: `${(r.n / max) * 100}%` }} />
            <span className="run-value">
              {r.n} {show === 'kills' ? (r.n === 1 ? 'kill' : 'kills') : 'FV'}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
