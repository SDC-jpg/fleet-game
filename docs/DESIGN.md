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

## HUD

- **Bottom-left "Run" panel:** fleet value and mix, best value, wave, time, ships destroyed and lost.
- **Bottom "flagship" panel:** a picture of the ship you fly, its tier, class and
  combo, module bars per class, health, right-click ability and dash cooldowns.
- **Class icons** above ships go dark while their ability recharges and refill
  from the bottom.

## Roadmap

### Phase A (done)
- Cooldown icons, first kill always leaves a wreck, +50% boost time per tier.
- The bottom HUD.
- At T1 the wheel switches between classes (the healthiest ship of each).

### Phase B: loot groundwork
1. **Modules become items.** A ship holds a list of modules (class + rarity)
   instead of counts per class. Everything else (shares, abilities, combos)
   is worked out from that list as now.
2. **Rare modules:** stronger versions of the same ability, with noticeable effects.

   | Rare module | Effect |
   | --- | --- |
   | Lancer | Longer Lance reach |
   | Knight | Longer Aegis duration |
   | Ballista | More missiles per volley |

   - In a merged ship, the bonus grows with the share of rare modules in that class.
   - The HUD and the wreck marker show rarity (e.g. a glowing marker, a rare count in the module bars).
3. **Scrap:** a currency earned from kills (by the enemy's value), shown in the Run panel.
4. **Elite enemies:** appear now and then from a later wave, with a glow and
   more health, and always drop a rare-module wreck.
5. **Big enemies drop part of their modules** as tier-1 wrecks.
   - Open question: instead of today's chance of one big wreck, or in addition to it?

### Phase C: the body shop
- **How it appears:** a station shows up every few waves, away from you, with an
  edge arrow pointing to it. It leaves after a while if you don't visit.
- **Visiting:** flying into it **pauses the game** and opens the shop screen,
  which lists your ships with their module bars. Prices are in **scrap** and live in `config.ts`.
- **Actions, most important first:**
  1. **Swap modules** between two ships of the same tier.
  2. **Convert** a module to another class.
  3. **Buy a rare module** (it replaces a normal one of its class).
  4. **Choose the combo** when several qualify.
  5. **Repair** ships.
- **Art:** a station sprite, plus shop screen panels (images from the manifest
  where it helps, so they're easy to paint).

### Phase D: more choice
- **Perks:** pick 1 of 3 at each merge.
- **Merge choice:** choose which ships merge, if the body shop doesn't already cover it.
- **More classes** (e.g. Engine: stamina and dash; Salvager: wreck magnet and scrap), and their combos.
