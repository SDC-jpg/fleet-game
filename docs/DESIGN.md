# Fleet game: classes and modules

A short design note for the roguelike layer: incremental choices that shape a run.
Numbers live in `src/game/config.ts` and on the
[tuning page](https://sdc-jpg.github.io/fleet-game/tuning.html).

## The idea

Every small (tier-1) ship has a **class**. Each one you recruit is a **module**.
Merging adds modules up, so what you pick up decides what your big ships can do.

| Class | Ability | Bigger share gives |
| --- | --- | --- |
| **Lancer** | **Lance:** a fast, heavy shot that passes through every ship in a line | more damage |
| **Knight** | **Aegis:** a shield on itself and nearby allies that soaks up damage | stronger, wider shield |
| **Ballista** | **Missile volley:** slow homing missiles | more missiles, more damage |

- Classes don't change a ship's stats. Every ship keeps the basic gun.
- All three are equally common, for you and for enemies.
- We dropped the medic: healing drags fights out, and you could just retreat and heal.

## Merging and strength

- 8 ships of a tier merge into one of the next, from fleet value 16.
- Merges group like with like. The most common class goes first, and leftovers mix.
- **Strength** = 7^(tier − 1) × share^1.2.
  - A pure T2 Lancer has a Lance 7× as strong as a T1's.
  - A 50/50 ship gets a bit less than half of each, so specialists beat generalists.
- A class needs **at least 25%** of a ship's modules to give its ability. Smaller
  shares strengthen the basic gun instead.

## Combos

When two classes each have at least 25%, the ship gets a combo. If several
qualify, the pair with the most modules wins, and ties are picked at random.

| Classes | Combo | Effect |
| --- | --- | --- |
| Lancer + Knight | **Mirror Guard** | Aegis shields reflect the shots they block |
| Lancer + Ballista | **Splinter Volley** | Missiles burst into small lances on impact |
| Knight + Ballista | **Retaliation** | Hits on Aegis shields fire a missile back |

## Controls and the flagship

- **Right-click:** the flagship's main ability (its biggest class; ties at random).
  Its other abilities fire by themselves, like the wingmen's.
- **Mouse wheel:** switch between your highest-tier ships to choose your ability.
- **Space:** dash. **Shift:** boost (stamina). **Left-click:** fire.
- You start as a Lancer.

## Art

- Each T1 class has its own look (copies of the fighter for now). T2 and up keep
  one shared design per tier.
- Rank icons above ships and wrecks show the main class, plus a smaller second
  class. They stay the same size when zoomed out.

## Later

1. **Loot and rarity:** elite enemies, rare modules, big ships dropping part of their modules.
2. **Choice:** a "body shop" station to rearrange modules (and choose combos),
   picking ships at merges, and perks.
3. More classes (e.g. Engine, Salvager) and more combos.
