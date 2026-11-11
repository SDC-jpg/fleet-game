// Keeps track of which keys and mouse buttons are currently held down.

export class Input {
  private keys = new Set<string>();
  /** How many times each key was pressed and not yet handled by `wasPressed`. */
  private presses = new Map<string, number>();
  /** Mouse position in CSS pixels, relative to the game canvas. */
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  private target: HTMLElement;
  /** When the last mouse-wheel step was counted (one scroll gesture = one step). */
  private lastWheel = 0;
  private cleanup: (() => void)[] = [];

  constructor(target: HTMLElement) {
    this.target = target;
    this.listen(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      this.keys.add(ev.code);
      // Count presses so fast repeats aren't lost (capped so unused keys can't pile up).
      this.presses.set(ev.code, Math.min((this.presses.get(ev.code) ?? 0) + 1, 20));
      if (ev.code === 'Space' || ev.code.startsWith('Arrow')) ev.preventDefault();
    });
    this.listen(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    this.listen(window, 'blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    this.listen(window, 'mousemove', (e) => {
      const rect = this.target.getBoundingClientRect();
      this.mouseX = (e as MouseEvent).clientX - rect.left;
      this.mouseY = (e as MouseEvent).clientY - rect.top;
    });
    this.listen(target, 'mousedown', (e) => {
      const button = (e as MouseEvent).button;
      if (button === 0) this.mouseDown = true;
      // Right-click counts as a press of "MouseRight" (read it with wasPressed).
      if (button === 2) this.presses.set('MouseRight', Math.min((this.presses.get('MouseRight') ?? 0) + 1, 20));
    });
    this.listen(window, 'mouseup', (e) => {
      if ((e as MouseEvent).button === 0) this.mouseDown = false;
    });
    this.listen(target, 'contextmenu', (e) => e.preventDefault());
    // Mouse wheel counts as presses of "WheelUp" / "WheelDown". Touchpads send
    // many small events per swipe, so steps closer than 150 ms count once.
    this.listen(
      target,
      'wheel',
      (e) => {
        const ev = e as WheelEvent;
        ev.preventDefault();
        const now = performance.now();
        if (ev.deltaY === 0 || now - this.lastWheel < 150) return;
        this.lastWheel = now;
        const code = ev.deltaY < 0 ? 'WheelUp' : 'WheelDown';
        this.presses.set(code, Math.min((this.presses.get(code) ?? 0) + 1, 20));
      },
      { passive: false },
    );
  }

  private listen(el: EventTarget, type: string, fn: (e: Event) => void, options?: AddEventListenerOptions) {
    el.addEventListener(type, fn, options);
    this.cleanup.push(() => el.removeEventListener(type, fn, options));
  }

  /** True if any of the given keys is held (uses KeyboardEvent.code, e.g. "KeyW"). */
  isDown(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  /**
   * True once per key press (holding the key repeats it, like typing).
   * Each call handles one press, so 10 quick presses are handled over 10 calls.
   * Use for one-off actions; use `isDown` for things like movement.
   */
  wasPressed(...codes: string[]) {
    for (const c of codes) {
      const n = this.presses.get(c) ?? 0;
      if (n > 0) {
        if (n === 1) this.presses.delete(c);
        else this.presses.set(c, n - 1);
        return true;
      }
    }
    return false;
  }

  destroy() {
    this.cleanup.forEach((fn) => fn());
  }
}
