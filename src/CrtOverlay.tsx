// The CRT screen effect over the HUD and menus (Settings → Screen effect → "Also over the HUD
// and menus"). The game view gets the full effect from the graphics card (engine/crt.ts); page
// elements can't go through that, so this lays the same colour stripes (the ui.crt-mask image,
// tiled) and dark corners over the whole page, and gives text a colour-fringed glow. The game
// view then leaves its own stripes and corners to this layer, so they aren't applied twice.

import { useEffect } from 'react';
import { useScreenEffect } from './game/screenEffect';

/** Shown only while the effect is on, set to cover the HUD, and drawable here. */
export function CrtOverlay() {
  const fx = useScreenEffect();
  return fx.enabled && fx.look.hud && fx.supported ? <Layers /> : null;
}

function Layers() {
  const fx = useScreenEffect();
  const p = fx.look;
  // Pixels of a 1080-pixel-tall screen → page pixels (same scale as the game view's effect).
  const k = window.innerHeight / 1080;

  // Text glow and colour fringes: set on the page, so all text inherits it.
  useEffect(() => {
    const body = document.body;
    body.classList.add('crt-hud');
    body.style.setProperty('--crt-fringe', `${Math.max(0.5, p.aberration * 0.5 * k)}px`);
    body.style.setProperty('--crt-fringe-alpha', String(Math.min(0.8, p.aberration * 0.25)));
    body.style.setProperty('--crt-glow', `${p.bloomRadius * 0.5 * k}px`);
    body.style.setProperty('--crt-glow-alpha', String(Math.min(1, p.bloom * 0.6)));
    body.style.setProperty('--crt-glow-color', p.bloomColor);
    return () => body.classList.remove('crt-hud');
  }, [p.aberration, p.bloomRadius, p.bloom, p.bloomColor, k]);

  return (
    // Two separate page-wide layers (not wrapped: a wrapper would stop the stripes multiplying
    // with the page below them).
    <>
      <div
        className="crt-layer crt-stripes"
        style={{
          backgroundImage: `url(${fx.mask.url})`,
          backgroundSize: `${fx.mask.width * Math.max(0.1, p.maskSize) * k}px 100%`,
          opacity: p.mask,
        }}
      />
      <div className="crt-layer crt-vignette" style={{ opacity: p.vignette }} />
    </>
  );
}
