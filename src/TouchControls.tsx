// On-screen controls for touch screens (see engine/touch.ts): a thumbstick in
// the bottom-left corner (a knob inside a ring) that moves and turns your ship,
// and buttons in the bottom-right corner: Attack (hold, like left click) and
// Defend (like right click), with Dash and Boost below them; plus a pause
// button. Settings → Left-handed controls mirrors the layout. Each finger is followed separately, so you can steer and press at
// once. Drawn with CSS for now (.touch-* in index.css), so art can replace it.

import { useRef, useState } from 'react';
import type { Game } from './game/Game';

/** How far the knob can move from the middle, as a share of the ring's width (the ring's size is set in CSS). */
const STICK_REACH = 0.375;

function Stick({ game }: { game: Game }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const finger = useRef<number | null>(null);
  const center = useRef({ x: 0, y: 0 });
  /** How far the knob can move from the middle, in CSS pixels (from the ring's size when touched). */
  const radius = useRef(1);

  const move = (clientX: number, clientY: number) => {
    let dx = clientX - center.current.x;
    let dy = clientY - center.current.y;
    const d = Math.hypot(dx, dy);
    const R = radius.current;
    if (d > R) {
      dx *= R / d;
      dy *= R / d;
    }
    setKnob({ x: dx, y: dy });
    game.touch.stickX = dx / R;
    game.touch.stickY = dy / R;
  };
  const release = () => {
    finger.current = null;
    setKnob({ x: 0, y: 0 });
    game.touch.stickX = 0;
    game.touch.stickY = 0;
  };

  return (
    <div
      className="touch-stick"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        radius.current = r.width * STICK_REACH;
        finger.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => e.pointerId === finger.current && move(e.clientX, e.clientY)}
      onPointerUp={(e) => e.pointerId === finger.current && release()}
      onPointerCancel={(e) => e.pointerId === finger.current && release()}
    >
      <div className="touch-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

/** A button that's "held" while a finger is on it. `onPress` runs once per press. */
function HoldButton({ className, label, onChange, onPress }: { className: string; label: string; onChange?: (down: boolean) => void; onPress?: () => void }) {
  const [down, setDown] = useState(false);
  const set = (d: boolean) => {
    setDown(d);
    onChange?.(d);
  };
  return (
    <button
      className={'touch-button ' + className + (down ? ' down' : '')}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
        onPress?.();
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
    >
      {label}
    </button>
  );
}

/** `leftHanded`: the layout mirrored (thumbstick on the right, buttons on the left; labels unchanged). */
export function TouchControls({ game, leftHanded }: { game: Game; leftHanded: boolean }) {
  const t = game.touch;
  return (
    <div className={'touch-controls' + (leftHanded ? ' left-handed' : '')}>
      <Stick game={game} />
      <div className="touch-buttons">
        <div className="touch-row">
          <HoldButton className="big defend" label="Defend" onChange={(d) => (t.defend = d)} onPress={() => t.defendPresses++} />
          <HoldButton className="big attack" label="Attack" onChange={(d) => (t.attack = d)} />
        </div>
        <div className="touch-row">
          <HoldButton className="small" label="Dash" onPress={() => t.dashPresses++} />
          <HoldButton className="small" label="Boost" onChange={(d) => (t.boost = d)} />
        </div>
      </div>
      <button className="touch-pause" onClick={() => game.setPaused(true)} aria-label="Pause">
        ❚❚
      </button>
    </div>
  );
}
