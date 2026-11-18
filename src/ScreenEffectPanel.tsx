// The screen effect panel: on/off, presets (saved in this browser), the live default, and a
// slider per part of the effect. Used by the game's Settings → Screen effect and by ShipArt.
// Settings and presets live in game/screenEffect.ts.

import { useState } from 'react';
import './screenEffectPanel.css';
import { CAN_DESIGNATE, LIVE, useScreenEffect, type Look } from './game/screenEffect';

type NumericLook = { [K in keyof Look]: Look[K] extends number ? K : never }[keyof Look];

/** The sliders: setting, label, range and step. */
const SLIDERS: { key: NumericLook; label: string; min: number; max: number; step: number }[] = [
  { key: 'bloom', label: 'Glow', min: 0, max: 2, step: 0.05 },
  { key: 'bloomRadius', label: 'Glow spread', min: 1, max: 40, step: 1 },
  { key: 'bloomThreshold', label: 'Glow from brightness', min: 0, max: 1, step: 0.05 },
  { key: 'bloomTint', label: 'Glow tint', min: 0, max: 1, step: 0.05 },
  { key: 'aberration', label: 'Colour fringes', min: 0, max: 8, step: 0.25 },
  { key: 'curvature', label: 'Curved glass', min: 0, max: 0.3, step: 0.01 },
  { key: 'mask', label: 'Colour stripes', min: 0, max: 1, step: 0.05 },
  { key: 'maskSize', label: 'Stripe size', min: 0.5, max: 6, step: 0.25 },
  { key: 'scanlines', label: 'Scanlines', min: 0, max: 1, step: 0.05 },
  { key: 'vignette', label: 'Dark corners', min: 0, max: 1, step: 0.05 },
  { key: 'blackLift', label: 'Lifted blacks', min: 0, max: 1, step: 0.05 },
  { key: 'softness', label: 'Softness', min: 0, max: 1, step: 0.05 },
  { key: 'noise', label: 'Grain', min: 0, max: 0.3, step: 0.01 },
  { key: 'flicker', label: 'Flicker', min: 0, max: 0.2, step: 0.01 },
  { key: 'rollBand', label: 'Rolling band', min: 0, max: 0.3, step: 0.01 },
];

/** Typing in a name box mustn't reach the game's keys (M = sound, Esc = pause...). */
const keepKeys = (e: React.KeyboardEvent) => e.stopPropagation();

/**
 * `hudLabel`: what "over the HUD" means where the panel is shown. `showSwitch`: the game's
 * on/off button (ShipArt has its own switch for the preview instead).
 */
export function ScreenEffectPanel({ hudLabel = 'Also over the HUD and menus', showSwitch = true }: { hudLabel?: string; showSwitch?: boolean }) {
  const fx = useScreenEffect();
  const look = fx.look;
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [message, setMessage] = useState('');
  const loaded = fx.loadedPreset;

  const designate = async (id: string) => {
    const error = await fx.designate(id);
    setMessage(error ? `Not saved: ${error}` : 'Saved as the live default (public/assets/screen-effect.json). It goes live with the next push.');
  };

  return (
    <div className="screen-effect">
      {showSwitch && (
        <div className="fx-row">
          <button className={'crt-switch' + (fx.enabled ? ' on' : '')} onClick={() => fx.setEnabled(!fx.enabled)}>
            Screen effect: {fx.enabled ? 'On' : 'Off'}
          </button>
          <span className="note">
            {fx.supported ? 'An old CRT screen look: glow, colour fringes, curved glass, colour stripes.' : "This browser can't draw the effect (WebGL 2 isn't available)."}
          </span>
        </div>
      )}

      <div className={fx.enabled || !showSwitch ? '' : 'crt-off'}>
        <h3>Presets</h3>
        <div className="fx-presets">
          <div className={'fx-preset' + (fx.loaded === LIVE ? ' on' : '')}>
            <button className="fx-name" onClick={() => fx.load(LIVE)} title="Use the live default (and follow it when it changes)">
              Live default: {fx.live.name}
            </button>
            <span className="fx-live">LIVE</span>
          </div>
          {fx.presets.map((p) => (
            <div key={p.id} className={'fx-preset' + (fx.loaded === p.id ? ' on' : '')}>
              {renaming?.id === p.id ? (
                <input
                  className="fx-name-edit"
                  autoFocus
                  value={renaming.name}
                  onKeyDown={(e) => {
                    keepKeys(e);
                    if (e.key === 'Enter') {
                      fx.rename(p.id, renaming.name);
                      setRenaming(null);
                    } else if (e.key === 'Escape') setRenaming(null);
                  }}
                  onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                  onBlur={() => {
                    fx.rename(p.id, renaming.name);
                    setRenaming(null);
                  }}
                />
              ) : (
                <button className="fx-name" onClick={() => fx.load(p.id)} title="Use this preset">
                  {p.name}
                </button>
              )}
              {fx.isLive(p.id) && (
                <span className="fx-live" title="This preset is the live default">
                  LIVE{fx.liveOutOfDate(p.id) && <span className="fx-stale"> · out of date: designate again to update</span>}
                </span>
              )}
              <span className="fx-actions">
                {CAN_DESIGNATE && (!fx.isLive(p.id) || fx.liveOutOfDate(p.id)) && (
                  <button onClick={() => designate(p.id)} title="Make this the screen effect everyone gets by default (goes live with the next push)">
                    Designate as live default
                  </button>
                )}
                <button onClick={() => setRenaming({ id: p.id, name: p.name })} title="Rename">
                  Rename
                </button>
                <button className="fx-delete" onClick={() => fx.remove(p.id)} title="Delete this preset (from this browser)">
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
        <div className="fx-row fx-save">
          <span className="note">
            Now: {loaded ? (fx.loaded === LIVE ? `Live default (${fx.live.name})` : loaded.name) : 'your own settings'}
            {fx.edited && ' (changed)'}
          </span>
          {loaded && fx.loaded !== LIVE && fx.edited && (
            <button onClick={() => fx.update(fx.loaded!)} title="Save the sliders into this preset">
              Update “{loaded.name}”
            </button>
          )}
          <input
            className="fx-name-edit"
            placeholder="New preset name"
            value={newName}
            onKeyDown={(e) => {
              keepKeys(e);
              if (e.key === 'Enter' && newName.trim()) {
                fx.saveAsNew(newName);
                setNewName('');
              }
            }}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            disabled={!newName.trim()}
            onClick={() => {
              fx.saveAsNew(newName);
              setNewName('');
            }}
          >
            Save as new preset
          </button>
        </div>
        {message && <div className="note fx-message">{message}</div>}

        <label className="fx-row fx-hud">
          <input type="checkbox" checked={look.hud} onChange={(e) => fx.set({ hud: e.target.checked })} />
          <span>
            <b>{hudLabel}</b>
            <span className="note"> Colour stripes, dark corners and a glow on text. Off = only the game view.</span>
          </span>
        </label>
        <div className="crt-sliders">
          {SLIDERS.map((s) => (
            <label key={s.key} className="crt-slider">
              <span>{s.label}</span>
              <input type="range" min={s.min} max={s.max} step={s.step} value={look[s.key]} onChange={(e) => fx.set({ [s.key]: Number(e.target.value) })} />
              <span className="value">{look[s.key]}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
