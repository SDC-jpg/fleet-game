// Keeps track of which keys and mouse buttons are currently held down.
//
// Cursor lock (a setting, for several monitors): the browser's pointer lock
// keeps the mouse inside the game. The real cursor is hidden meanwhile, so the
// game draws its own at (mouseX, mouseY), which then moves by the mouse's
// movement and stays inside the canvas. Browsers only allow locking after a
// click, and Esc always releases it.

export class Input {
  private keys = new Set<string>();
  /** How many times each key was pressed and not yet handled by `wasPressed`. */
  private presses = new Map<string, number>();
  /** Mouse position in CSS pixels, relative to the game canvas. */
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  /** Right mouse button held. */
  rightDown = false;
  /** Cursor lock is switched on (the lock itself starts with a click on the game). */
  cursorLock = false;
  /** Whether the game may lock the mouse now (not on menus or the end-of-run screen). The game sets this. */
  canLock: () => boolean = () => true;
  /** Called when the lock ends by itself (Esc, or switching windows), not when released with `unlock`. */
  onLockLost: (() => void) | null = null;
  /** When the lock was last lost (performance.now()), so the Esc that ended it isn't also read as a key press. */
  lockLostAt = -Infinity;
  private releasing = false;
  private target: HTMLElement;
  private cleanup: (() => void)[] = [];

  constructor(target: HTMLElement) {
    this.target = target;
    this.listen(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      this.keys.add(ev.code);
      // Count presses so fast repeats aren't lost (capped so unused keys can't pile up).
      this.presses.set(ev.code, Math.min((this.presses.get(ev.code) ?? 0) + 1, 20));
      // Tab opens the run log, so it mustn't move the browser's focus.
      if (ev.code === 'Space' || ev.code === 'Tab' || ev.code.startsWith('Arrow')) ev.preventDefault();
    });
    this.listen(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    this.listen(window, 'blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.rightDown = false;
    });
    this.listen(window, 'mousemove', (e) => {
      const ev = e as MouseEvent;
      const rect = this.target.getBoundingClientRect();
      if (this.locked) {
        // Locked: the mouse moves our own cursor, kept inside the game.
        this.mouseX = Math.max(0, Math.min(rect.width - 1, this.mouseX + ev.movementX));
        this.mouseY = Math.max(0, Math.min(rect.height - 1, this.mouseY + ev.movementY));
      } else {
        this.mouseX = ev.clientX - rect.left;
        this.mouseY = ev.clientY - rect.top;
      }
    });
    this.listen(document, 'pointerlockchange', () => {
      if (this.locked) return;
      this.mouseDown = false;
      this.rightDown = false;
      if (this.releasing) this.releasing = false;
      else {
        this.lockLostAt = performance.now();
        this.onLockLost?.();
      }
    });
    this.listen(target, 'mousedown', (e) => {
      const button = (e as MouseEvent).button;
      if (this.cursorLock && !this.locked) this.lock();
      if (button === 0) this.mouseDown = true;
      // Right-click counts as a press of "MouseRight" (read it with wasPressed).
      if (button === 2) {
        this.presses.set('MouseRight', Math.min((this.presses.get('MouseRight') ?? 0) + 1, 20));
        this.rightDown = true;
      }
    });
    this.listen(window, 'mouseup', (e) => {
      if ((e as MouseEvent).button === 0) this.mouseDown = false;
      if ((e as MouseEvent).button === 2) this.rightDown = false;
    });
    this.listen(target, 'contextmenu', (e) => e.preventDefault());
    // Mouse wheel over the game: "WheelDown" / "WheelUp" presses (read them with wasPressed).
    this.listen(target, 'wheel', (e) => {
      const dy = (e as WheelEvent).deltaY;
      if (dy === 0) return;
      const code = dy > 0 ? 'WheelDown' : 'WheelUp';
      this.presses.set(code, Math.min((this.presses.get(code) ?? 0) + 1, 20));
    });
  }

  /** True while the mouse is locked inside the game. */
  get locked() {
    return document.pointerLockElement === this.target;
  }

  /** Lock the mouse inside the game (only works during a click or key press). */
  lock() {
    if (!this.cursorLock || this.locked || !this.canLock()) return;
    try {
      const p = this.target.requestPointerLock() as unknown as Promise<void> | undefined;
      // Newer browsers return a promise that fails if locking isn't allowed right now.
      p?.catch?.(() => {});
    } catch {
      // Not allowed now (no click yet): the next click on the game tries again.
    }
  }

  /** Release the mouse (e.g. to use a menu). The game doesn't treat this as Esc. */
  unlock() {
    if (!this.locked) return;
    this.releasing = true;
    document.exitPointerLock();
  }

  private listen(el: EventTarget, type: string, fn: (e: Event) => void) {
    el.addEventListener(type, fn);
    this.cleanup.push(() => el.removeEventListener(type, fn));
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
    this.unlock();
    this.cleanup.forEach((fn) => fn());
  }
}
