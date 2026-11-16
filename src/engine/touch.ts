// Touch screens (phones, tablets): the game shows on-screen controls instead of
// relying on keyboard and mouse. Detected from the device's main pointer being
// a finger; adding ?touch to the address forces them on (for testing on a PC).

export const IS_TOUCH_DEVICE =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).has('touch') || window.matchMedia('(pointer: coarse) and (hover: none)').matches);

/** What the on-screen controls are doing right now (read by Game.readControls). */
export interface TouchState {
  /** Thumbstick, -1..1 each way (0, 0 = let go). */
  stickX: number;
  stickY: number;
  attack: boolean;
  defend: boolean;
  boost: boolean;
  /** Presses not yet used by the game (dash and defence fire once per press). */
  dashPresses: number;
  defendPresses: number;
}

export const newTouchState = (): TouchState => ({ stickX: 0, stickY: 0, attack: false, defend: false, boost: false, dashPresses: 0, defendPresses: 0 });
