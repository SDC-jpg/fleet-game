// The button that opens and closes the merge drawer. A placeholder: styled
// like the inventory filter buttons until it gets its own art. Only its look
// lives here; what it does is passed in.

import { forwardRef } from 'react';

export const MergeToggle = forwardRef<HTMLButtonElement, { open: boolean; onToggle: () => void; style?: React.CSSProperties }>(
  function MergeToggle({ open, onToggle, style }, ref) {
    return (
      <button
        ref={ref}
        className={'merge-toggle' + (open ? ' on' : '')}
        style={style}
        onClick={(e) => {
          onToggle();
          e.currentTarget.blur();
        }}
        title="Merge Module: merge 3 items of the same rarity into a better one"
      >
        Merge Module
      </button>
    );
  },
);
