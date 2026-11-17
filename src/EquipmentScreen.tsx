// The pause screen (Esc). Equipment tab: your equipment slots in a ring (3 per
// tier, up to tier 10) around your fleet's total bonuses, and your inventory
// below. Settings tab: see SettingsScreen. Run log tab (also the Tab key): past runs (RunLog). Lifetime tab: all runs added up (LifetimeStats).
//
// Drag an item (hold left click) into a slot to equip, move or swap it; drag
// an equipped item onto the inventory to take it off. Right-click equips an
// inventory item into the first free slot, or takes an equipped item off.
//
// With the Merge Module, a button opens the merge drawer on the left. While
// it's open, equipped slots are locked; right-click (or drag) inventory items
// into its 3 slots; once one is in, items that can't join it (another rarity
// or "+N") are dimmed and locked. Merge Mk. II–IV add Load, QuickMerge and
// AutoMerge (see merge/MergeDrawer.tsx).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CONFIG, RARITIES, RARITY_ORDER, type Rarity } from './game/config';
import type { Game, HudInfo, ItemInfo, SlotInfo } from './game/Game';
import { SpriteIcon } from './CardScreen';
import { Tile } from './ItemTile';
import { TILE, itemTip, type Tip } from './itemTip';
import { fillLook, textLook } from './rarityLook';
import { SettingsScreen } from './SettingsScreen';
import { MergeDrawer } from './merge/MergeDrawer';
import { MergeToggle } from './merge/MergeToggle';
import { CircuitLines, type Box } from './merge/CircuitLines';
import { useMergeSlots } from './merge/useMergeSlots';
import { MERGE_COUNT, pickMergeSet } from './game/equipment';
import { LifetimeStats } from './LifetimeStats';
import { RunLog } from './RunLog';
import { loadRuns } from './game/runLog';

/** Size of the ring area, and of the oval the slot groups sit on (pixels). */
const RING_W = 640;
const RING_H = 360;
const RING_RX = 255;
const RING_RY = 150;
/** The Merge Module button lines up with this tier's slot group. */
const MERGE_BUTTON_TIER = 6;

type Sort = 'rarest-first' | 'rarest-last' | 'type';
type Tab = 'equipment' | 'settings' | 'log' | 'lifetime';
/** Inventory filter, sort and open tab, remembered while the page is open. */
const view: { rarity: Rarity | 'all'; sort: Sort; tab: Tab } = { rarity: 'all', sort: 'rarest-first', tab: 'equipment' };

/** Where an item being dragged came from: a slot number, or the inventory. */
type Drag = { item: ItemInfo; from: number | 'inventory' };

function sortItems(items: ItemInfo[], sort: Sort) {
  const list = [...items];
  if (sort === 'type') list.sort((a, b) => a.stat.localeCompare(b.stat) || b.rarityRank - a.rarityRank || b.plus - a.plus || b.amount - a.amount);
  else {
    const dir = sort === 'rarest-first' ? 1 : -1;
    list.sort((a, b) => dir * (b.rarityRank - a.rarityRank || b.plus - a.plus) || b.amount - a.amount);
  }
  return list;
}

/** An element's box relative to another (the panel). */
function boxIn(el: Element | null | undefined, panel: Element): Box | null {
  if (!el) return null;
  const a = el.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  return { x: a.left - p.left, y: a.top - p.top, w: a.width, h: a.height };
}
const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

export function EquipmentScreen({ hud, game }: { hud: HudInfo; game: Game | null }) {
  const [tab, setTab] = useState(view.tab);
  view.tab = tab;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [tip, setTip] = useState<Tip | null>(null);
  const [rarity, setRarity] = useState(view.rarity);
  const [sort, setSort] = useState(view.sort);
  view.rarity = rarity;
  view.sort = sort;
  const [mergeOpen, setMergeOpen] = useState(false);
  const [made, setMade] = useState<ItemInfo | null>(null);
  const eq = hud.equipment;
  const inventoryAll = eq?.inventory ?? [];
  const merge = useMergeSlots(inventoryAll);

  // Picking up the Merge Module opens this screen with the drawer open (once per pick-up).
  const openMerge = eq?.openMerge ?? 0;
  useEffect(() => {
    if (openMerge <= openedFor.n) return;
    openedFor.n = openMerge;
    setTab('equipment');
    setMergeOpen(true);
  }, [openMerge]);

  // Tab opens this screen on the Run log tab.
  const openLog = eq?.openLog ?? 0;
  useEffect(() => {
    if (openLog <= openedFor.log) return;
    openedFor.log = openLog;
    setTab('log');
  }, [openLog]);

  // AutoMerge (Mk. IV) works on its own: hand-placed items leave the slots while it's on.
  const autoOn = !!eq?.autoMerge;
  const hasPlaced = merge.slots.some((s) => s);
  useEffect(() => {
    if (autoOn && hasPlaced) merge.clear();
  }, [autoOn, hasPlaced, merge]);
  // Show what AutoMerge made last, like a merge made by hand.
  const autoMadeId = eq?.autoMade?.id;
  useEffect(() => {
    if (autoMadeId !== undefined) setMade(eq?.autoMade ?? null);
    // Only when AutoMerge makes something new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMadeId]);

  const toggleMerge = () => {
    if (mergeOpen) merge.clear();
    setMergeOpen(!mergeOpen);
  };

  // Esc with the merge drawer open closes just the drawer. Caught on the document, before the
  // game's own key listener on the window sees it (that one would close the whole screen).
  useEffect(() => {
    if (!mergeOpen || tab !== 'equipment') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      merge.clear();
      setMergeOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mergeOpen, tab, merge]);

  // Dropping: wherever the mouse is released decides what happens.
  useEffect(() => {
    if (!drag) return;
    const onUp = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const mergeEl = el?.closest('[data-merge-slot]');
      const slotEl = el?.closest('[data-slot]');
      if (mergeOpen) {
        // Only the merge slots take items while merging (equipped slots are locked).
        if (mergeEl && drag.from === 'inventory' && !autoOn) merge.place(drag.item, Number(mergeEl.getAttribute('data-merge-slot')));
      } else if (slotEl) game?.equipItem(drag.item.id, Number(slotEl.getAttribute('data-slot')));
      else if (el?.closest('.inventory') && drag.from !== 'inventory') game?.unequipItem(drag.item.id);
      setDrag(null);
    };
    // The dragged item follows the mouse anywhere on the page, not only over the panel.
    const onMove = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
    };
  }, [drag, game, mergeOpen, merge, autoOn]);

  // Measure where the button, inventory and drawer are, for the circuit lines and the button's place.
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inventoryRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<{ group: Box | null; button: Box | null; inventory: Box | null; drawer: Box | null }>({
    group: null,
    button: null,
    inventory: null,
    drawer: null,
  });
  // Runs after every render on purpose (things move as items come and go); it only updates when a box changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const next = {
      group: boxIn(panel.querySelector(`[data-tier="${MERGE_BUTTON_TIER}"]`), panel),
      button: boxIn(buttonRef.current, panel),
      inventory: boxIn(inventoryRef.current, panel),
      drawer: boxIn(drawerRef.current, panel),
    };
    if (!sameBox(next.group, boxes.group) || !sameBox(next.button, boxes.button) || !sameBox(next.inventory, boxes.inventory) || !sameBox(next.drawer, boxes.drawer))
      setBoxes(next);
  });
  useEffect(() => {
    const onResize = () => setBoxes((b) => ({ ...b, group: null }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!eq) return null;
  const per = CONFIG.items.slotsPerTier;
  const tiers = eq.slots.length / per;
  const used = eq.slots.filter((s) => s.item).length;
  const open = eq.slots.filter((s) => !s.locked).length;
  const merging = eq.mergeModule && mergeOpen;
  // With AutoMerge on, the items it will merge next show in the slots instead.
  const autoNext = merging && autoOn ? new Set((pickMergeSet(eq.inventory, MERGE_COUNT, eq.mergeAllow) ?? []).map((it) => it.id)) : null;
  const inSlots = (id: number) => (autoNext ? autoNext.has(id) : merge.isPlaced(id));
  const inventory = sortItems(
    eq.inventory.filter((it) => (rarity === 'all' || it.rarity === rarity) && !(merging && inSlots(it.id))),
    sort,
  );

  const slotTip = (s: SlotInfo): Tip => {
    if (s.locked) return { title: `Tier ${s.tier} slot`, color: '#9aa3bd', lines: [`Locked: reach tier ${s.tier} to unlock.`] };
    if (merging) return s.item ? itemTip(s.item, 'Locked while merging') : { title: `Tier ${s.tier} slot`, color: '#9aa3bd', lines: ['Locked while merging.'] };
    if (s.item) return itemTip(s.item, `Tier ${s.tier} slot`);
    return { title: `Tier ${s.tier} slot`, color: '#9aa3bd', lines: ['Empty: drag an item here.'] };
  };

  const mergeIds = (ids: number[]) => {
    if (!game) return;
    const result = game.mergeItems(ids);
    if (result) setMade(result);
    merge.clear();
  };
  const doMerge = () => {
    if (merge.full) mergeIds(merge.slots.map((s) => s!.id));
  };

  const rarityChipTip = (r: Rarity): Tip => ({ title: RARITIES[r].name, color: RARITIES[r].color, holo: RARITIES[r].holo, lines: [] });
  const byRarity = sort !== 'type';

  return (
    <div
      ref={panelRef}
      className={'panel center equipment' + (drag ? ' dragging' : '') + (merging ? ' merging' : '')}
      onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
    >
      <div className="equipment-head">
        <h1>Paused</h1>
        <div className="chips tabs">
          <button className={tab === 'equipment' ? 'on' : ''} onClick={() => setTab('equipment')}>
            Equipment
          </button>
          <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
            Settings
          </button>
          <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')} title="Your past runs (Tab)">
            Run log
          </button>
          <button className={tab === 'lifetime' ? 'on' : ''} onClick={() => setTab('lifetime')} title="All your finished runs added up">
            Lifetime
          </button>
        </div>
        <span className="spacer" />
        <button
          onClick={(e) => {
            game?.setPaused(false, true);
            e.currentTarget.blur();
          }}
        >
          Resume (Esc)
        </button>
      </div>

      {tab === 'equipment' && <div className="note equipment-hint">Drag into slots · right-click to equip or take off · bonuses apply to your whole fleet</div>}
      {tab === 'settings' && <SettingsScreen hud={hud} game={game} />}
      {tab === 'log' && <RunLog runs={loadRuns()} embedded />}
      {tab === 'lifetime' && <LifetimeStats />}

      {tab === 'equipment' && (
        <>
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
                  data-tier={t + 1}
                  className={'slot-group' + (locked ? ' locked' : '')}
                  style={{ left: cx - (per * (TILE + 4)) / 2, top: cy - TILE / 2 }}
                >
                  {group.map((s, i) => {
                    const slot = t * per + i;
                    // Locked while merging: no dragging, no right-click, no dropping.
                    const usable = !merging && !s.locked;
                    return (
                      <Tile
                        key={slot}
                        slot={merging ? undefined : slot}
                        item={s.item}
                        game={game}
                        className={
                          (s.locked ? 'locked' : s.item ? 'filled' : 'empty') +
                          (merging ? ' merge-locked' : '') +
                          (s.item && drag?.item.id === s.item.id ? ' drag-origin' : '')
                        }
                        onDown={usable && s.item ? () => setDrag({ item: s.item!, from: slot }) : undefined}
                        onRight={usable && s.item ? () => game?.unequipItem(s.item!.id) : undefined}
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
            <div className="gearscore" title="The rarity tiers of your equipped items added up (Common 1 … Mythic 7)">
              Gearscore <b>{eq.gearscore}</b>
            </div>
          </div>

          {eq.mergeModule && (
            <MergeToggle
              ref={buttonRef}
              name={eq.mergeName}
              open={mergeOpen}
              autoProgress={autoOn ? eq.autoProgress : null}
              onToggle={toggleMerge}
              // Flush left, level with the tier-6 slots (hidden until measured).
              style={
                boxes.group && boxes.inventory
                  ? { top: boxes.group.y + boxes.group.h / 2 - (boxes.button?.h ?? 24) / 2, left: boxes.inventory.x }
                  : { visibility: 'hidden' }
              }
            />
          )}
          {eq.mergeModule && boxes.button && boxes.inventory && boxes.group && (
            <CircuitLines button={boxes.button} inventory={boxes.inventory} drawer={merging ? boxes.drawer : null} />
          )}
          {merging && (
            <MergeDrawer
              ref={drawerRef}
              game={game}
              level={eq.mergeLevel}
              name={eq.mergeName}
              slots={merge.slots}
              full={merge.full}
              free={eq.inventory.filter((it) => !merge.isPlaced(it.id))}
              allow={eq.mergeAllow}
              order={eq.mergeOrder}
              autoMerge={autoOn}
              autoProgress={eq.autoProgress}
              made={made}
              onRemove={merge.remove}
              onMerge={doMerge}
              onFill={merge.fill}
              onMergeIds={mergeIds}
              onTip={setTip}
              // Its bottom edge level with the inventory's (it grows upward); hidden until measured.
              style={
                boxes.inventory && boxes.drawer
                  ? { top: boxes.inventory.y + boxes.inventory.h - boxes.drawer.h }
                  : { top: boxes.inventory?.y ?? 0, visibility: 'hidden' }
              }
            />
          )}

          <div className="inventory" ref={inventoryRef}>
            <div className="inventory-bar">
              <h2>Inventory ({eq.inventory.length})</h2>
              <div className="chips">
                <button className={rarity === 'all' ? 'on' : ''} onClick={() => setRarity('all')}>
                  All
                </button>
                {RARITY_ORDER.map((r) => {
                  const glyph = fillLook(RARITIES[r]);
                  return (
                    <button
                      key={r}
                      className={'rarity-chip' + (rarity === r ? ' on' : '')}
                      onClick={() => setRarity(rarity === r ? 'all' : r)}
                      onMouseEnter={() => setTip(rarityChipTip(r))}
                      onMouseLeave={() => setTip(null)}
                      aria-label={RARITIES[r].name}
                    >
                      <span className={'glyph ' + glyph.className} style={glyph.style} />
                    </button>
                  );
                })}
              </div>
              <div className="chips">
                <button
                  className={'sort-toggle' + (byRarity ? ' on' : '')}
                  onClick={() => setSort(sort === 'rarest-first' ? 'rarest-last' : 'rarest-first')}
                  onMouseEnter={() =>
                    setTip({
                      title: 'Sort by rarity',
                      color: '#9fd3ff',
                      lines: [byRarity ? (sort === 'rarest-first' ? 'Rarest first (click for rarest last)' : 'Rarest last (click for rarest first)') : 'Click to sort by rarity'],
                    })
                  }
                  onMouseLeave={() => setTip(null)}
                  aria-label="Sort by rarity"
                >
                  <span className={sort === 'rarest-first' ? 'lit' : ''}>▲</span>
                  <span className={sort === 'rarest-last' ? 'lit' : ''}>▼</span>
                </button>
                <button className={sort === 'type' ? 'on' : ''} onClick={() => setSort('type')}>
                  Bonus type
                </button>
              </div>
            </div>
            <div className="inventory-grid">
              {eq.inventory.length === 0 && <div className="note">Destroyed enemies sometimes drop items. Fly over them to pick them up.</div>}
              {eq.inventory.length > 0 && inventory.length === 0 && <div className="note">No items here.</div>}
              {inventory.map((it) => {
                // While merging, items that can't join the merge slots are dimmed and locked.
                const locked = merging && !merge.fits(it);
                return (
                  <Tile
                    key={it.id}
                    item={it}
                    game={game}
                    className={'filled' + (locked ? ' dim' : '') + (drag?.item.id === it.id ? ' drag-origin' : '')}
                    onDown={locked ? undefined : () => setDrag({ item: it, from: 'inventory' })}
                    onRight={locked ? undefined : merging ? () => !autoOn && merge.place(it) : () => game?.equipItem(it.id)}
                    onTip={setTip}
                    tip={itemTip(
                      it,
                      locked ? `Can't merge with ${merge.first?.name ?? 'these'}` : merging ? (autoOn ? 'AutoMerge is on' : 'Right-click to merge') : undefined,
                    )}
                  />
                );
              })}
            </div>
          </div>
        </>
      )}

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
            <div className={textLook(tip).className} style={textLook(tip).style}>
              {tip.title}
            </div>
            {/* Keyed by position: two lines can read the same (e.g. two "+40% damage" substats). */}
            {tip.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** The last "open the drawer" number handled (survives the screen closing and opening again). */
const openedFor = { n: 0, log: 0 };

/** "Found: Rare Autoloader (+14% fire rate)", shown briefly at the top of the screen. */
export function FoundToast({ hud }: { hud: HudInfo }) {
  if (!hud.found) return null;
  const look = textLook(hud.found);
  return (
    <div className="found-toast">
      Found:{' '}
      <span className={look.className} style={look.style}>
        {hud.found.name}
      </span>{' '}
      ({hud.found.bonus})
      {hud.found.equipped && <span className="note"> · equipped</span>}
    </div>
  );
}
