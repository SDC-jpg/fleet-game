import { useEffect, useRef, useState } from 'react';
import { Assets } from './engine/assets';
import { Sounds } from './engine/sound';
import { CONFIG } from './game/config';
import { loadArtLayouts } from './game/artLayout';
import { ROTATION_LABELS } from './engine/renderer';
import { Game, TEST_KEYS_ENABLED, type HudInfo } from './game/Game';
import type { HistoryPoint } from './game/world';
import { CardScreen } from './CardScreen';
import { BottomHud } from './BottomHud';
import { RunLog } from './RunLog';
import { BUILD } from './game/save';
import { EquipmentScreen, FoundToast } from './EquipmentScreen';
import { KillChart } from './KillChart';
import { TouchControls } from './TouchControls';
import { IS_TOUCH_DEVICE } from './engine/touch';
import { CrtOverlay } from './CrtOverlay';
import { screenEffect } from './game/screenEffect';

/** "2026/11/13 v20": when this version was built (in the viewer's time zone) and its number. */
const BUILD_STAMP = (() => {
  const d = new Date(__BUILD_TIME__);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${BUILD === 'dev' ? 'dev' : `v${BUILD}`}`;
})();

const formatTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the art, then start the game. Stop it when the page closes.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      Assets.load().then(async (assets) => ({ assets, layouts: await loadArtLayouts(assets) })),
      Sounds.load(CONFIG.audio.masterVolume),
      screenEffect.loadLive(),
    ])
      .then(([{ assets, layouts }, sounds]) => {
        if (cancelled || !canvasRef.current) return;
        const game = new Game(canvasRef.current, assets, sounds, layouts, setHud);
        gameRef.current = game;
        game.start();
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      gameRef.current?.stop();
      gameRef.current = null;
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="game-canvas" />

      {error && <div className="panel center">Couldn't start: {error}</div>}
      {!hud && !error && <div className="panel center">Loading…</div>}

      <div className="top-stack">
      {/* Keyboard help (not on touch screens, which have their own controls). */}
      {hud && !IS_TOUCH_DEVICE && (
        <div className="top-bar">
          <div>WASD move · Shift boost · Space dash · mouse aim · click fire · Q auto-fire · right-click defend · Esc pause & equipment · Tab run log · fly into wrecks to recruit</div>
          {TEST_KEYS_ENABLED && (
            <div>
              Test keys: = / - add/remove ship · ] add 16 ships · T add a next-tier ship · G invincible {hud.invincible ? '(ON)' : '(off)'} · K destroy enemies on
              screen · X end run · L level up · J all skills · I drop 3 matching items · Y drop the next Merge Module · E spawn elite · H spawn swarm · V variants · B Leviathan · N its beam now · R reinforcements · O elites {hud.elitesEnabled ? '(ON)' : '(off)'} · F formation ({hud.formationMode === 'fill' ? 'Fill' : 'Original'}) · U rotation ({ROTATION_LABELS[hud.rotation]}) · {hud.display}
            </div>
          )}
        </div>
      )}

      {/* Wave timer: the current wave, a thin bar filling up until the next one, and what the next one brings. */}
      {hud && !hud.gameOver && (
        <div className="wave-timer">
          <span className="wave-num">Wave {hud.wave}</span>
          <span className="wave-bar">
            <span style={{ width: `${Math.min(100, Math.max(0, hud.waveProgress * 100))}%` }} />
          </span>
          <span className="wave-next" title="Next wave: F = enemy fleet, E = elite, S = swarm">
            {hud.nextWave.fleet && <b className="f">F</b>}
            {hud.nextWave.elite && <b className="e">E</b>}
            {hud.nextWave.swarm && <b className="s">S</b>}
          </span>
        </div>
      )}
      {/* A boss's health (placeholder look, separate so art can replace it). */}
      {hud && !hud.gameOver && hud.boss !== null && (
        <div className="boss-bar">
          <span className="boss-name">Leviathan</span>
          <span className="boss-health">
            <span style={{ width: `${Math.max(0, hud.boss * 100)}%` }} />
          </span>
        </div>
      )}
      </div>

      {hud && (
        <div className="hud">
          <div>
            Fleet: {hud.fleetSize} <span className="hint">({hud.fleetMix})</span>
          </div>
          <div>Best: {hud.maxFleetSize}</div>
          <div>Wave: {hud.wave}</div>
          <div>Time: {formatTime(hud.time)}</div>
          <div>Dash (Space): {hud.dashCooldown > 0 ? `${Math.ceil(hud.dashCooldown)} s` : 'ready'}</div>
          <div>FPS: {hud.fps}</div>
          {hud.autoFire && <div className="auto-fire">Auto-fire ON (Q)</div>}
          <button
            className="sound-toggle"
            onClick={(e) => {
              gameRef.current?.toggleSound();
              e.currentTarget.blur(); // so Space doesn't press it again
            }}
            title="Sound on/off (M)"
          >
            {hud.soundOn ? '🔊 Sound on' : '🔇 Sound off'} (M)
          </button>
          {hud.assetProblems.length > 0 && (
            <div className="warn">
              Art / sound problems:
              {hud.assetProblems.map((p) => (
                <div key={p}>· {p}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {hud && !hud.gameOver && !hud.paused && !hud.resumeOffer && <BottomHud hud={hud} game={gameRef.current} />}
      {IS_TOUCH_DEVICE && hud && gameRef.current && !hud.gameOver && !hud.paused && !hud.cards && !hud.resumeOffer && <TouchControls game={gameRef.current} leftHanded={hud.leftHanded} />}
      {hud?.cards && !hud.gameOver && <CardScreen hud={hud} game={gameRef.current} />}

      {hud?.paused && <EquipmentScreen hud={hud} game={gameRef.current} />}
      {hud && !hud.gameOver && !hud.paused && <FoundToast hud={hud} />}
      {hud?.eliteAlert && !hud.gameOver && (
        <div className="elite-toast">
          Elite incoming!
          {/* Tech Scanner: each elite's skills. */}
          {hud.eliteSkills.map((names, i) => (
            <div key={i} className="elite-skills">
              {hud.eliteSkills.length > 1 ? `Elite ${i + 1}: ` : 'Skills: '}
              {names.length ? names.join(' · ') : 'none'}
            </div>
          ))}
        </div>
      )}
      {hud?.swarmAlert && !hud.gameOver && <div className="swarm-toast">Swarm incoming!</div>}
      {hud?.reinforcementAlert && !hud.gameOver && <div className="reinforce-toast">Fleet HQ is warping in reinforcements!</div>}

      {hud?.resumeOffer && (
        <div className="panel center resume-offer">
          <h1>Resume your last run?</h1>
          <p>
            It was interrupted at wave {hud.resumeOffer.wave} ({new Date(hud.resumeOffer.savedAt).toLocaleString()}).
            <br />
            Fleet value {hud.resumeOffer.fleetValue} · Level {hud.resumeOffer.level}
          </p>
          <p className="hint">The field starts empty and wave {hud.resumeOffer.wave} begins again, with your fleet, level and skills.</p>
          <button onClick={() => gameRef.current?.resumeRun()}>Resume run</button>
          <button onClick={() => gameRef.current?.discardRun()}>New run</button>
        </div>
      )}

      {hud?.gameOver && hud.runs && <RunLog runs={hud.runs} />}
      <div className="build-stamp">{BUILD_STAMP}</div>
      {hud?.gameOver && (
        <div className={'panel center report' + (hud.runs ? ' beside-log' : '')}>
          <h1>Fleet destroyed</h1>
          <p>
            Best fleet value: {hud.maxFleetSize} · Survived: {formatTime(hud.time)} · Waves: {hud.wave}
          </p>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Ships</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Destroyed</td>
                <td>{hud.stats.kills}</td>
                <td>{hud.stats.killValue}</td>
              </tr>
              <tr>
                <td>Lost</td>
                <td>{hud.stats.losses}</td>
                <td>{hud.stats.lossValue}</td>
              </tr>
            </tbody>
          </table>
          <p className="report-items">
            Items collected: {hud.stats.itemsCollected} · Merges: {hud.stats.merges}
          </p>
          <FleetGraph points={hud.history} waves={hud.wave} />
          <KillChart bySource={hud.stats.killsBySource} />
          <button onClick={() => gameRef.current?.restart()}>Play again (R)</button>
        </div>
      )}
      {/* CRT screen effect over the HUD and menus too (Settings → Screen effect). Last, so it covers everything. */}
      {hud && <CrtOverlay />}
    </>
  );
}

/** Width of the report panel's content (the panel is 480 wide with 28 padding each side); the graph fills it. */
const GRAPH_WIDTH = 424;

/**
 * Line chart of fleet value over the run: one point at the start of each wave.
 * A faint line every 100 fleet value; a tick every 5th wave, with labels near
 * a quarter, half and three quarters of the run (multiples of 5 only).
 */
function FleetGraph({ points, waves }: { points: HistoryPoint[]; waves: number }) {
  const W = GRAPH_WIDTH;
  const H = 140;
  const pad = { left: 34, right: 8, top: 8, bottom: 22 };
  const maxT = Math.max(1, ...points.map((p) => p.time));
  const maxV = Math.max(1, ...points.map((p) => p.value));
  const x = (t: number) => pad.left + (t / maxT) * (W - pad.left - pad.right);
  const y = (v: number) => H - pad.bottom - (v / maxV) * (H - pad.top - pad.bottom);
  const line = points.map((p) => `${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  // Value lines every 100 (or a bigger round step if there would be more than 20).
  const step = [100, 500, 1000, 5000, 10000, 50000, 100000].find((s) => maxV / s <= 20) ?? 1e6;
  const valueLines: number[] = [];
  for (let v = step; v < maxV; v += step) valueLines.push(v);
  // Every 5th wave, placed at the time it started.
  const waveStart = new Map<number, number>();
  for (const p of points) if (p.wave > 0 && !waveStart.has(p.wave)) waveStart.set(p.wave, p.time);
  const ticks = [...waveStart.entries()].filter(([w]) => w % 5 === 0);
  const labelled = new Set([0.25, 0.5, 0.75].map((f) => Math.floor((waves * f) / 5) * 5).filter((w) => w > 0));
  return (
    <div className="graph">
      <div className="hint">Fleet value over time</div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {valueLines.map((v) => (
          <line key={v} x1={pad.left} y1={y(v)} x2={W - pad.right} y2={y(v)} className="grid" />
        ))}
        {ticks.map(([w, t]) => (
          <g key={w}>
            <line x1={x(t)} y1={y(0)} x2={x(t)} y2={y(0) + 4} className="axis" />
            {labelled.has(w) && (
              <text x={x(t)} y={y(0) + 14} textAnchor="middle">
                {w}
              </text>
            )}
          </g>
        ))}
        <line x1={pad.left} y1={y(0)} x2={W - pad.right} y2={y(0)} className="axis" />
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={y(0)} className="axis" />
        <text x={pad.left - 4} y={pad.top + 4} textAnchor="end">
          {maxV}
        </text>
        <text x={pad.left - 4} y={y(0)} textAnchor="end">
          0
        </text>
        <text x={W - pad.right} y={H - 2} textAnchor="end">
          {formatTime(maxT)}
        </text>
        <text x={pad.left} y={H - 2} textAnchor="start">
          wave
        </text>
        <polyline points={line} className="line" />
      </svg>
    </div>
  );
}
