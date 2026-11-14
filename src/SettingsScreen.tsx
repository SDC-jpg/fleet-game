// Settings (a tab of the pause screen): General settings, and the card index
// (every level-up card the game can offer, each upgrade's rarities stacked).

import { useMemo, useState } from 'react';
import type { Game, HudInfo } from './game/Game';
import { cardIndex } from './game/progress';
import { CardView } from './CardView';

/** How far each card in a stack sits from the one before it (pixels). */
const STACK_X = 9;
const STACK_Y = 7;

type Tab = 'general' | 'cards';
/** The open tab, remembered while the page is open. */
const view: { tab: Tab } = { tab: 'general' };

export function SettingsScreen({ hud, game }: { hud: HudInfo; game: Game | null }) {
  const [tab, setTab] = useState(view.tab);
  view.tab = tab;
  return (
    <div className="settings">
      <div className="chips tabs">
        <button className={tab === 'general' ? 'on' : ''} onClick={() => setTab('general')}>
          General
        </button>
        <button className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>
          Card index
        </button>
      </div>
      {tab === 'general' ? <General hud={hud} game={game} /> : <CardIndex game={game} />}
    </div>
  );
}

function General({ hud, game }: { hud: HudInfo; game: Game | null }) {
  return (
    <div className="settings-general">
      <label className="setting">
        <input type="checkbox" checked={hud.cursorLock} onChange={(e) => game?.setCursorLock(e.target.checked)} />
        <span>
          <b>Keep the mouse inside the game</b>
          <span className="note">
            For several monitors: the cursor can't wander onto another screen while you play. It locks when you click the game and
            is released on menus. Esc frees it (and pauses).
          </span>
        </span>
      </label>
    </div>
  );
}

/** Every card, grouped. Upgrades show all their rarities as a stack (hover one to bring it forward). */
function CardIndex({ game }: { game: Game | null }) {
  const sections = useMemo(() => cardIndex(), []);
  return (
    <div className="card-index">
      {sections.map((s) => (
        <section key={s.section}>
          <h2>{s.section}</h2>
          <div className="card-groups">
            {s.groups.map((g) => (
              <div key={g.title} className="card-group">
                <div className="group-title">{g.title}</div>
                <div className="card-stack" style={{ width: 150 + (g.cards.length - 1) * STACK_X, height: 210 + (g.cards.length - 1) * STACK_Y }}>
                  {g.cards.map((c, i) => (
                    <div key={i} className="stacked" style={{ left: i * STACK_X, top: i * STACK_Y, zIndex: i }}>
                      <CardView card={c} game={game} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
