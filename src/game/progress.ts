// Experience, levels and level-up cards. Kills give XP; each level-up pauses
// the game and offers a few cards (new skills or fleet bonuses).
// Like world.ts, nothing is drawn here.

import { CONFIG, SKILLS, type SkillId } from './config';
import { xpToNextLevel } from './curves';
import { addSound, type Card, type GameState } from './world';

/** Add XP. Every level reached waits for a card pick (the game pauses while cards are shown). */
export function gainXp(state: GameState, amount: number) {
  state.xp += amount;
  while (state.xp >= xpToNextLevel(state.level)) {
    state.xp -= xpToNextLevel(state.level);
    state.level++;
    state.pendingLevels++;
    addSound(state, 'sfx.levelup', { x: 0, y: 0 }, 1, 1, true);
  }
  if (!state.cards && state.pendingLevels > 0) state.cards = drawCards(state);
}

/** Skills you can still pick up: not owned yet, and with room on their side (left or right click). */
function newSkillOptions(state: GameState): SkillId[] {
  const C = CONFIG.cards;
  const owned = state.skills.map((s) => s.id);
  const count = (side: string) => owned.filter((id) => SKILLS[id].side === side).length;
  const room = { left: count('left') < C.maxWeapons, right: count('right') < C.maxDefences };
  return (Object.keys(SKILLS) as SkillId[]).filter((id) => !owned.includes(id) && room[SKILLS[id].side]);
}

/** Pick the cards to offer: different from each other, new skills more likely than bonuses. */
export function drawCards(state: GameState): Card[] {
  const C = CONFIG.cards;
  const pool: { card: Card; weight: number }[] = [
    ...newSkillOptions(state).map((skill) => ({ card: { kind: 'skill', skill } as Card, weight: C.newSkillWeight })),
    { card: { kind: 'damage' }, weight: 1 },
    { card: { kind: 'fireRate' }, weight: 1 },
    { card: { kind: 'repair' }, weight: 1 },
  ];
  const picked: Card[] = [];
  while (picked.length < C.choices && pool.length) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * total;
    const i = pool.findIndex((p) => (roll -= p.weight) < 0);
    picked.push(pool.splice(i < 0 ? pool.length - 1 : i, 1)[0].card);
  }
  return picked;
}

/** Take one of the offered cards. If more level-ups are waiting, new cards come up straight away. */
export function pickCard(state: GameState, index: number) {
  const card = state.cards?.[index];
  if (!card) return;
  const C = CONFIG.cards;
  if (card.kind === 'skill') state.skills.push({ id: card.skill, rank: 1, timer: 0 });
  else if (card.kind === 'damage') state.bonus.damage += C.damageBonus;
  else if (card.kind === 'fireRate') state.bonus.fireRate += C.fireRateBonus;
  else for (const s of state.playerFleet.members) s.hp = s.stats.maxHp;
  addSound(state, 'sfx.card', { x: 0, y: 0 }, 1, 1, true);
  state.pendingLevels--;
  state.cards = state.pendingLevels > 0 ? drawCards(state) : null;
}

/** What a card shows: title, text, an icon from the manifest, and a small label. */
export function describeCard(card: Card): { title: string; text: string; icon: string; label: string } {
  const C = CONFIG.cards;
  if (card.kind === 'skill') {
    const s = SKILLS[card.skill];
    return { title: s.name, text: s.text, icon: s.icon, label: s.side === 'left' ? 'Weapon · left click' : 'Defence · right click' };
  }
  if (card.kind === 'damage')
    return { title: 'Firepower', text: `Your whole fleet does +${Math.round(C.damageBonus * 100)}% damage.`, icon: 'ui.card.damage', label: 'Fleet bonus' };
  if (card.kind === 'fireRate')
    return { title: 'Rapid fire', text: `Your whole fleet fires ${Math.round(C.fireRateBonus * 100)}% faster.`, icon: 'ui.card.fire-rate', label: 'Fleet bonus' };
  return { title: 'Repairs', text: 'Every ship in your fleet is repaired to full health.', icon: 'ui.card.repair', label: 'Fleet bonus' };
}
