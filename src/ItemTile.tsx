// One item square (equipment slots, inventory, merge slots) and the hover
// tooltip it shows. Shared by the equipment screen and the merge drawer.

import type { Game, ItemInfo } from './game/Game';
import { SpriteIcon } from './CardScreen';
import { borderLook } from './rarityLook';
import type { Tip } from './itemTip';

/**
 * One square: an item icon with a rarity-coloured border, an empty slot, or a
 * locked one. Without onDown/onRight it can't be dragged or clicked (locked).
 */
export function Tile({
  item,
  game,
  className,
  slot,
  mergeSlot,
  onDown,
  onRight,
  onTip,
  tip,
}: {
  item: ItemInfo | null;
  game: Game | null;
  className: string;
  /** Equipment slot number (a drop target). */
  slot?: number;
  /** Merge slot number (a drop target while the merge drawer is open). */
  mergeSlot?: number;
  onDown?: () => void;
  onRight?: () => void;
  onTip: (t: Tip | null) => void;
  tip: Tip | null;
}) {
  const look = item ? borderLook(item) : null;
  return (
    <div
      className={`tile ${className} ${look?.className ?? ''}`}
      data-slot={slot}
      data-merge-slot={mergeSlot}
      style={look?.style}
      onMouseDown={(e) => {
        if (e.button === 0 && item && onDown) {
          e.preventDefault(); // no text selection while dragging
          onDown();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onRight?.();
      }}
      onMouseEnter={() => onTip(tip)}
      onMouseLeave={() => onTip(null)}
    >
      {item && <SpriteIcon game={game} name={item.icon} size={32} />}
      {item && item.plus > 0 && <span className="plus">+{item.plus}</span>}
    </div>
  );
}
