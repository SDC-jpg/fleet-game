// Decoration only: 1-pixel circuit-board traces linking the Merge Module
// button to the top-left of the inventory, and to the merge drawer while it's
// open. Drawn over the equipment screen (it never catches the mouse), from
// rectangles measured on screen, so custom art can replace it without touching
// the merge rules.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A trace: a 1-pixel line through these points, with a small pad at each end. */
function Trace({ points }: { points: [number, number][] }) {
  // +0.5 puts 1-pixel lines exactly on the pixel grid (crisp, not blurred over two pixels).
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${Math.round(x) + 0.5} ${Math.round(y) + 0.5}`).join(' ');
  const ends = [points[0], points[points.length - 1]];
  return (
    <>
      <path d={d} className="trace" />
      {ends.map(([x, y], i) => (
        <rect key={i} x={Math.round(x) - 1} y={Math.round(y) - 1} width={3} height={3} className="pad" />
      ))}
    </>
  );
}

/** Traces from the button's sides and bottom to the inventory's top-left corner, and to the drawer when open. */
export function CircuitLines({ button, inventory, drawer }: { button: Box; inventory: Box; drawer: Box | null }) {
  const b = button;
  const top = inventory.y; // the inventory's top edge
  const midY = b.y + b.h / 2;
  const left = inventory.x;
  const traces: [number, number][][] = [
    // Left side (lower half): out, down, into the inventory's left edge just below its corner.
    [
      [b.x, midY + 5],
      [left - 6, midY + 5],
      [left - 6, top + 6],
      [left, top + 6],
    ],
    // Bottom: two straight drops onto the inventory's top edge, one with a 45° bend.
    [
      [b.x + b.w * 0.3, b.y + b.h],
      [b.x + b.w * 0.3, top],
    ],
    [
      [b.x + b.w * 0.5, b.y + b.h],
      [b.x + b.w * 0.5, top - 6],
      [b.x + b.w * 0.5 - 6, top],
    ],
    // Right side: out, a 45° bend, down to the inventory's top edge.
    [
      [b.x + b.w, midY],
      [b.x + b.w + 8, midY],
      [b.x + b.w + 14, midY + 6],
      [b.x + b.w + 14, top],
    ],
  ];
  if (drawer) {
    // Two parallel traces from the left side (upper half): across the gap beside the
    // screen (above where the left trace turns down, so nothing crosses), down, and into the drawer.
    const gapX = (drawer.x + drawer.w + inventory.x - 20) / 2; // halfway between the drawer and the screen's edge
    [-5, -1].forEach((off, k) => {
      const x = gapX + (k ? 2 : -2);
      const y = drawer.y + 16 + k * 4;
      traces.push([
        [b.x, midY + off],
        [x, midY + off],
        [x, y],
        [drawer.x + drawer.w, y],
      ]);
    });
  }
  return (
    <svg className="circuit-lines">
      {traces.map((t, i) => (
        <Trace key={i} points={t} />
      ))}
    </svg>
  );
}
