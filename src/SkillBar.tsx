// The skill bar at the bottom of the screen: your skills' icons, grouped by
// mouse button. An icon is dark while its skill recharges and fills back up
// from the bottom; dots under it show its rank.

import { CONFIG } from './game/config';
import type { Game, HudInfo } from './game/Game';
import { SpriteIcon } from './CardScreen';

export function SkillBar({ hud, game }: { hud: HudInfo; game: Game | null }) {
  if (!hud.skills.length) return null;
  return (
    <div className="skill-bar">
      {(['left', 'right'] as const).map((side) => {
        const list = hud.skills.filter((sk) => sk.side === side);
        if (!list.length) return null;
        return (
          <div key={side} className="skill-group">
            <div className="skill-group-label">{side === 'left' ? 'Left click' : 'Right click'}</div>
            <div className="skill-row">
              {list.map((sk) => {
                const ready = sk.total > 0 ? 1 - sk.cooldown / sk.total : 1;
                return (
                  <div key={sk.id} className={'skill-slot' + (ready >= 1 ? ' ready' : '')} title={sk.name}>
                    <SpriteIcon game={game} name={sk.icon} size={40} />
                    {/* Dark cover over the part that's still recharging. */}
                    <div className="cooldown" style={{ height: `${(1 - Math.min(1, ready)) * 100}%` }} />
                    <div className="pips">
                      {Array.from({ length: CONFIG.cards.maxRank }, (_, i) => (
                        <span key={i} className={i < sk.rank ? 'on' : ''} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
