// The pause screen (Esc): your equipment slots and inventory. Click an item in
// your inventory to equip it; click an equipped item to take it off.

import type { Game, HudInfo, ItemInfo } from './game/Game';
import { SpriteIcon } from './CardScreen';

function ItemTile({ item, game, onClick, disabled }: { item: ItemInfo; game: Game | null; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="item" style={{ borderColor: item.color }} onClick={onClick} disabled={disabled}>
      <SpriteIcon game={game} name={item.icon} size={32} />
      <span>
        <span className="item-name" style={{ color: item.color }}>
          {item.name}
        </span>
        <br />
        <span className="item-bonus">{item.bonus}</span>
      </span>
    </button>
  );
}

export function EquipmentScreen({ hud, game }: { hud: HudInfo; game: Game | null }) {
  const eq = hud.equipment;
  if (!eq) return null;
  const full = eq.equipped.length >= eq.slots;
  const empty = Math.max(0, eq.slots - eq.equipped.length);
  return (
    <div className="panel center equipment">
      <div className="equipment-head">
        <h1>Paused</h1>
        <span className="note">Equipment bonuses apply to your whole fleet.</span>
        <button
          onClick={(e) => {
            game?.setPaused(false);
            e.currentTarget.blur();
          }}
        >
          Resume (Esc)
        </button>
      </div>
      <div className="equipment-body">
        <div className="equipment-col">
          <h2>
            Equipped ({eq.equipped.length} / {eq.slots})
          </h2>
          <div className="item-list">
            {eq.equipped.map((it) => (
              <ItemTile key={it.id} item={it} game={game} onClick={() => game?.unequipItem(it.id)} />
            ))}
            {Array.from({ length: empty }, (_, i) => (
              <div key={i} className="item empty-slot">
                Empty slot
              </div>
            ))}
          </div>
          <div className="note">
            Reach tier {eq.next.tier} for {eq.next.slots} more slots. Click an equipped item to take it off.
          </div>
          <h2>Fleet bonuses</h2>
          <div className="totals">{eq.totals.length ? eq.totals.join(' · ') : 'None yet'}</div>
        </div>
        <div className="equipment-col">
          <h2>Inventory ({eq.inventory.length})</h2>
          <div className="item-list scroll">
            {eq.inventory.length === 0 && <div className="note">Destroyed enemies sometimes drop items. Fly over them to pick them up.</div>}
            {eq.inventory.map((it) => (
              <ItemTile key={it.id} item={it} game={game} disabled={full} onClick={() => game?.equipItem(it.id)} />
            ))}
          </div>
          {full && eq.inventory.length > 0 && <div className="note">All slots are full: take an item off first.</div>}
        </div>
      </div>
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
