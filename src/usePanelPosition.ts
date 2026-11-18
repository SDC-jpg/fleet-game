// A panel you can drag by its header and put anywhere in the window (used by the pause
// screen). Its position is remembered in this browser as an offset from its normal
// (centred) place, so it still makes sense when the window changes size. It always stays
// inside the window (with anything sticking out of it, like the Merge drawer), and it snaps
// back home when dragged close to its normal place (or on a double-click of the header).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { loadSetting, saveSetting } from './engine/settings';

/** Within this many pixels of its normal place, the panel snaps home. */
const SNAP = 30;

type Offset = { x: number; y: number };

function load(key: string): Offset {
  try {
    const o = JSON.parse(loadSetting(key) ?? '') as Offset;
    if (Number.isFinite(o.x) && Number.isFinite(o.y)) return o;
  } catch {
    // Nothing saved: its normal place.
  }
  return { x: 0, y: 0 };
}

/** The area the panel covers, with anything that sticks out of it (e.g. the Merge drawer). */
function coveredBox(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  let { left, top, right, bottom } = r;
  for (const child of el.querySelectorAll<HTMLElement>('[data-sticks-out]')) {
    const c = child.getBoundingClientRect();
    left = Math.min(left, c.left);
    top = Math.min(top, c.top);
    right = Math.max(right, c.right);
    bottom = Math.max(bottom, c.bottom);
  }
  return { left, top, right, bottom };
}

/** The offset closest to `want` that keeps the panel (now at `now`) inside the window. */
function clampOffset(el: HTMLElement, now: Offset, want: Offset): Offset {
  const b = coveredBox(el);
  const clamp1 = (v: number, cur: number, lo: number, hi: number, size: number) => {
    const min = cur - lo; // moving left/up by more than this leaves the window
    const max = cur + (size - hi);
    return max < min ? min : Math.min(max, Math.max(min, v));
  };
  return {
    x: clamp1(want.x, now.x, b.left, b.right, window.innerWidth),
    y: clamp1(want.y, now.y, b.top, b.bottom, window.innerHeight),
  };
}

/**
 * `ref`: the panel. Returns its offset (for a translate), header handlers to start dragging,
 * and whether it's snapped home while being dragged (for a little flash).
 */
export function usePanelPosition(ref: RefObject<HTMLElement | null>, key: string) {
  const [offset, setOffset] = useState<Offset>(() => load(key));
  const [moving, setMoving] = useState(false);
  const live = useRef(offset);
  live.current = offset;

  // Keep it inside the window when the window or the panel changes size.
  const keepInside = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const now = live.current;
    const next = clampOffset(el, now, now);
    if (next.x !== now.x || next.y !== now.y) setOffset(next);
  }, [ref]);
  useLayoutEffect(keepInside);
  useEffect(() => {
    window.addEventListener('resize', keepInside);
    const el = ref.current;
    const watch = el ? new ResizeObserver(keepInside) : null;
    if (el) watch!.observe(el);
    return () => {
      window.removeEventListener('resize', keepInside);
      watch?.disconnect();
    };
  }, [keepInside, ref]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Buttons, fields and tabs in the header still work as usual.
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select, textarea, a, label')) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const from = live.current;
    setMoving(true);
    const move = (ev: PointerEvent) => {
      let want = { x: from.x + ev.clientX - start.x, y: from.y + ev.clientY - start.y };
      if (Math.hypot(want.x, want.y) < SNAP) want = { x: 0, y: 0 };
      setOffset(clampOffset(el, live.current, want));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMoving(false);
      saveSetting(key, JSON.stringify(live.current));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Back to its normal place. */
  const reset = () => {
    setOffset({ x: 0, y: 0 });
    saveSetting(key, JSON.stringify({ x: 0, y: 0 }));
  };

  const home = offset.x === 0 && offset.y === 0;
  return {
    /** Add to the panel's centring transform. */
    translate: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
    headerProps: { onPointerDown, onDoubleClick: reset, title: home ? 'Drag to move' : 'Drag to move · double-click to put it back' },
    /** Being dragged and sitting in its normal place (show the snap). */
    snapped: moving && home,
    moving,
  };
}
