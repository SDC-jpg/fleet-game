// ShipArt: the game's screen effect panel (presets, live default, sliders) in a floating
// window over the preview. Drag it by its title (remembered); it snaps back to the middle.
// The preview's own CRT switch is in the toolbar, so the game's on/off switch isn't shown here.

import { useRef } from 'react';
import { ScreenEffectPanel } from '../ScreenEffectPanel';
import { usePanelPosition } from '../usePanelPosition';

export function ScreenEffectWindow({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const place = usePanelPosition(ref, 'shipart.screen-effect-position');
  return (
    <div ref={ref} className={'sa-fx-window' + (place.snapped ? ' snapped' : '')} style={{ transform: place.translate }}>
      <div className={'sa-fx-head' + (place.moving ? ' moving' : '')} {...place.headerProps}>
        <h2>Screen effect</h2>
        <span className="sa-note">The game's look (CRT). Presets are saved in this browser.</span>
        <button onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      <ScreenEffectPanel showSwitch={false} hudLabel="Also over the HUD and menus (in the game)" />
    </div>
  );
}
