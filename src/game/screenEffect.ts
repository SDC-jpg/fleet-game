// The screen effect's settings and presets, shared by the game (Settings → Screen effect)
// and ShipArt. One per page; React panels follow it with `useScreenEffect`.
//
// - The **live default** is the preset everyone gets: public/assets/screen-effect.json,
//   loaded when the page opens (CONFIG.crt if that file is missing). It's set with
//   "Designate as live default", which only exists while running locally (`npm run dev`):
//   the dev server writes the file (tools/shipart-plugin.ts), and it goes live when pushed.
// - **Presets** are saved in this browser only. Browser storage belongs to the website's
//   address, so presets made locally never show on the published game, and each player's
//   presets stay in their own browser.
// - A player who never changes anything follows the live default, also when it changes in a
//   later version. Changing a slider makes their own copy (kept until they load the live
//   default again). On/off is a personal switch, not part of a preset; "over the HUD" is part
//   of the look (so the live default decides it), but players can still flip it.

import { useSyncExternalStore } from 'react';
import { CONFIG } from './config';
import { ASSET_ROOT } from '../engine/assets';
import type { CrtParams } from '../engine/crt';
import { loadSetting, saveSetting } from '../engine/settings';

/** Everything a preset holds: all the effect's settings except on/off. */
export type Look = Omit<CrtParams, 'enabled'>;
export interface Preset {
  id: string;
  name: string;
  look: Look;
}
/** The live default, as published. `id`: the local preset it was designated from. */
export interface LiveDefault {
  id: string | null;
  name: string;
  look: Look;
}

/** "Designate as live default" only works while running locally (the dev server writes the file). */
export const CAN_DESIGNATE = import.meta.env.DEV;
/** The id the live default goes by in the preset list. */
export const LIVE = 'live';

const STATE_KEY = 'fleet-game.screen-effect';
const PRESETS_KEY = 'fleet-game.screen-effect-presets';

function configLook(): Look {
  const { enabled: _, ...look } = CONFIG.crt as CrtParams;
  return look;
}

/** `raw`'s values for every setting `base` has (same kind of value), `base`'s for the rest. */
function cleanLook(raw: unknown, base: Look): Look {
  const out = { ...base } as Record<string, unknown>;
  if (raw && typeof raw === 'object')
    for (const [k, v] of Object.entries(raw)) if (k in out && typeof v === typeof out[k]) out[k] = v;
  return out as Look;
}

export function sameLook(a: Look, b: Look) {
  return (Object.keys(a) as (keyof Look)[]).every((k) => a[k] === b[k]);
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(loadSetting(key) ?? 'null');
  } catch {
    return null;
  }
}

class ScreenEffect {
  live: LiveDefault = { id: null, name: 'built-in', look: configLook() };
  /** The effect on or off (personal). */
  enabled = true;
  /** This browser's own look, or null = follow the live default. */
  own: Look | null = null;
  /** The preset last loaded or saved (an id, or LIVE), or null. */
  loaded: string | null = LIVE;
  presets: Preset[] = [];
  /** Set by whoever draws the effect: can this browser draw it? */
  supported = true;
  /** The stripe image, for the page overlay. */
  mask = { url: '', width: 3 };
  private version = 0;
  private listeners = new Set<() => void>();

  constructor() {
    this.readSaved();
    // Another tab of this site (e.g. ShipArt beside the game) changed them: follow along.
    window.addEventListener('storage', (e) => {
      if (e.key !== STATE_KEY && e.key !== PRESETS_KEY) return;
      this.readSaved();
      this.changed(false);
    });
  }

  /** Read this browser's saved settings and presets. */
  private readSaved() {
    const state = readJson(STATE_KEY) as { enabled?: boolean; own?: unknown; loaded?: string | null } | null;
    if (state) {
      if (typeof state.enabled === 'boolean') this.enabled = state.enabled;
      this.own = state.own ? cleanLook(state.own, this.live.look) : null;
      if (typeof state.loaded === 'string' || state.loaded === null) this.loaded = state.loaded;
    }
    const presets = readJson(PRESETS_KEY);
    if (Array.isArray(presets))
      this.presets = presets
        .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
        .map((p) => ({ id: p.id, name: p.name, look: cleanLook(p.look, configLook()) }));
  }

  /** Load the published live default (call before the game starts drawing). */
  async loadLive() {
    try {
      const res = await fetch(ASSET_ROOT + 'screen-effect.json', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      this.live = { id: typeof data.id === 'string' ? data.id : null, name: String(data.name ?? 'Live default'), look: cleanLook(data.look, configLook()) };
      // Fill in settings added since this browser saved its own look.
      if (this.own) this.own = cleanLook(this.own, this.live.look);
      this.changed(false);
    } catch {
      // No file (or offline): CONFIG.crt.
    }
  }

  /** The look in use. */
  get look(): Look {
    return this.own ?? this.live.look;
  }
  /** Everything the effect needs to draw. */
  get params(): CrtParams {
    return { enabled: this.enabled, ...this.look };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = () => this.version;

  private changed(save = true) {
    this.version++;
    if (save) {
      saveSetting(STATE_KEY, JSON.stringify({ enabled: this.enabled, own: this.own, loaded: this.loaded }));
      saveSetting(PRESETS_KEY, JSON.stringify(this.presets));
    }
    for (const fn of this.listeners) fn();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.changed();
  }
  /** Change some settings (makes this browser's own copy of the look). */
  set(change: Partial<Look>) {
    this.own = { ...this.look, ...change };
    this.changed();
  }
  /** Who's drawing it says whether it works here, and where the stripe image is. */
  setDrawInfo(supported: boolean, mask: { url: string; width: number }) {
    this.supported = supported;
    this.mask = mask;
    this.changed(false);
  }

  preset(id: string | null): Preset | LiveDefault | undefined {
    return id === LIVE ? this.live : this.presets.find((p) => p.id === id);
  }
  /** Use a preset's look (LIVE = follow the live default again). */
  load(id: string) {
    const p = this.preset(id);
    if (!p) return;
    this.own = id === LIVE ? null : { ...p.look };
    this.loaded = id;
    this.changed();
  }
  /** The loaded preset, if the sliders still match it. */
  get loadedPreset() {
    return this.preset(this.loaded);
  }
  /** The sliders differ from the loaded preset. */
  get edited() {
    const p = this.loadedPreset;
    return !!p && !sameLook(p.look, this.look);
  }
  saveAsNew(name: string) {
    const id = Math.random().toString(36).slice(2, 10);
    this.presets.push({ id, name: name.trim() || 'Preset', look: { ...this.look } });
    this.loaded = id;
    this.changed();
  }
  /** Save the current sliders into this preset. */
  update(id: string) {
    const p = this.presets.find((q) => q.id === id);
    if (!p) return;
    p.look = { ...this.look };
    this.loaded = id;
    this.changed();
  }
  rename(id: string, name: string) {
    const p = this.presets.find((q) => q.id === id);
    if (!p || !name.trim()) return;
    p.name = name.trim();
    this.changed();
  }
  remove(id: string) {
    this.presets = this.presets.filter((p) => p.id !== id);
    if (this.loaded === id) this.loaded = null;
    this.changed();
  }
  /** Is this preset the one designated as the live default? */
  isLive(id: string) {
    return this.live.id === id;
  }
  /** The live default came from this preset, but the preset changed since. */
  liveOutOfDate(id: string) {
    const p = this.presets.find((q) => q.id === id);
    return !!p && this.isLive(id) && !sameLook(p.look, this.live.look);
  }
  /** Local only: make this preset the live default (writes public/assets/screen-effect.json). Returns an error, or null. */
  async designate(id: string): Promise<string | null> {
    const p = this.presets.find((q) => q.id === id);
    if (!p || !CAN_DESIGNATE) return 'Only while running locally.';
    try {
      const res = await fetch('/__shipart/screen-effect', { method: 'POST', body: JSON.stringify({ id: p.id, name: p.name, look: p.look }) });
      if (!res.ok) return await res.text();
    } catch (e) {
      return (e as Error).message;
    }
    this.live = { id: p.id, name: p.name, look: { ...p.look } };
    this.changed(false);
    return null;
  }
}

/** The page's screen effect settings. */
export const screenEffect = new ScreenEffect();

/** React: re-render when the screen effect settings change. */
export function useScreenEffect() {
  useSyncExternalStore(screenEffect.subscribe, screenEffect.snapshot);
  return screenEffect;
}
