// The button that opens and closes the merge drawer. A placeholder: styled
// like the inventory filter buttons until it gets its own art. Only its look
// lives here; what it does is passed in. While AutoMerge (Mk. IV) is on, it
// fills up like the drawer's AutoMerge button, so it shows with the drawer closed.

import { forwardRef } from "react";

export const MergeToggle = forwardRef<
  HTMLButtonElement,
  {
    name: string;
    open: boolean;
    onToggle: () => void;
    /** AutoMerge's progress (0–1) while it's on; null when it's off. */
    autoProgress: number | null;
    style?: React.CSSProperties;
  }
>(function MergeToggle({ name, open, onToggle, autoProgress, style }, ref) {
  const auto = autoProgress !== null;
  return (
    <button
      ref={ref}
      className={"merge-toggle" + (open ? " on" : "") + (auto ? " auto" : "")}
      style={style}
      onClick={(e) => {
        onToggle();
        e.currentTarget.blur();
      }}
      title={
        auto
          ? `${name}: AutoMerge is on`
          : `${name}: merge 3 items of the same rarity into a better one`
      }
    >
      {auto && (
        <span
          className="auto-fill"
          style={{ width: `${Math.min(1, autoProgress) * 100}%` }}
        />
      )}
      <span className="label">{name}</span>
    </button>
  );
});
