import { useEffect, useRef, useState } from 'react';
import { Assets } from './engine/assets';
import { Game, TEST_KEYS_ENABLED, type HudInfo } from './game/Game';

const formatTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the art, then start the game. Stop it when the page closes.
  useEffect(() => {
    let cancelled = false;
    Assets.load()
      .then((assets) => {
        if (cancelled || !canvasRef.current) return;
        const game = new Game(canvasRef.current, assets, setHud);
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
          <div>
            Fleet: {hud.fleetSize} <span className="hint">({hud.fleetMix})</span>
          </div>
          <div>Best: {hud.maxFleetSize}</div>
          <div>Wave: {hud.wave}</div>
          <div>Time: {formatTime(hud.time)}</div>
          <div>FPS: {hud.fps}</div>
          <div className="hint">WASD move · Shift boost · mouse aim · click/space fire · fly into wrecks to recruit</div>
          {TEST_KEYS_ENABLED && (
            <div className="hint">
              Test keys: = / - add/remove ship · ] add 16 ships · G invincible {hud.invincible ? '(ON)' : '(off)'} · K destroy
              enemies on screen
            </div>
          )}
          {hud.assetProblems.length > 0 && (
            <div className="warn">
              Art problems:
              {hud.assetProblems.map((p) => (
                <div key={p}>· {p}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {hud?.gameOver && (
        <div className="panel center">
          <h1>Fleet destroyed</h1>
          <p>Best fleet value: {hud.maxFleetSize}</p>
          <p>Survived: {formatTime(hud.time)}</p>
          <button onClick={() => gameRef.current?.restart()}>Play again (R)</button>
        </div>
      )}
    </>
  );
}
