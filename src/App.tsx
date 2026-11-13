import { useEffect, useRef, useState } from 'react';
import { Assets } from './engine/assets';
import { Sounds } from './engine/sound';
import { CONFIG } from './game/config';
import { Game, TEST_KEYS_ENABLED, type HudInfo } from './game/Game';
import type { HistoryPoint } from './game/world';
import { CardScreen } from './CardScreen';
import { BottomHud } from './BottomHud';
import { EquipmentScreen, FoundToast } from './EquipmentScreen';

const formatTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the art, then start the game. Stop it when the page closes.
  useEffect(() => {
    let cancelled = false;
    Promise.all([Assets.load(), Sounds.load(CONFIG.audio.masterVolume)])
      .then(([assets, sounds]) => {
        if (cancelled || !canvasRef.current) return;
        const game = new Game(canvasRef.current, assets, sounds, setHud);
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

      {hud && (
        <div className="top-bar">
          <div>WASD move · Shift boost · Space dash · mouse aim · click fire · Q auto-fire · right-click defend · Esc pause & equipment · fly into wrecks to recruit</div>
          {TEST_KEYS_ENABLED && (
            <div>
              Test keys: = / - add/remove ship · ] add 16 ships · G invincible {hud.invincible ? '(ON)' : '(off)'} · K destroy enemies on
              screen · X end run · L level up · J all skills · I drop items · E spawn elite · O elites {hud.elitesEnabled ? '(ON)' : '(off)'}
            </div>
          )}
        </div>
      )}

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

      {hud && !hud.gameOver && !hud.paused && <BottomHud hud={hud} game={gameRef.current} />}
      {hud?.cards && !hud.gameOver && <CardScreen hud={hud} game={gameRef.current} />}

      {hud?.paused && <EquipmentScreen hud={hud} game={gameRef.current} />}
      {hud && !hud.gameOver && !hud.paused && <FoundToast hud={hud} />}
      {hud?.eliteAlert && !hud.gameOver && <div className="elite-toast">Elite incoming!</div>}

      {hud?.gameOver && (
        <div className="panel center report">
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
          <FleetGraph points={hud.history} />
          <button onClick={() => gameRef.current?.restart()}>Play again (R)</button>
        </div>
      )}
    </>
  );
}

/** Line chart of fleet value over the run: one point at the start of each wave. */
function FleetGraph({ points }: { points: HistoryPoint[] }) {
  const W = 320;
  const H = 120;
  const pad = { left: 34, right: 8, top: 8, bottom: 18 };
  const maxT = Math.max(1, ...points.map((p) => p.time));
  const maxV = Math.max(1, ...points.map((p) => p.value));
  const x = (t: number) => pad.left + (t / maxT) * (W - pad.left - pad.right);
  const y = (v: number) => H - pad.bottom - (v / maxV) * (H - pad.top - pad.bottom);
  const line = points.map((p) => `${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <div className="graph">
      <div className="hint">Fleet value over time</div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <line x1={pad.left} y1={y(0)} x2={W - pad.right} y2={y(0)} className="axis" />
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={y(0)} className="axis" />
        <text x={pad.left - 4} y={pad.top + 4} textAnchor="end">
          {maxV}
        </text>
        <text x={pad.left - 4} y={y(0)} textAnchor="end">
          0
        </text>
        <text x={W - pad.right} y={H - 4} textAnchor="end">
          {formatTime(maxT)}
        </text>
        <polyline points={line} className="line" />
      </svg>
    </div>
  );
}
