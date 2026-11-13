// The pause screen (Esc): your equipment slots in a ring (3 per tier, up to
// tier 10) around your fleet's total bonuses, and your inventory below.
// Drag an item (hold left click) into a slot to equip, move or swap it; drag
// an equipped item onto the inventory to take it off. Right-click equips an
// inventory item into the first free slot, or takes an equipped item off.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CONFIG, RARITIES, type Rarity } from './game/config';
import type { Game, HudInfo, ItemInfo, SlotInfo } from './game/Game';
import { SpriteIcon } from './CardScreen';

/** Size of the ring area, and of the oval the slot groups sit on (pixels). */
const RING_W = 640;
const RING_H = 360;
const RING_RX = 255;
const RING_RY = 150;
const TILE = 36;

type Sort = 'rarest-first' | 'rarest-last' | 'type';
/** Inventory filter and sort, remembered while the page is open. */
const view: { rarity: Rarity | 'all'; sort: Sort } = { rarity: 'all', sort: 'rarest-first' };

/** Where an item being dragged came from: a slot number, or the inventory. */
type Drag = { item: ItemInfo; from: number | 'inventory' };
type Tip = { title: string; color: string; lines: string[] };

function itemTip(item: ItemInfo, extra?: string): Tip {
  return { title: item.name, color: item.color, lines: [item.bonus, ...(extra ? [extra] : [])] };
}

/** One square: an item icon with a rarity-coloured border, an empty slot, or a locked slot. */
function Tile({
  item,
  game,
  className,
  slot,
  onDown,
  onRight,
  onTip,
  tip,
}: {
  item: ItemInfo | null;
  game: Game | null;
  className: string;
  slot?: number;
  onDown?: () => void;
  onRight?: () => void;
  onTip: (t: Tip | null) => void;
  tip: Tip | null;
}) {
  return (
    <div
      className={'tile ' + className}
      data-slot={slot}
      style={item ? { borderColor: item.color } : undefined}
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
    </div>
  );
}

const RARITY_LIST: Rarity[] = ['common', 'uncommon', 'rare', 'epic'];

function sortItems(items: ItemInfo[], sort: Sort) {
  const list = [...items];
  if (sort === 'type') list.sort((a, b) => a.stat.localeCompare(b.stat) || b.rarityRank - a.rarityRank || b.amount - a.amount);
  else {
    const dir = sort === 'rarest-first' ? 1 : -1;
    list.sort((a, b) => dir * (b.rarityRank - a.rarityRank) || b.amount - a.amount);
  }
  return list;
}

export function EquipmentScreen({ hud, game }: { hud: HudInfo; game: Game | null }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [tip, setTip] = useState<Tip | null>(null);
  const [rarity, setRarity] = useState(view.rarity);
  const [sort, setSort] = useState(view.sort);
  view.rarity = rarity;
  view.sort = sort;

  // Dropping: wherever the mouse is released decides what happens.
  useEffect(() => {
    if (!drag) return;
    const onUp = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const slotEl = el?.closest('[data-slot]');
      if (slotEl) game?.equipItem(drag.item.id, Number(slotEl.getAttribute('data-slot')));
      else if (el?.closest('.inventory') && drag.from !== 'inventory') game?.unequipItem(drag.item.id);
      setDrag(null);
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [drag, game]);

  const eq = hud.equipment;
  if (!eq) return null;
  const per = CONFIG.items.slotsPerTier;
  const tiers = eq.slots.length / per;
  const used = eq.slots.filter((s) => s.item).length;
  const open = eq.slots.filter((s) => !s.locked).length;
  const inventory = sortItems(
    eq.inventory.filter((it) => rarity === 'all' || it.rarity === rarity),
    sort,
  );

  const slotTip = (s: SlotInfo): Tip => {
    if (s.locked) return { title: `Tier ${s.tier} slot`, color: '#9aa3bd', lines: [`Locked: reach tier ${s.tier} to unlock.`] };
    if (s.item) return itemTip(s.item, `Tier ${s.tier} slot`);
    return { title: `Tier ${s.tier} slot`, color: '#9aa3bd', lines: ['Empty: drag an item here.'] };
  };

  return (
    <div
      className={'panel center equipment' + (drag ? ' dragging' : '')}
      onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
    >
      <div className="equipment-head">
        <h1>Paused</h1>
        <span className="note">Drag items into slots. Right-click to equip or take off. Bonuses apply to your whole fleet.</span>
        <button
          onClick={(e) => {
            game?.setPaused(false);
            e.currentTarget.blur();
          }}
        >
          Resume (Esc)
        </button>
      </div>

      <div className="ring" style={{ width: RING_W, height: RING_H }}>
        {Array.from({ length: tiers }, (_, t) => {
          // Groups go clockwise from just right of the top, tier 1 first.
          const a = ((18 + 36 * t) * Math.PI) / 180;
          const cx = RING_W / 2 + Math.sin(a) * RING_RX;
          const cy = RING_H / 2 - Math.cos(a) * RING_RY;
          const group = eq.slots.slice(t * per, t * per + per);
          const locked = group[0].locked;
          return (
            <div
              key={t}
              className={'slot-group' + (locked ? ' locked' : '')}
              style={{ left: cx - (per * (TILE + 4)) / 2, top: cy - TILE / 2 }}
            >
              {group.map((s, i) => {
                const slot = t * per + i;
                return (
                  <Tile
                    key={slot}
                    slot={slot}
                    item={s.item}
                    game={game}
                    className={s.locked ? 'locked' : s.item ? 'filled' : 'empty'}
                    onDown={() => s.item && setDrag({ item: s.item, from: slot })}
                    onRight={() => s.item && game?.unequipItem(s.item.id)}
                    onTip={setTip}
                    tip={slotTip(s)}
                  />
                );
              })}
              <span className="group-label">T{t + 1}</span>
            </div>
          );
        })}
        <div className="ring-center">
          <h2>Fleet bonuses</h2>
          {eq.totals.length ? eq.totals.map((t) => <div key={t}>{t}</div>) : <div className="note">None yet</div>}
          <div className="note slots-used">
            {used} / {open} slots used
          </div>
        </div>
      </div>

      <div className="inventory">
        <div className="inventory-bar">
          <h2>Inventory ({eq.inventory.length})</h2>
          <div className="chips">
            <button className={rarity === 'all' ? 'on' : ''} onClick={() => setRarity('all')}>
              All
            </button>
            {RARITY_LIST.map((r) => (
              <button key={r} className={rarity === r ? 'on' : ''} style={{ color: RARITIES[r].color }} onClick={() => setRarity(r)}>
                {RARITIES[r].name}
              </button>
            ))}
          </div>
          <div className="chips">
            {(
              [
                ['rarest-first', 'Rarest first'],
                ['rarest-last', 'Rarest last'],
                ['type', 'Bonus type'],
              ] as [Sort, string][]
            ).map(([k, label]) => (
              <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="inventory-grid">
          {eq.inventory.length === 0 && <div className="note">Destroyed enemies sometimes drop items. Fly over them to pick them up.</div>}
          {eq.inventory.length > 0 && inventory.length === 0 && <div className="note">No items of this rarity.</div>}
          {inventory.map((it) => (
            <Tile
              key={it.id}
              item={it}
              game={game}
              className="filled"
              onDown={() => setDrag({ item: it, from: 'inventory' })}
              onRight={() => game?.equipItem(it.id)}
              onTip={setTip}
              tip={itemTip(it)}
            />
          ))}
        </div>
      </div>

      {/* The item being dragged follows the mouse. Drawn on the page itself, since the panel's centring would offset it. */}
      {drag &&
        createPortal(
          <div className="tile filled drag-ghost" style={{ left: mouse.x - TILE / 2, top: mouse.y - TILE / 2, borderColor: drag.item.color }}>
            <SpriteIcon game={game} name={drag.item.icon} size={32} />
          </div>,
          document.body,
        )}
      {tip &&
        !drag &&
        createPortal(
          <div className="item-tip" style={{ left: mouse.x + 14, top: mouse.y + 14 }}>
            <div style={{ color: tip.color }}>{tip.title}</div>
            {tip.lines.map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** "Found: Rare Autoloader (+14% fire rate)", shown briefly at the top of the screen. */
export function FoundToast({ hud }: { hud: HudInfo }) {
  if (!hud.found) return null;
  return (
    <div className="found-toast">
      Found: <span style={{ color: hud.found.color }}>{hud.found.name}</span> ({hud.found.bonus})
      {hud.found.equipped && <span className="note"> · equipped</span>}
    </div>
  );
}
