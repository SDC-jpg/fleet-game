// Settings (a tab of the pause screen): General settings, and the card index
// (every level-up card the game can offer, by type, each skill with its
// upgrades' rarities stacked beside it). The card index widens the pause screen.

import { useEffect, useMemo, useState } from 'react';
import { TEST_KEYS_ENABLED, type Game, type HudInfo } from './game/Game';
import { IS_TOUCH_DEVICE } from './engine/touch';
import { cardIndex } from './game/progress';
import { CardView } from './CardView';
import type { CrtParams } from './engine/crt';

/** A card's width in the card index (pixels; matches .card-index .card). */
const CARD_W = 150;

type Tab = 'general' | 'screen' | 'cards';
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
        <button className={tab === 'screen' ? 'on' : ''} onClick={() => setTab('screen')}>
          Screen effect
        </button>
        <button className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>
          Card index
        </button>
        {/* In the header so it stays in view while the cards scroll. */}
        {tab === 'cards' && TEST_KEYS_ENABLED && (
          <span className="note dev-note">Dev: click a card to get it now{taken && ` · Got: ${taken}`}</span>
        )}
      </div>
      {tab === 'general' ? (
        <General hud={hud} game={game} />
      ) : tab === 'screen' ? (
        <ScreenEffect hud={hud} game={game} />
      ) : (
        <CardIndex game={game} onTaken={setTaken} />
      )}
    </div>
  );
}

function General({ hud, game }: { hud: HudInfo; game: Game | null }) {
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState(false);
  return (
    <div className="settings-general">
      <label className="setting">
        <input type="checkbox" checked={hud.crt.params.enabled} onChange={(e) => game?.setCrt({ enabled: e.target.checked })} />
        <span>
          <b>Screen effect (old CRT screen)</b>
          <span className="note">Glow, colour fringes, curved glass and colour stripes. Change its look in the Screen effect tab.</span>
        </span>
      </label>
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

/** The screen effect's sliders: setting, label, range and step. */
const CRT_SLIDERS: { key: NumericCrt; label: string; min: number; max: number; step: number }[] = [
  { key: 'bloom', label: 'Glow', min: 0, max: 2, step: 0.05 },
  { key: 'bloomRadius', label: 'Glow spread', min: 1, max: 40, step: 1 },
  { key: 'bloomThreshold', label: 'Glow from brightness', min: 0, max: 1, step: 0.05 },
  { key: 'bloomTint', label: 'Glow tint', min: 0, max: 1, step: 0.05 },
  { key: 'aberration', label: 'Colour fringes', min: 0, max: 8, step: 0.25 },
  { key: 'curvature', label: 'Curved glass', min: 0, max: 0.3, step: 0.01 },
  { key: 'mask', label: 'Colour stripes', min: 0, max: 1, step: 0.05 },
  { key: 'maskSize', label: 'Stripe size', min: 0.5, max: 6, step: 0.25 },
  { key: 'scanlines', label: 'Scanlines', min: 0, max: 1, step: 0.05 },
  { key: 'vignette', label: 'Dark corners', min: 0, max: 1, step: 0.05 },
  { key: 'blackLift', label: 'Lifted blacks', min: 0, max: 1, step: 0.05 },
  { key: 'softness', label: 'Softness', min: 0, max: 1, step: 0.05 },
  { key: 'noise', label: 'Grain', min: 0, max: 0.3, step: 0.01 },
  { key: 'flicker', label: 'Flicker', min: 0, max: 0.2, step: 0.01 },
  { key: 'rollBand', label: 'Rolling band', min: 0, max: 0.3, step: 0.01 },
];
type NumericCrt = { [K in keyof CrtParams]: CrtParams[K] extends number ? K : never }[keyof CrtParams];

/** Settings → Screen effect: one switch for the whole effect, "over the HUD too", and a slider per part. */
function ScreenEffect({ hud, game }: { hud: HudInfo; game: Game | null }) {
  const { params: p, supported } = hud.crt;
  return (
    <div className="settings-general screen-effect">
      <div className="setting">
        <button className={'crt-switch' + (p.enabled ? ' on' : '')} onClick={() => game?.setCrt({ enabled: !p.enabled })}>
          Screen effect: {p.enabled ? 'On' : 'Off'}
        </button>
        <span className="note">
          {supported ? 'An old CRT screen look: glow, colour fringes, curved glass, colour stripes.' : "This browser can't draw the effect (WebGL 2 isn't available)."}
        </span>
      </div>
      <div className={p.enabled ? '' : 'crt-off'}>
        <label className="setting">
          <input type="checkbox" checked={p.hud} onChange={(e) => game?.setCrt({ hud: e.target.checked })} />
          <span>
            <b>Also over the HUD and menus</b>
            <span className="note">Colour stripes, dark corners and a glow on text. Off = only the game view.</span>
          </span>
        </label>
        <div className="crt-sliders">
          {CRT_SLIDERS.map((s) => (
            <label key={s.key} className="crt-slider">
              <span>{s.label}</span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={p[s.key]}
                onChange={(e) => game?.setCrt({ [s.key]: Number(e.target.value) })}
              />
              <span className="value">{p[s.key]}</span>
            </label>
          ))}
        </div>
        <button onClick={() => game?.resetCrt()}>Reset to defaults</button>
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
