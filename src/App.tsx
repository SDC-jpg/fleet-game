import { useEffect, useRef, useState } from 'react';
import { Assets } from './engine/assets';
import { Sounds } from './engine/sound';
import { CONFIG } from './game/config';
import { Game, TEST_KEYS_ENABLED, type FlagshipInfo, type HudInfo } from './game/Game';
import type { HistoryPoint } from './game/world';
import { ShopScreen } from './ShopScreen';

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
        <div className="hud">
          <div>FPS: {hud.fps}</div>
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
          <div className="hint">
            WASD move · Shift boost · Space dash · mouse aim · click fire · right-click ability · wheel switch ship · Esc
            pause · fly into wrecks to recruit
          </div>
          {TEST_KEYS_ENABLED && (
            <div className="hint">
              Test keys: = / - add/remove ship · 1 2 3 add Lancer/Knight/Ballista · ] add 16 ships · G invincible {hud.invincible ? '(ON)' : '(off)'} · K destroy
              enemies on screen · X end run · E spawn elite · B body shop · C +100 scrap
            </div>
          )}
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

      {hud?.shop && <ShopScreen shop={hud.shop} game={gameRef.current} />}

      {hud && !hud.gameOver && !hud.shop && (
        <div className="bottom-hud">
          <RunPanel hud={hud} />
          {hud.flagship && <FlagshipPanel ship={hud.flagship} hud={hud} game={gameRef.current} />}
        </div>
      )}

      {hud?.paused && (
        <div className="panel center">
          <h1>Paused</h1>
          <button
            onClick={(e) => {
              gameRef.current?.setPaused(false);
              e.currentTarget.blur();
            }}
          >
            Resume (Esc)
          </button>
        </div>
      )}

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

/** Bottom-left panel: how the run is going. */
function RunPanel({ hud }: { hud: HudInfo }) {
  return (
    <div className="hud-panel run-panel">
      <div className="title">Run</div>
      <Row label="Fleet" value={`${hud.fleetSize}`} note={hud.fleetMix} />
      <Row label="Best" value={`${hud.maxFleetSize}`} />
      <Row label="Wave" value={`${hud.wave}`} note={formatTime(hud.time)} />
      <Row label="Destroyed" value={`${hud.stats.kills}`} note={`value ${hud.stats.killValue}`} />
      <Row label="Lost" value={`${hud.stats.losses}`} note={`value ${hud.stats.lossValue}`} />
      <Row label="Scrap" value={`${hud.scrap}`} />
      {hud.shopLeavesIn !== null && (
        <div className="row shop-row">
          <span className="label">Body shop</span>
          <span className="value">{Math.ceil(hud.shopLeavesIn)}s</span>
          <span className="note">follow the green arrow</span>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="row">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {note && <span className="note">{note}</span>}
    </div>
  );
}

/** A thin bar filled to `fraction` (0–1). */
function Bar({ fraction, color }: { fraction: number; color: string }) {
  return (
    <div className="bar">
      <div style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, background: color }} />
    </div>
  );
}

const cooldownText = (t: number) => (t > 0 ? `${Math.ceil(t)} s` : 'ready');

/** Bottom panel: the ship you fly, with its picture, build, health and abilities. */
function FlagshipPanel({ ship, hud, game }: { ship: FlagshipInfo; hud: HudInfo; game: Game | null }) {
  const portrait = useRef<HTMLCanvasElement>(null);
  // The picture only changes when you fly another ship or it grows a tier.
  useEffect(() => {
    if (portrait.current) game?.drawPortrait(portrait.current);
  }, [game, ship.key]);
  const ab = ship.ability;
  return (
    <div className="hud-panel flagship-panel">
      <canvas ref={portrait} width={112} height={112} className="portrait" />
      <div className="details">
        <div className="title">
          T{ship.tier} {ship.className}
          {ship.combo && <span className="combo"> · {ship.combo}</span>}
        </div>
        {ship.classes.map((c) => (
          <div className="row" key={c.name}>
            <span className="label" style={{ color: c.color }}>
              {c.name}
            </span>
            <Bar fraction={c.share} color={c.color} />
            <span className="value">{c.count}</span>
            {c.rare > 0 && <span className="rare">{c.rare} rare</span>}
          </div>
        ))}
        <div className="row">
          <span className="label">Health</span>
          <Bar fraction={ship.hp / ship.maxHp} color="#7fe07f" />
          <span className="value">{Math.max(0, Math.ceil(ship.hp))}</span>
        </div>
        {ab && (
          <div className="row">
            <span className="label">{ab.name}</span>
            <Bar fraction={ab.total > 0 ? 1 - ab.cooldown / ab.total : 1} color="#9fd3ff" />
            <span className="value">{cooldownText(ab.cooldown)}</span>
          </div>
        )}
        <div className="row">
          <span className="label">Dash</span>
          <Bar fraction={1 - hud.dashCooldown / CONFIG.dash.cooldown} color="#9fd3ff" />
          <span className="value">{cooldownText(hud.dashCooldown)}</span>
        </div>
        <div className="foot">
          {ab && 'Right-click: ' + ab.name}
          {ship.autoAbilities.length > 0 && ` · auto: ${ship.autoAbilities.join(', ')}`}
          {hud.switchable > 1 && ` · wheel: switch (${hud.switchable})`}
        </div>
      </div>
    </div>
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
