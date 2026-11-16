// The run log on the "Fleet destroyed" screen, one line per run. "My runs"
// lists this player's runs, newest first; "Leaderboard" lists every player's
// runs, best fleet value first. Your runs are in white, other players' in gray.
// Each number sits on a dark red bar sized against the highest value in its
// column; the highest bar of each column is orange.

import { useState } from 'react';
import { playerId, type RunRecord } from './game/runLog';

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
  { key: 'gearscore', label: 'Gearscore' },
];

type View = 'mine' | 'all';
/** The chosen view, remembered while the page is open. */
const remembered: { view: View } = { view: 'mine' };

/** `embedded`: inside the pause screen's Run log tab, instead of flush right on the game-over screen. */
export function RunLog({ runs, embedded = false }: { runs: RunRecord[]; embedded?: boolean }) {
  const [view, setView] = useState(remembered.view);
  remembered.view = view;
  const me = playerId();
  // Keep each run's place in the log, so "latest" means the run that just ended.
  const latest = runs[runs.length - 1];
  const shown =
    view === 'mine' ? runs.filter((r) => r.player === me).reverse() : [...runs].sort((a, b) => b.best - a.best || (a.ended < b.ended ? 1 : -1));
  const max = Object.fromEntries(COLUMNS.map((c) => [c.key, Math.max(1, ...shown.map((r) => Number(r[c.key]) || 0))]));
  const choose = (v: View) => () => setView(v);
  return (
    <div className={'run-log' + (embedded ? ' embedded' : '')}>
      <div className="run-log-head">
        <h2>Run log</h2>
        <div className="chips">
          <button className={view === 'mine' ? 'on' : ''} onClick={choose('mine')}>
            My runs
          </button>
          <button className={view === 'all' ? 'on' : ''} onClick={choose('all')}>
            Leaderboard
          </button>
        </div>
        <span className="note">You are {me}</span>
      </div>
      <div className="run-grid">
        <div className="run-head">Ended</div>
        {COLUMNS.map((c) => (
          <div key={c.key} className="run-head">
            {c.label}
          </div>
        ))}
        {shown.map((r, i) => (
          <div key={r.ended + r.player + i} className={'run-row' + (r === latest ? ' latest' : '') + (r.player === me ? '' : ' other')}>
            <div className="run-when">
              <span className="run-version">{r.build === 'dev' ? 'dev' : `v${r.build}`} · </span>
              {r.player ?? '??'} · {formatEnded(r.ended)}
            </div>
            {COLUMNS.map((c) => {
              const raw = r[c.key];
              // Older runs have no Gearscore.
              if (raw === undefined)
                return (
                  <div key={c.key} className="run-cell">
                    <span className="run-value">–</span>
                  </div>
                );
              const v = Number(raw) || 0;
              return (
                <div key={c.key} className="run-cell">
                  <span className={'run-bar' + (v > 0 && v === max[c.key] ? ' best' : '')} style={{ width: `${(v / max[c.key]) * 100}%` }} />
                  <span className="run-value">{c.format ? c.format(v) : v}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {shown.length === 0 && <div className="note">No runs yet.</div>}
    </div>
  );
}
