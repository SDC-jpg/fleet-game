// Small settings remembered in this browser (localStorage), e.g. test switches.
// Storage can be blocked (private windows), so failures are ignored: the
// setting then just isn't remembered.

export function loadSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the setting still works for this visit.
  }
}

/** Shared by the game and ShipArt: how rotated sprites are drawn (see renderer.ts). */
export const ROTATION_SETTING = 'fleet-game.rotation';
