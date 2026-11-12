// The body shop screen: your ships on the left, the selected ship's options on the right.
// Every button sends a ShopAction to the game, which checks the cost and applies it.

import { useEffect, useRef, useState } from 'react';
import { CLASS_IDS, CLASSES, type ClassId } from './game/config';
import type { Game, ShopInfo, ShopShip } from './game/Game';
import type { ModuleKind } from './game/shop';

/** A picture of one of your ships (nose up), redrawn when `drawKey` changes. */
export function ShipPicture({ game, id, size, drawKey }: { game: Game | null; id?: number; size: number; drawKey: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) game?.drawPortrait(canvas.current, id);
  }, [game, id, drawKey]);
  return <canvas ref={canvas} width={size} height={size} className="portrait" style={{ width: size, height: size }} />;
}

const kindKey = (k: ModuleKind) => `${k.cls}${k.rare ? '-rare' : ''}`;
const parseKind = (key: string): ModuleKind => ({ cls: key.replace('-rare', '') as ClassId, rare: key.endsWith('-rare') });

export function ShopScreen({ shop, game }: { shop: ShopInfo; game: Game | null }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = shop.ships.find((s) => s.id === selectedId) ?? shop.ships[0];
  if (!selected) return null;
  return (
    <div className="panel center shop">
      <div className="shop-head">
        <h1>Body shop</h1>
        <span className="scrap">Scrap: {shop.scrap}</span>
        <button onClick={() => game?.leaveShop()}>Leave (Esc)</button>
      </div>
      <div className="shop-message">{shop.message ?? ' '}</div>
      <div className="shop-body">
        <div className="shop-list">
          {shop.ships.map((s) => (
            <button
              key={s.id}
              className={'ship-card' + (s === selected ? ' selected' : '')}
              onClick={() => setSelectedId(s.id)}
            >
              <ShipPicture game={game} id={s.id} size={48} drawKey={s.key} />
              <span>
                T{s.tier} {s.className}
                {s.flagship && <span className="note"> (you)</span>}
                <br />
                <ModuleChips ship={s} />
                {s.hp < s.maxHp && <span className="damaged"> damaged</span>}
              </span>
            </button>
          ))}
        </div>
        <ShipDetails ship={selected} shop={shop} game={game} />
      </div>
    </div>
  );
}

/** Small coloured counts, e.g. "5 2 1" in class colours (rare ones in pink). */
function ModuleChips({ ship }: { ship: ShopShip }) {
  return (
    <span className="chips">
      {ship.kinds.map((k) => (
        <span key={kindKey(k)} style={{ color: k.color }} className={k.rare ? 'rare-chip' : ''}>
          {k.count}
        </span>
      ))}
    </span>
  );
}

function ShipDetails({ ship, shop, game }: { ship: ShopShip; shop: ShopInfo; game: Game | null }) {
  const p = shop.prices;
  const can = (cost: number) => shop.scrap >= cost;
  const partners = shop.ships.filter((s) => s.id !== ship.id && s.tier === ship.tier);
  return (
    <div className="shop-details">
      <div className="ship-head">
        <ShipPicture game={game} id={ship.id} size={96} drawKey={ship.key} />
        <div>
          <div className="title">
            T{ship.tier} {ship.className}
            {ship.combo && <span className="combo"> · {ship.combo}</span>}
          </div>
          <div className="note">Abilities: {ship.abilities.join(', ') || 'none'}</div>
          <div className="note">
            Health {Math.ceil(ship.hp)} / {ship.maxHp}
          </div>
        </div>
      </div>

      {ship.tier >= 2 && <SwapSection ship={ship} partners={partners} cost={p.swap} can={can(p.swap)} game={game} />}

      <h2>Modules</h2>
      {ship.kinds.map((k) => (
        <div className="module-row" key={kindKey(k)}>
          <span className="module-name" style={{ color: k.color }}>
            {k.count} × {k.name}
            {k.rare && <span className="rare-tag"> (rare)</span>}
          </span>
          <span className="actions">
            {CLASS_IDS.filter((c) => c !== k.cls).map((to) => (
              <button
                key={to}
                disabled={!can(p.convert)}
                onClick={() => game?.shopAction({ kind: 'convert', ship: ship.id, from: k, to })}
                title={`Turn one ${k.name}${k.rare ? ' (rare)' : ''} module into a ${CLASSES[to].name} module`}
              >
                → {CLASSES[to].name} ({p.convert})
              </button>
            ))}
            {!k.rare && (
              <button
                className="rare-button"
                disabled={!can(p.rare)}
                onClick={() => game?.shopAction({ kind: 'rare', ship: ship.id, cls: k.cls })}
                title="Make one of these modules rare"
              >
                Make rare ({p.rare})
              </button>
            )}
          </span>
        </div>
      ))}

      {ship.comboChoices.length >= 2 && (
        <>
          <h2>Combo</h2>
          {ship.comboChoices.map((c) => (
            <div className="module-row" key={c.id}>
              <button
                className={c.active ? 'active' : ''}
                disabled={c.active || !can(p.combo)}
                onClick={() => game?.shopAction({ kind: 'combo', ship: ship.id, combo: c.id })}
              >
                {c.active ? '✓ ' : ''}
                {c.name}
                {p.combo > 0 && !c.active ? ` (${p.combo})` : ''}
              </button>
              <span className="note">{c.text}</span>
            </div>
          ))}
        </>
      )}

      {ship.hp < ship.maxHp && (
        <>
          <h2>Repair</h2>
          <button disabled={!can(ship.repairCost)} onClick={() => game?.shopAction({ kind: 'repair', ship: ship.id })}>
            Repair to full ({ship.repairCost})
          </button>
        </>
      )}
    </div>
  );
}

/** Give one module to another ship of the same tier, and take one of its modules back. */
function SwapSection(props: { ship: ShopShip; partners: ShopShip[]; cost: number; can: boolean; game: Game | null }) {
  const { ship, partners, cost, can, game } = props;
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [giveKey, setGiveKey] = useState<string | null>(null);
  const [takeKey, setTakeKey] = useState<string | null>(null);
  const partner = partners.find((s) => s.id === partnerId) ?? partners[0];
  // Fall back to the first available choice when a pick no longer exists (e.g. after a swap).
  const give = ship.kinds.find((k) => kindKey(k) === giveKey) ?? ship.kinds[0];
  const take = partner?.kinds.find((k) => kindKey(k) === takeKey) ?? partner?.kinds[0];
  return (
    <>
      <h2>Swap modules</h2>
      {!partner ? (
        <div className="note">You need another T{ship.tier} ship to swap with.</div>
      ) : (
        <div className="swap">
          Give
          <select value={kindKey(give)} onChange={(e) => setGiveKey(e.target.value)}>
            {ship.kinds.map((k) => (
              <option key={kindKey(k)} value={kindKey(k)}>
                {k.name}
                {k.rare ? ' (rare)' : ''} ({k.count})
              </option>
            ))}
          </select>
          to
          <select value={partner.id} onChange={(e) => setPartnerId(Number(e.target.value))}>
            {partners.map((s) => (
              <option key={s.id} value={s.id}>
                T{s.tier} {s.className} #{s.id}
              </option>
            ))}
          </select>
          for its
          <select value={take ? kindKey(take) : ''} onChange={(e) => setTakeKey(e.target.value)}>
            {partner.kinds.map((k) => (
              <option key={kindKey(k)} value={kindKey(k)}>
                {k.name}
                {k.rare ? ' (rare)' : ''} ({k.count})
              </option>
            ))}
          </select>
          <button
            disabled={!can || !take}
            onClick={() =>
              take && game?.shopAction({ kind: 'swap', a: ship.id, b: partner.id, give: parseKind(kindKey(give)), take: parseKind(kindKey(take)) })
            }
          >
            Swap ({cost})
          </button>
        </div>
      )}
    </>
  );
}
