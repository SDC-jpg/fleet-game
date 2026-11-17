// ShipArt's Guns section (ships only): place guns on a ship, pick their size, weapon
// type, turret or fixed, and an optional image. Damage isn't set by hand: every ship
// of a tier shares the same damage budget between its guns (see game/guns.ts), and
// the numbers below show how it works out.

import { CONFIG } from '../game/config';
import { WEAPON_TYPES, type Gun } from '../game/artLayout';
import { balanceGuns, tierDps } from '../game/guns';
import { NumberField } from './fields';

const label = (s: string) => s[0].toUpperCase() + s.slice(1);
/** "parts/gun-turret-2.png" → "gun-turret-2". */
const baseName = (file: string) => file.replace(/\/$/, '').replace(/^.*\//, '').replace(/\.png$/i, '');
const fmt = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en') : n.toFixed(n >= 10 ? 1 : 2));

export function GunsPanel({
  guns,
  placed,
  tier,
  images,
  selected,
  onSelect,
  onChange,
  onReset,
}: {
  /** The ship's guns (the standard ones if none are placed). */
  guns: Gun[];
  /** false = these are the standard guns (editing places a copy of them first). */
  placed: boolean;
  tier: number;
  /** Images a gun can show (parts/gun-….png). */
  images: string[];
  selected: number | null;
  onSelect: (i: number | null) => void;
  /** Change the ship's placed guns (starting from the standard ones if none are placed). */
  onChange: (fn: (guns: Gun[]) => void) => void;
  /** Go back to the standard guns. */
  onReset: () => void;
}) {
  const specs = balanceGuns('fighter', tier, guns);
  const gun = selected !== null ? guns[selected] : undefined;
  const spec = selected !== null ? specs[selected] : undefined;
  const edit = (fn: (g: Gun) => void) => selected !== null && onChange((list) => fn(list[selected]));
  const total = specs.reduce((sum, g) => sum + g.damage / g.interval, 0);

  return (
    <>
      <h2>Guns</h2>
      <div className="sa-note">
        {placed ? 'Placed by hand.' : 'Standard guns (1 at tier 1, 2 side by side above). Editing places a copy.'} The tier's damage is
        shared between its guns by size: {fmt(total)} damage per second here (tier budget {fmt(tierDps('fighter', tier))}).
      </div>
      <div className="sa-mounts">
        {guns.map((g, i) => (
          <button key={i} className={'sa-mount' + (selected === i ? ' on' : '')} onClick={() => onSelect(i)}>
            Gun {i + 1}
            <span className="sa-note">
              {' '}
              size {g.size} · {g.type} · {g.turret ? 'turret' : 'fixed'}
            </span>
          </button>
        ))}
      </div>
      <div className="sa-row sa-wrap">
        <button
          onClick={() => {
            onChange((list) => list.push({ x: 0, y: 0, angle: 0, size: tier, type: 'ballistic', turret: false }));
            onSelect(guns.length);
          }}
        >
          + Gun
        </button>
        {placed && (
          <button
            onClick={() => {
              onReset();
              onSelect(null);
            }}
            title="Remove the placed guns and use the standard ones"
          >
            Use standard guns
          </button>
        )}
      </div>

      {gun && spec && (
        <div className="sa-mount-edit">
          <h2>Gun {selected! + 1}</h2>
          <div className="sa-row">
            <NumberField label="x" value={gun.x} onChange={(v) => edit((g) => (g.x = Math.round(v)))} />
            <NumberField label="y" value={gun.y} onChange={(v) => edit((g) => (g.y = Math.round(v)))} />
            <NumberField label="Angle" value={gun.angle} step={5} onChange={(v) => edit((g) => (g.angle = v))} />
          </div>
          <label className="sa-row">
            <span>Size</span>
            <select value={gun.size} onChange={(e) => edit((g) => (g.size = Number(e.target.value)))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  Tier {n} shot
                </option>
              ))}
            </select>
          </label>
          <label className="sa-row">
            <span>Type</span>
            <select value={gun.type} onChange={(e) => edit((g) => (g.type = e.target.value as Gun['type']))}>
              {WEAPON_TYPES.map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="sa-row">
            <input type="checkbox" checked={gun.turret} onChange={(e) => edit((g) => (g.turret = e.target.checked))} /> Turret
            <span className="sa-note">
              {gun.turret
                ? ` turns ${Math.round((spec.turnRate * 180) / Math.PI)}°/s, up to ${CONFIG.guns.turretArc}° either side`
                : ' fires where it points'}
            </span>
          </label>
          <label className="sa-row">
            <span>Image</span>
            <select value={gun.image ?? ''} onChange={(e) => edit((g) => (e.target.value ? (g.image = e.target.value) : delete g.image))}>
              <option value="">None</option>
              {images.map((f) => (
                <option key={f} value={f}>
                  {baseName(f)}
                </option>
              ))}
            </select>
          </label>
          <div className="sa-note">
            {fmt(spec.damage)} damage per shot, every {spec.interval.toFixed(2)} s
          </div>
          <div className="sa-row sa-actions">
            <button
              title="A copy on the other side (top ↔ bottom)"
              onClick={() => {
                onChange((list) => list.push({ ...gun, y: -gun.y, angle: -gun.angle }));
                onSelect(guns.length);
              }}
            >
              Mirror copy
            </button>
            <button
              className="sa-danger"
              onClick={() => {
                onChange((list) => list.splice(selected!, 1));
                onSelect(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </>
  );
}
