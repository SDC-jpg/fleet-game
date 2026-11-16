// Experience, levels and level-up cards. Kills give XP; each level-up pauses
// the game and offers a few cards (new skills or fleet bonuses).
// Like world.ts, nothing is drawn here.

import { CONFIG, SKILLS, enabledSkills, type SkillId } from './config';
import { xpToNextLevel } from './curves';
import { addSound, type Card, type GameState } from './world';
import { updateBonuses } from './equipment';
import { RARITY_ORDER, rarityInfo, rollRarity } from './rarity';
import { addMod, newMods, rankAmount, skillStats, upgradeText } from './upgrades';

/** Add XP. Every level reached waits for a card pick (cards appear shortly after; the game pauses while they're shown). */
export function gainXp(state: GameState, amount: number) {
  state.xp += amount;
  while (state.xp >= xpToNextLevel(state.level)) {
    state.xp -= xpToNextLevel(state.level);
    state.level++;
    state.pendingLevels++;
    addSound(state, 'sfx.levelup', { x: 0, y: 0 }, 1, 1, true);
  }
}

/** Skills you can still pick up: not owned yet, and with room on their side (left or right click). */
function newSkillOptions(state: GameState): SkillId[] {
  const C = CONFIG.cards;
  const owned = state.skills.map((s) => s.id);
  const count = (side: string) => owned.filter((id) => SKILLS[id].side === side).length;
  const room = { left: count('left') < C.maxWeapons, right: count('right') < C.maxDefences, passive: count('passive') < C.maxPassives };
  return enabledSkills().filter((id) => !owned.includes(id) && room[SKILLS[id].side]);
}

/** A rank-up card for one of your skills: one of its stats, with a rarity-based bonus. */
export function rankCard(skill: SkillId, rarity = rollRarity(), stats = skillStats(skill)): Card {
  const stat = stats[Math.floor(Math.random() * stats.length)];
  return { kind: 'rank', skill, stat, rarity, amount: rankAmount(stat, rarity) };
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
/**
 * A card's effect: a new skill (a new weapon gets selected), a rank-up, or a
 * fleet bonus. `force` (dev card index): an upgrade for a skill you don't have
 * gives you the skill first, and having a skill already doesn't stop it.
 */
export function applyCard(state: GameState, card: Card, force = false) {
  const C = CONFIG.cards;
  const has = (id: SkillId) => state.skills.some((k) => k.id === id);
  const addSkill = (id: SkillId) => {
    state.skills.push({ id, rank: 1, timer: 0, mods: newMods() });
    if (SKILLS[id].side === 'left') state.activeWeapon = state.skills.filter((k) => SKILLS[k.id].side === 'left').length - 1;
  };
  if (card.kind === 'skill') {
    if (!has(card.skill) || !force) addSkill(card.skill);
  } else if (card.kind === 'rank') {
    if (force && !has(card.skill)) addSkill(card.skill);
    const sk = state.skills.find((k) => k.id === card.skill);
    if (sk) {
      sk.rank++;
      addMod(sk.mods, card.stat, card.amount);
    }
  } else if (card.kind === 'damage') state.cardBonus.damage += C.damageBonus;
  else if (card.kind === 'fireRate') state.cardBonus.fireRate += C.fireRateBonus;
  else for (const s of state.playerFleet.members) s.hp = s.stats.maxHp;
  updateBonuses(state);
  addSound(state, 'sfx.card', { x: 0, y: 0 }, 1, 1, true);
}

export function pickCard(state: GameState, index: number) {
  const card = state.cards?.[index];
  if (!card) return;
  applyCard(state, card);
  state.pendingLevels--;
  state.cards = state.pendingLevels > 0 ? drawCards(state) : null;
}

/** Test helper: get every skill you don't have yet (ignores the weapon/defence limits). */
export function testGiveAllSkills(state: GameState) {
  for (const id of enabledSkills())
    if (!state.skills.some((sk) => sk.id === id)) state.skills.push({ id, rank: 1, timer: 0, mods: newMods() });
}

/** What a card shows. `rarity` is set for rank-up cards (its name and colour). */
export interface CardInfo {
  title: string;
  text: string;
  icon: string;
  label: string;
  rarity: { name: string; color: string; holo?: boolean } | null;
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
      text: upgradeText(card.skill, card.stat, card.amount),
      icon: s.icon,
      label: `Upgrade · rank ${rank} of ${C.maxRank}`,
      rarity: rarityInfo(card.rarity),
    };
  }
  if (card.kind === 'damage')
    return { title: 'Firepower', text: `Your whole fleet does +${Math.round(C.damageBonus * 100)}% damage.`, icon: 'ui.card.damage', label: 'Fleet bonus', rarity: null };
  if (card.kind === 'fireRate')
    return { title: 'Rapid fire', text: `Your whole fleet fires ${Math.round(C.fireRateBonus * 100)}% faster.`, icon: 'ui.card.fire-rate', label: 'Fleet bonus', rarity: null };
  return { title: 'Repairs', text: 'Every ship in your fleet is repaired to full health.', icon: 'ui.card.repair', label: 'Fleet bonus', rarity: null };
}

/** A group in the card index: one kind of card, with every rarity it can come in (a single card if it has no rarity). */
export interface CardGroup {
  title: string;
  /** Each card as shown, with the card itself (the dev card index can give it to you). */
  cards: (CardInfo & { card: Card })[];
}

/**
 * Every card the game can offer, for the card index (Settings): new skills,
 * each skill's upgrades in every rarity (middle values, no rolled spread),
 * and the fleet bonus cards.
 */
export function cardIndex(): { section: string; groups: CardGroup[] }[] {
  const C = CONFIG.cards;
  const skills = enabledSkills();
  // A blank game is enough to describe cards (rank numbers show as rank 2).
  const blank = { skills: [] } as unknown as GameState;
  const card = (c: Card) => ({ ...describeCard(c, blank), card: c });
  return [
    { section: 'New skills', groups: skills.map((skill) => ({ title: SKILLS[skill].name, cards: [card({ kind: 'skill', skill })] })) },
    {
      section: 'Skill upgrades',
      groups: skills.flatMap((skill) =>
        skillStats(skill).map((stat) => ({
          title: `${SKILLS[skill].name}: ${upgradeText(skill, stat, rankAmount(stat, 'common', false)).replace(/^\+[\d%]+ /, '')}`,
          cards: RARITY_ORDER.map((rarity) => {
            const info = card({ kind: 'rank', skill, stat, rarity, amount: rankAmount(stat, rarity, false) });
            return { ...info, title: SKILLS[skill].name, label: `Upgrade · up to rank ${C.maxRank}` };
          }),
        })),
      ),
    },
    {
      section: 'Fleet bonuses',
      groups: (['damage', 'fireRate', 'repair'] as const).map((kind) => {
        const info = card({ kind });
        return { title: info.title, cards: [info] };
      }),
    },
  ];
}
