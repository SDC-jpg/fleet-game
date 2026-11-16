// The merge drawer: slides out on the left of the equipment screen. Three
// slots take items of the same rarity and "+N" (right-click or drag them in
// from the inventory; right-click a slot to take one back). Merging gives one
// random item of the next rarity up, or for Mythic items, a Mythic one "+N"
// higher (its bonuses × 1 + 0.1 × N).
//
// Upgrades (dropped after looting enough items, see CONFIG.items):
// - Mk. II: the button reads "Load" until the slots are full: it fills them
//   with the 3 lowest-rarity items that can merge, one by one, then turns back
//   into "Merge".
// - Mk. III: "QuickMerge" loads and merges in one click. A gear left of it
//   slides the drawer over to its settings: which rarities it may use, listed
//   in the order they're used (▲▼ flips least rare first / rarest first).
// - Mk. IV: "AutoMerge" switches merging by itself on and off (every
//   CONFIG.items.autoMergeEvery seconds; the button fills up meanwhile).

import { forwardRef, useState } from 'react';
import { CONFIG, RARITIES, RARITY_ORDER, type Rarity } from '../game/config';
import type { Game, ItemInfo } from '../game/Game';
import { MERGE_COUNT, pickMergeSet, type MergeOrder } from '../game/equipment';
import { Tile } from '../ItemTile';
import { itemTip, type Tip } from '../itemTip';
import { textLook } from '../rarityLook';

/** What merging these items gives, in words, and its rarity's look. */
function mergeResult(first: ItemInfo) {
  const tier = RARITY_ORDER.indexOf(first.rarity);
  if (tier === RARITY_ORDER.length - 1) {
    const plus = first.plus + 1;
    const r = RARITIES[first.rarity];
    return { text: `A random +${plus} ${r.name} item`, note: `Bonuses ×${(1 + CONFIG.items.plusBonus * plus).toFixed(1)}`, look: r };
  }
  const r = RARITIES[RARITY_ORDER[tier + 1]];
  return { text: `A random ${r.name} item`, note: '', look: r };
}

export interface MergeDrawerProps {
  game: Game | null;
  /** 1 = Merge Module, 2 = Mk. II, 3 = Mk. III, 4 = Mk. IV. */
  level: number;
  name: string;
  slots: (ItemInfo | null)[];
  full: boolean;
  /** Inventory items not in the slots (what Load / QuickMerge pick from). */
  free: ItemInfo[];
  /** Rarities QuickMerge and AutoMerge may use. */
  allow: Rarity[];
  /** QuickMerge and AutoMerge use the least rare items first ('low') or the rarest ('high'). */
  order: MergeOrder;
  autoMerge: boolean;
  /** How far along the next AutoMerge is (0–1). */
  autoProgress: number;
  /** The item the last merge made (shown until the next one). */
  made: ItemInfo | null;
  onRemove: (id: number) => void;
  onMerge: () => void;
  /** Fill the free slots with these items, one every `delayMs`; then `done`. */
  onFill: (items: ItemInfo[], delayMs: number, done: () => void) => void;
  /** Merge exactly these items (QuickMerge, after filling). */
  onMergeIds: (ids: number[]) => void;
  onTip: (t: Tip | null) => void;
  style?: React.CSSProperties;
}

export const MergeDrawer = forwardRef<HTMLDivElement, MergeDrawerProps>(function MergeDrawer(p, ref) {
  const { game, level, slots, full, free, allow, order, autoMerge, onTip } = p;
  /** Load or QuickMerge in progress (the button waits). */
  const [busy, setBusy] = useState(false);
  /** Mk. III settings view open, and the rarity switches being edited. */
  const [settings, setSettings] = useState(false);
  const [draft, setDraft] = useState<Rarity[]>(allow);
  const [draftOrder, setDraftOrder] = useState<MergeOrder>(order);
  /** What uses the settings (named in their caption). */
  const user = level >= 4 ? 'AutoMerge' : 'QuickMerge';

  const placed = slots.filter((s): s is ItemInfo => !!s);
  const first = placed[0] ?? null;
  const result = first ? mergeResult(first) : null;
  // Load uses any rarity; QuickMerge and AutoMerge only the allowed ones.
  const candidates = level >= 3 ? pickMergeSet(free, MERGE_COUNT - placed.length, allow, first ?? undefined, order) : pickMergeSet(free, MERGE_COUNT - placed.length, undefined, first ?? undefined);

  const load = (quick: boolean) => {
    if (!candidates || busy) return;
    const I = CONFIG.items;
    const delay = (quick ? I.quickMergeDelay : I.mergeLoadDelay) * 1000;
    const ids = [...placed, ...candidates].map((it) => it.id);
    setBusy(true);
    p.onFill(candidates, delay, () => {
      setBusy(false);
      if (quick) p.onMergeIds(ids);
    });
  };

  const toggleSettings = () => {
    // Closing saves the switches.
    if (settings) game?.setMergeAllow(RARITY_ORDER.filter((r) => draft.includes(r)), draftOrder);
    else {
      setDraft(allow);
      setDraftOrder(order);
    }
    setSettings(!settings);
  };

  // The main button: Merge when the slots are full (and nothing's loading), otherwise what this level adds.
  let button: { label: string; enabled: boolean; onClick: () => void; tip?: string; className?: string };
  if (level >= 4 && (autoMerge || !full)) {
    button = {
      label: 'AutoMerge',
      enabled: true,
      onClick: () => game?.setAutoMerge(!autoMerge),
      tip: autoMerge
        ? 'AutoMerge is on: click to stop it.'
        : `Click to merge the ${order === 'high' ? 'rarest' : 'least rare'} allowed items every ${CONFIG.items.autoMergeEvery} seconds.`,
      className: 'auto' + (autoMerge ? ' on' : ''),
    };
  } else if (level >= 2 && (!full || busy)) {
    const quick = level >= 3;
    button = {
      label: quick ? 'QuickMerge' : 'Load',
      enabled: !!candidates && !busy,
      onClick: () => load(quick),
      tip: busy ? undefined : candidates ? undefined : 'Insufficient items',
    };
  } else button = { label: 'Merge', enabled: full, onClick: p.onMerge };

  // With AutoMerge on, the slots show the items it will merge next.
  const preview = level >= 4 && autoMerge ? (pickMergeSet(free, MERGE_COUNT, allow, undefined, order) ?? []) : null;
  const shown = preview ? Array.from({ length: MERGE_COUNT }, (_, i) => preview[i] ?? null) : slots;
  const shownFirst = shown.find((s) => s) ?? null;
  const shownResult = preview ? (shownFirst ? mergeResult(shownFirst) : null) : result;

  return (
    <div ref={ref} className="merge-drawer" style={p.style}>
      <h2>{p.name}</h2>
      <div className="merge-view">
        <div className={'merge-track' + (settings ? ' slid' : '')}>
          {/* Settings (Mk. III and up): which rarities QuickMerge and AutoMerge may use, listed in the order they're used. */}
          <div className="merge-pane merge-settings">
            <div className="merge-order-head">
              <div className="note">{user} will consume in this order, from top to bottom:</div>
              <button
                className="sort-toggle on merge-order"
                onClick={() => setDraftOrder(draftOrder === 'low' ? 'high' : 'low')}
                onMouseEnter={() =>
                  onTip({ title: 'Order', color: '#9aa3bd', lines: [draftOrder === 'low' ? 'Least rare first (click for rarest first)' : 'Rarest first (click for least rare first)'] })
                }
                onMouseLeave={() => onTip(null)}
                aria-label="Flip the order"
              >
                <span className={draftOrder === 'high' ? 'lit' : ''}>▲</span>
                <span className={draftOrder === 'low' ? 'lit' : ''}>▼</span>
              </button>
            </div>
            <div className="merge-allow">
              {(draftOrder === 'high' ? [...RARITY_ORDER].reverse() : RARITY_ORDER).map((r) => (
                <label key={r} style={{ color: RARITIES[r].color }}>
                  <input
                    type="checkbox"
                    checked={draft.includes(r)}
                    onChange={(e) => setDraft(e.target.checked ? [...draft, r] : draft.filter((x) => x !== r))}
                  />
                  {RARITIES[r].name}
                </label>
              ))}
            </div>
          </div>
          <div className="merge-pane">
            <div className="note">
              {preview ? 'AutoMerge will merge these next.' : 'Right-click 3 items of the same rarity to merge them.'}
            </div>
            <div className="merge-slots">
              {shown.map((it, i) => (
                <Tile
                  key={i}
                  mergeSlot={i}
                  item={it}
                  game={game}
                  className={it ? 'filled' : 'empty'}
                  onRight={it && !preview ? () => p.onRemove(it.id) : undefined}
                  onTip={onTip}
                  tip={
                    it
                      ? itemTip(it, preview ? 'Next AutoMerge' : 'Right-click to take it back')
                      : { title: 'Merge slot', color: '#9aa3bd', lines: [preview ? 'Not enough allowed items to merge.' : 'Right-click an inventory item to put it here.'] }
                  }
                />
              ))}
            </div>
            <div className="merge-result">
              {shownResult ? (
                <>
                  ⇩ <span className={textLook(shownResult.look).className} style={textLook(shownResult.look).style}>{shownResult.text}</span>
                  {shownResult.note && <div className="note">{shownResult.note}</div>}
                </>
              ) : (
                <span className="note">Equipped items are locked while merging.</span>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="merge-buttons">
        {level >= 3 && (
          <button
            className={'merge-gear' + (settings ? ' on' : '')}
            onClick={toggleSettings}
            onMouseEnter={() => onTip({ title: settings ? 'Save settings' : 'Settings', color: '#9aa3bd', lines: [settings ? 'Save and go back.' : `Choose which rarities ${user} may use, and in which order.`] })}
            onMouseLeave={() => onTip(null)}
          >
            ⚙
          </button>
        )}
        {/* Wrapped so its tooltip still shows while it's greyed out. */}
        <span
          className="merge-go-wrap"
          onMouseEnter={() => button.tip && onTip({ title: button.label, color: '#9aa3bd', lines: [button.tip] })}
          onMouseLeave={() => onTip(null)}
        >
          <button
            className={'merge-go ' + (button.className ?? '') + (button.enabled ? '' : ' off')}
            aria-disabled={!button.enabled}
            onClick={() => button.enabled && button.onClick()}
          >
            {level >= 4 && autoMerge && <span className="auto-fill" style={{ width: `${Math.min(1, p.autoProgress) * 100}%` }} />}
            <span className="label">{button.label}</span>
          </button>
        </span>
      </div>
      {p.made && (
        <div className="merge-made">
          Made: <span className={textLook(p.made).className} style={textLook(p.made).style}>{p.made.name}</span>
          <div className="note">{[p.made.bonus, ...p.made.extra].join(' · ')}</div>
        </div>
      )}
    </div>
  );
});
