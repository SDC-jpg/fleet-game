// The merge drawer's three slots: which inventory items are placed in them,
// and which items can still join (the same rarity and "+N" as the first one).
// The game checks the same rule again when merging (mergeItems in equipment.ts).

import { useState } from 'react';
import type { ItemInfo } from '../game/Game';

export const MERGE_SLOTS = 3;

export function useMergeSlots(inventory: ItemInfo[]) {
  const [ids, setIds] = useState<(number | null)[]>(() => Array(MERGE_SLOTS).fill(null));
  // Items that left the inventory (merged, equipped...) leave their slot too.
  const slots = ids.map((id) => (id === null ? null : (inventory.find((it) => it.id === id) ?? null)));
  const first = slots.find((it) => it) ?? null;

  /** Whether an item may go into a slot now (always, while the slots are empty). */
  const fits = (it: ItemInfo) => !first || (it.rarity === first.rarity && it.plus === first.plus);
  const isPlaced = (id: number) => slots.some((it) => it?.id === id);

  /** Put an item into a slot (or the first free one). Returns false if it doesn't fit or there's no room. */
  const place = (it: ItemInfo, slot?: number) => {
    if (!fits(it) || isPlaced(it.id)) return false;
    const target = slot !== undefined && slots[slot] === null ? slot : slots.findIndex((s) => s === null);
    if (target < 0) return false;
    setIds(slots.map((s, i) => (i === target ? it.id : (s?.id ?? null))));
    return true;
  };
  const remove = (id: number) => setIds(slots.map((s) => (s && s.id !== id ? s.id : null)));
  const clear = () => setIds(Array(MERGE_SLOTS).fill(null));

  return { slots, first, fits, isPlaced, place, remove, clear, full: slots.every((s) => s) };
}
