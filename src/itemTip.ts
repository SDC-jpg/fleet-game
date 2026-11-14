// Item tooltips and the item square's size (shared by the equipment screen and the merge drawer).

import type { ItemInfo } from './game/Game';

export const TILE = 36;

/** A tooltip: a title in a rarity colour (holographic for Mythic) and some lines. */
export type Tip = { title: string; color: string; holo?: boolean; lines: string[] };

export function itemTip(item: ItemInfo, extra?: string): Tip {
  return { title: item.name, color: item.color, holo: item.holo, lines: [item.bonus, ...item.extra, ...(extra ? [extra] : [])] };
}
