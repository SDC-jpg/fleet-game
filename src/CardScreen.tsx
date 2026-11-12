// The level-up screen: a few cards to choose from (click one, or press its number).

import { useEffect, useRef } from 'react';
import type { Game, HudInfo } from './game/Game';

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
  return (
    <div className="card-screen">
      <h1>Level {hud.level}!</h1>
      <div className="hint">Choose one (click, or press its number)</div>
      <div className="cards">
        {hud.cards.map((c, i) => (
          <button
            key={i}
            className="card"
            onClick={(e) => {
              game?.pickCard(i);
              e.currentTarget.blur(); // so Space doesn't press it again
            }}
          >
            <span className="number">{i + 1}</span>
            <SpriteIcon game={game} name={c.icon} size={64} />
            <span className="label">{c.label}</span>
            <span className="title">{c.title}</span>
            <span className="text">{c.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
