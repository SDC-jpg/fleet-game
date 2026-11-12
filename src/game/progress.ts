// Experience, levels and level-up cards. Kills give XP; each level-up pauses
// the game and offers a few cards (new skills or fleet bonuses).
// Like world.ts, nothing is drawn here.

import { CONFIG, RARITIES, SKILLS, type Rarity, type SkillId, type SkillStat } from './config';
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

const STATS: SkillStat[] = ['power', 'rate', 'size'];
const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic'];

/** Roll a rarity (rarer ones come up less often) and its bonus. */
function rollRarity(): { rarity: Rarity; amount: number } {
  const R = CONFIG.rarity;
  const weights = { common: R.commonWeight, uncommon: R.uncommonWeight, rare: R.rareWeight, epic: R.epicWeight };
  const bonus = { common: R.commonBonus, uncommon: R.uncommonBonus, rare: R.rareBonus, epic: R.epicBonus };
  let roll = Math.random() * RARITY_ORDER.reduce((sum, k) => sum + weights[k], 0);
  const rarity = RARITY_ORDER.find((k) => (roll -= weights[k]) < 0) ?? 'common';
  const amount = bonus[rarity] * (1 + (Math.random() * 2 - 1) * R.spread);
  return { rarity, amount: Math.round(amount * 100) / 100 };
}

/** A rank-up card for one of your skills: a random stat, with a rarity-based bonus. */
function rankCard(skill: SkillId): Card {
  const stat = STATS[Math.floor(Math.random() * STATS.length)];
  return { kind: 'rank', skill, stat, ...rollRarity() };
}

/**
 * Pick the cards to offer: different from each other. New skills and rank-ups
 * for skills you have are more likely than fleet bonuses.
 */
export function drawCards(state: GameState): Card[] {
  const C = CONFIG.cards;
  const canRankUp = state.skills.filter((sk) => sk.rank < C.maxRank);
  const pool: { card: Card; weight: number }[] = [
    ...newSkillOptions(state).map((skill) => ({ card: { kind: 'skill', skill } as Card, weight: C.newSkillWeight })),
    ...canRankUp.map((sk) => ({ card: rankCard(sk.id), weight: C.rankUpWeight })),
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
  if (card.kind === 'skill') state.skills.push({ id: card.skill, rank: 1, timer: 0, mods: { power: 1, rate: 1, size: 1 } });
  else if (card.kind === 'rank') {
    const sk = state.skills.find((k) => k.id === card.skill);
    if (sk) {
      sk.rank++;
      sk.mods[card.stat] += card.amount;
    }
  } else if (card.kind === 'damage') state.bonus.damage += C.damageBonus;
  else if (card.kind === 'fireRate') state.bonus.fireRate += C.fireRateBonus;
  else for (const s of state.playerFleet.members) s.hp = s.stats.maxHp;
  addSound(state, 'sfx.card', { x: 0, y: 0 }, 1, 1, true);
  state.pendingLevels--;
  state.cards = state.pendingLevels > 0 ? drawCards(state) : null;
}

/** Test helper: get every skill you don't have yet (ignores the weapon/defence limits). */
export function testGiveAllSkills(state: GameState) {
  for (const id of Object.keys(SKILLS) as SkillId[])
    if (!state.skills.some((sk) => sk.id === id)) state.skills.push({ id, rank: 1, timer: 0, mods: { power: 1, rate: 1, size: 1 } });
}

/** What a card shows. `rarity` is set for rank-up cards (its name and colour). */
export interface CardInfo {
  title: string;
  text: string;
  icon: string;
  label: string;
  rarity: { name: string; color: string } | null;
}

/** What a card shows: title, text, an icon from the manifest, a small label, and its rarity if it has one. */
export function describeCard(card: Card, state: GameState): CardInfo {
  const C = CONFIG.cards;
  if (card.kind === 'skill') {
    const s = SKILLS[card.skill];
    const label = s.side === 'left' ? 'New weapon · left click' : 'New defence · right click';
    return { title: s.name, text: s.text, icon: s.icon, label, rarity: null };
  }
  if (card.kind === 'rank') {
    const s = SKILLS[card.skill];
    const rank = (state.skills.find((k) => k.id === card.skill)?.rank ?? 0) + 1;
    return {
      title: `${s.name} rank ${rank}`,
      text: `+${Math.round(card.amount * 100)}% ${s.stats[card.stat]}`,
      icon: s.icon,
      label: `Upgrade · rank ${rank} of ${C.maxRank}`,
      rarity: RARITIES[card.rarity],
    };
  }
  if (card.kind === 'damage')
    return { title: 'Firepower', text: `Your whole fleet does +${Math.round(C.damageBonus * 100)}% damage.`, icon: 'ui.card.damage', label: 'Fleet bonus', rarity: null };
  if (card.kind === 'fireRate')
    return { title: 'Rapid fire', text: `Your whole fleet fires ${Math.round(C.fireRateBonus * 100)}% faster.`, icon: 'ui.card.fire-rate', label: 'Fleet bonus', rarity: null };
  return { title: 'Repairs', text: 'Every ship in your fleet is repaired to full health.', icon: 'ui.card.repair', label: 'Fleet bonus', rarity: null };
}
