// The merge drawer: slides out on the left of the equipment screen. Three
// slots take items of the same rarity and "+N" (right-click or drag them in
// from the inventory; right-click a slot to take one back). Merging gives one
// random item of the next rarity up, or for Mythic items, a Mythic one "+N"
// higher (its bonuses × 1 + 0.1 × N).

import { forwardRef } from 'react';
import { CONFIG, RARITIES, RARITY_ORDER } from '../game/config';
import type { Game, ItemInfo } from '../game/Game';
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

export const MergeDrawer = forwardRef<
  HTMLDivElement,
  {
    game: Game | null;
    slots: (ItemInfo | null)[];
    full: boolean;
    /** The item the last merge made (shown until the next one). */
    made: ItemInfo | null;
    onRemove: (id: number) => void;
    onMerge: () => void;
    onTip: (t: Tip | null) => void;
    style?: React.CSSProperties;
  }
>(function MergeDrawer({ game, slots, full, made, onRemove, onMerge, onTip, style }, ref) {
  const first = slots.find((s) => s) ?? null;
  const result = first ? mergeResult(first) : null;
  return (
    <div ref={ref} className="merge-drawer" style={style}>
      <h2>Merge Module</h2>
      <div className="note">Right-click 3 items of the same rarity to merge them.</div>
      <div className="merge-slots">
        {slots.map((it, i) => (
          <Tile
            key={i}
            mergeSlot={i}
            item={it}
            game={game}
            className={it ? 'filled' : 'empty'}
            onRight={it ? () => onRemove(it.id) : undefined}
            onTip={onTip}
            tip={it ? itemTip(it, 'Right-click to take it back') : { title: 'Merge slot', color: '#9aa3bd', lines: ['Right-click an inventory item to put it here.'] }}
          />
        ))}
      </div>
      <div className="merge-result">
        {result ? (
          <>
            ⇩ <span className={textLook(result.look).className} style={textLook(result.look).style}>{result.text}</span>
            {result.note && <div className="note">{result.note}</div>}
          </>
        ) : (
          <span className="note">Equipped items are locked while merging.</span>
        )}
      </div>
      <button className="merge-go" disabled={!full} onClick={onMerge}>
        Merge
      </button>
      {made && (
        <div className="merge-made">
          Made: <span className={textLook(made).className} style={textLook(made).style}>{made.name}</span>
          <div className="note">{[made.bonus, ...made.extra].join(' · ')}</div>
        </div>
      )}
    </div>
  );
});
