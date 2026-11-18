// The level-up screen: a few cards to choose from (click one, or press its number).

import { useEffect, useRef } from 'react';
import type { Game, HudInfo } from './game/Game';
import { CardView } from './CardView';

/** One sprite from the manifest, drawn crisply into a small canvas. */
export function SpriteIcon({ game, name, size }: { game: Game | null; name: string; size: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) game?.drawIcon(canvas.current, name);
  }, [game, name]);
  return <canvas ref={canvas} width={size} height={size} className="sprite-icon" style={{ width: size, height: size }} />;
}

export function CardScreen({ hud, game }: { hud: HudInfo; game: Game | null }) {
  if (!hud.cards) return null;
  const r = hud.replacing;
  return (
    <div className="card-screen">
      <h1>Level {hud.level}!</h1>
      <div className="hint">Choose one (click, or press its number)</div>
      <div className="cards">
        {hud.cards.map((c, i) => (
          <CardView
            key={i}
            card={c}
            game={game}
            number={i + 1}
            className={r ? (r.card === i ? 'replace-pick' : 'replace-other') : ''}
            onPick={() => game?.pickCard(i)}
          />
        ))}
      </div>
      {/* A full weapon or defence slot: picking a new skill asks before replacing yours. */}
      {r && (
        <div className="replace-confirm">
          <div>
            Replace <b>{r.old}</b> (rank {r.rank}) with <b>{r.name}</b>?
          </div>
          <div className="hint">{r.old} keeps its rank and upgrades: pick it again later and it comes back as it is.</div>
          <div className="replace-buttons">
            <button className="replace-yes" onClick={() => game?.pickCard(r.card, true)}>
              Replace <span className="key">Enter</span>
            </button>
            <button onClick={() => game?.cancelReplace()}>
              Keep {r.old} <span className="key">Backspace</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
