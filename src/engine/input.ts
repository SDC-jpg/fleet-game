// Keeps track of which keys and mouse buttons are currently held down.

export class Input {
  private keys = new Set<string>();
  /** Mouse position in CSS pixels, relative to the game canvas. */
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  private target: HTMLElement;
  private cleanup: (() => void)[] = [];

  constructor(target: HTMLElement) {
    this.target = target;
    this.listen(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      this.keys.add(ev.code);
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
      if ((e as MouseEvent).button === 0) this.mouseDown = true;
    });
    this.listen(window, 'mouseup', (e) => {
      if ((e as MouseEvent).button === 0) this.mouseDown = false;
    });
    this.listen(target, 'contextmenu', (e) => e.preventDefault());
  }

  private listen(el: EventTarget, type: string, fn: (e: Event) => void) {
    el.addEventListener(type, fn);
    this.cleanup.push(() => el.removeEventListener(type, fn));
  }

  /** True if any of the given keys is held (uses KeyboardEvent.code, e.g. "KeyW"). */
  isDown(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  destroy() {
    this.cleanup.forEach((fn) => fn());
  }
}
