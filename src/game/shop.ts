// The body shop: what you can do to your ships while docked, and what it costs.
// The game is paused while the shop is open. Like world.ts, nothing is drawn here.

import { CLASS_IDS, CONFIG, type ClassId, type ComboId } from './config';
import { comboOptions } from './abilities';
import { addSound, refreshShip, tierValue, type GameState, type Ship } from './world';

/** One kind of module: its class, and whether it's rare. */
export interface ModuleKind {
  cls: ClassId;
  rare: boolean;
}

/** Everything you can do at the body shop. Ships are named by their id. */
export type ShopAction =
  /** Ship `a` gives one `give` module to ship `b`, and gets one `take` module back. */
  | { kind: 'swap'; a: number; b: number; give: ModuleKind; take: ModuleKind }
  /** One `from` module becomes class `to` (keeping its rarity). */
  | { kind: 'convert'; ship: number; from: ModuleKind; to: ClassId }
  /** One normal module of class `cls` becomes rare. */
  | { kind: 'rare'; ship: number; cls: ClassId }
  /** Use this combo (when several qualify). */
  | { kind: 'combo'; ship: number; combo: ComboId }
  /** Back to full health. */
  | { kind: 'repair'; ship: number };

/** How many modules of a kind a ship carries. */
export function countOf(ship: Ship, k: ModuleKind) {
  return k.rare ? ship.rare[k.cls] : ship.modules[k.cls] - ship.rare[k.cls];
}

/** The kinds of modules a ship carries (normal ones first). */
export function kindsOf(ship: Ship): ModuleKind[] {
  const out: ModuleKind[] = [];
  for (const rare of [false, true])
    for (const cls of CLASS_IDS) if (countOf(ship, { cls, rare }) > 0) out.push({ cls, rare });
  return out;
}

function take(ship: Ship, k: ModuleKind) {
  ship.modules[k.cls]--;
  if (k.rare) ship.rare[k.cls]--;
}

function give(ship: Ship, k: ModuleKind) {
  ship.modules[k.cls]++;
  if (k.rare) ship.rare[k.cls]++;
}

/** Scrap for a full repair: the ship's value times the share of health it's missing. */
export function repairCost(ship: Ship) {
  const missing = 1 - ship.hp / ship.stats.maxHp;
  return missing <= 0 ? 0 : Math.max(1, Math.ceil(missing * tierValue(ship.tier) * CONFIG.shop.repairCostPerValue));
}

/** What an action costs, in scrap. */
export function costOf(state: GameState, a: ShopAction) {
  const S = CONFIG.shop;
  if (a.kind === 'swap') return S.swapCost;
  if (a.kind === 'convert') return S.convertCost;
  if (a.kind === 'rare') return S.rareCost;
  if (a.kind === 'combo') return S.comboCost;
  const ship = findShip(state, a.ship);
  return ship ? repairCost(ship) : 0;
}

const findShip = (state: GameState, id: number) => state.playerFleet.members.find((s) => s.id === id && !s.merge);

/**
 * Do a shop action. Returns null if it worked, or a short reason why not
 * (not enough scrap, missing module...). Nothing changes when it fails.
 */
export function applyShopAction(state: GameState, a: ShopAction): string | null {
  if (!state.shopOpen) return 'The shop is closed';
  const cost = costOf(state, a);
  if (state.scrap < cost) return 'Not enough scrap';
  const ship = findShip(state, a.kind === 'swap' ? a.a : a.ship);
  if (!ship) return 'Ship not found';

  if (a.kind === 'swap') {
    const other = findShip(state, a.b);
    if (!other || other === ship) return 'Pick another ship';
    if (other.tier !== ship.tier || ship.tier < 2) return 'Only ships of the same tier (2+) can swap';
    if (countOf(ship, a.give) < 1 || countOf(other, a.take) < 1) return 'Module not found';
    take(ship, a.give);
    give(other, a.give);
    take(other, a.take);
    give(ship, a.take);
    refreshShip(other);
  } else if (a.kind === 'convert') {
    if (a.from.cls === a.to) return 'Pick a different class';
    if (countOf(ship, a.from) < 1) return 'Module not found';
    take(ship, a.from);
    give(ship, { cls: a.to, rare: a.from.rare });
  } else if (a.kind === 'rare') {
    if (countOf(ship, { cls: a.cls, rare: false }) < 1) return 'No normal module of that class';
    ship.rare[a.cls]++;
  } else if (a.kind === 'combo') {
    if (!comboOptions(ship.build.abilities).includes(a.combo)) return "This ship doesn't qualify for that combo";
    ship.comboChoice = a.combo;
  } else {
    if (cost === 0) return 'Already at full health';
    ship.hp = ship.stats.maxHp;
  }
  state.scrap -= cost;
  refreshShip(ship);
  addSound(state, 'sfx.buy', ship, 1, 1, true);
  return null;
}
