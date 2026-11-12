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

### Phase B: loot (done)
1. **Rarity on modules.** A ship counts its modules per class, and how many of
   each are rare. That's the same as a list of (class, rarity) items, but
   lighter for big ships (a T4 holds 512).
2. **Rare modules:** stronger versions of the same ability, with noticeable effects.

   | Rare module | Effect |
   | --- | --- |
   | Lancer | Longer Lance reach |
   | Knight | Longer Aegis duration |
   | Ballista | More missiles per volley |

   - In a merged ship, the bonus grows with the share of rare modules in that
     class. With all rare: Lance reach ×1.75, Aegis ×2 duration, ×2 missiles.
   - Rare things are pink: the wreck marker, icon outlines, and a "rare" count in the HUD bars.
   - Ordinary enemies' tier-1 wrecks are rare 4% of the time.
3. **Scrap:** a currency earned from kills (by the enemy's value, +10 for an elite), shown in the Run panel.
4. **Elite enemies:** from wave 5, 8% of lone enemies and enemy fleet leaders.
   They have a pink glow, 4× health and 1.5× gun damage, all their modules are
   rare, and they always leave a wreck.
5. **Big enemies drop part of their modules** (25%, at most 8) as tier-1 wrecks,
   and still have a lower chance (half of before) of leaving a whole big wreck.

### Phase C: the body shop (done)
- **How it appears:** from wave 3, a station shows up every 4 waves, just
  off-screen, with a lime edge arrow and a countdown in the Run panel. It
  leaves after 45 s if you don't visit (if the next one is due first, it just
  stays longer). It leaves after one visit.
- **Visiting:** flying the ship you control into it **pauses the game** and
  opens the shop screen: your ships on the left (biggest first), the selected
  ship's options on the right. Prices are in **scrap** (`CONFIG.shop`).
- **Actions, most important first:**
  1. **Swap modules** between two ships of the same tier (T2+): 3 scrap.
  2. **Convert** a module to another class, keeping its rarity: 8 scrap.
  3. **Make a module rare:** 25 scrap.
  4. **Choose the combo** when several qualify: free. The choice sticks while it still qualifies.
  5. **Repair** ships: the ship's value × the share of health missing.
- Converting tier-1 ships changes their class, which steers what merges
  together later (like merges with like).
- **Art:** a station sprite, plus shop screen panels (images from the manifest
  where it helps, so they're easy to paint).

### Phase D: more choice
- **Perks:** pick 1 of 3 at each merge.
- **Merge choice:** choose which ships merge, if the body shop doesn't already cover it.
- **More classes** (e.g. Engine: stamina and dash; Salvager: wreck magnet and scrap), and their combos.
