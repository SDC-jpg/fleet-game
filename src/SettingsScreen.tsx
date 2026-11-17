// Settings (a tab of the pause screen): General settings, and the card index
// (every level-up card the game can offer, by type, each skill with its
// upgrades' rarities stacked beside it). The card index widens the pause screen.

import { useEffect, useMemo, useState } from 'react';
import { TEST_KEYS_ENABLED, type Game, type HudInfo } from './game/Game';
import { IS_TOUCH_DEVICE } from './engine/touch';
import { cardIndex } from './game/progress';
import { CardView } from './CardView';

/** A card's width in the card index (pixels; matches .card-index .card). */
const CARD_W = 150;

type Tab = 'general' | 'cards';
/** The open tab, remembered while the page is open. */
const view: { tab: Tab } = { tab: 'general' };

/** `onWide`: told when the card index opens or closes (the pause screen widens for it). */
export function SettingsScreen({ hud, game, onWide }: { hud: HudInfo; game: Game | null; onWide?: (wide: boolean) => void }) {
  const [tab, setTab] = useState(view.tab);
  view.tab = tab;
  /** Dev only: the last card taken from the card index (shown so a click visibly did something). */
  const [taken, setTaken] = useState('');
  useEffect(() => {
    onWide?.(tab === 'cards');
    return () => onWide?.(false);
  }, [tab, onWide]);
  return (
    <div className="settings">
      <div className="chips tabs">
        <button className={tab === 'general' ? 'on' : ''} onClick={() => setTab('general')}>
          General
        </button>
        <button className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>
          Card index
        </button>
        {/* In the header so it stays in view while the cards scroll. */}
        {tab === 'cards' && TEST_KEYS_ENABLED && (
          <span className="note dev-note">Dev: click a card to get it now{taken && ` · Got: ${taken}`}</span>
        )}
      </div>
      {tab === 'general' ? <General hud={hud} game={game} /> : <CardIndex game={game} onTaken={setTaken} />}
    </div>
  );
}

function General({ hud, game }: { hud: HudInfo; game: Game | null }) {
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState(false);
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
      <label className="setting">
        <input type="checkbox" checked={hud.commanderLines} onChange={(e) => game?.setCommanderLines(e.target.checked)} />
        <span>
          <b>Commander view: targeting lines</b>
          <span className="note">With big fleets, small ships show as symbols. This draws a faint line from each one toward what it's aiming at.</span>
        </span>
      </label>
      <label className="setting">
        <input type="checkbox" checked={hud.commanderShots} onChange={(e) => game?.setCommanderShots(e.target.checked)} />
        <span>
          <b>Commander view: show symbol ships' shots</b>
          <span className="note">Draws the shots of ships shown as symbols (as small HUD shots). Turn off for a calmer screen.</span>
        </span>
      </label>
      {IS_TOUCH_DEVICE && (
        <label className="setting">
          <input type="checkbox" checked={hud.leftHanded} onChange={(e) => game?.setLeftHanded(e.target.checked)} />
          <span>
            <b>Left-handed controls</b>
            <span className="note">Swaps the sides of the on-screen controls: thumbstick on the right, buttons on the left.</span>
          </span>
        </label>
      )}
      <div className="setting danger">
        <span>
          <b>Clear saved progress</b>
          <span className="note">
            Deletes all your items, equipped slots, unlocked slot tiers, your loot count, the Merge Module and your lifetime statistics, in this browser. Your
            run log and settings stay. This can't be undone.
          </span>
          <span className="clear-buttons">
            {cleared ? (
              <span className="note">Saved progress cleared.</span>
            ) : confirming ? (
              <>
                <button
                  className="danger-button"
                  onClick={() => {
                    game?.clearProgress();
                    setConfirming(false);
                    setCleared(true);
                  }}
                >
                  Yes, delete everything
                </button>
                <button onClick={() => setConfirming(false)}>Cancel</button>
              </>
            ) : (
              <button onClick={() => setConfirming(true)}>Clear saved progress…</button>
            )}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Every card, by type (a line between types). Each skill with upgrades gets one row, one card
 * tall: its card, then its upgrade stacks sharing the rest of the row, each fanning its rarities
 * sideways to fill its share (hover one to bring it forward). Skills with no upgrades (and fleet
 * bonuses) sit side by side.
 */
function CardIndex({ game, onTaken }: { game: Game | null; onTaken: (name: string) => void }) {
  const sections = useMemo(() => cardIndex(), []);
  return (
    <div className="card-index">
      {sections.map((s) => (
        <section key={s.section}>
          <h2>{s.section}</h2>
          <div className="card-families">
            {s.families.map((f) => (
              <div key={f.title} className={'card-family' + (f.groups.length > 1 ? ' has-upgrades' : '')}>
                {f.groups.map((g) => (
                  <div key={g.title} className={'card-group' + (g.cards.length > 1 ? ' spread' : '')}>
                    <div className="group-title">{g.title}</div>
                    <div className="card-stack">
                      {g.cards.map((c, i) => (
                        <div
                          key={i}
                          className="stacked"
                          // Fanned out across the stack's width: first card at the left edge, last at the right.
                          style={{ left: g.cards.length > 1 ? `calc((100% - ${CARD_W}px) * ${i / (g.cards.length - 1)})` : 0, zIndex: i }}
                        >
                          <CardView
                            card={c}
                            game={game}
                            outline
                            onPick={
                              TEST_KEYS_ENABLED
                                ? () => {
                                    game?.debugGiveCard(c.card);
                                    onTaken(`${c.title}${c.card.kind === 'rank' ? ` (${c.card.rarity})` : ''}`);
                                  }
                                : undefined
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
