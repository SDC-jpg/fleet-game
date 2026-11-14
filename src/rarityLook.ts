// How a rarity looks on screen: its colour as text or a border. Mythic is
// holographic: instead of one colour it gets a CSS class whose colour cycles
// smoothly through pastels (see .holo-* in index.css).

import type { CSSProperties } from 'react';

export interface RarityLook {
  color: string;
  holo?: boolean;
}

type Look = { className: string; style?: CSSProperties };

/** Text in the rarity's colour. */
export const textLook = (r: RarityLook): Look => (r.holo ? { className: 'holo-text' } : { className: '', style: { color: r.color } });

/** A border in the rarity's colour. */
export const borderLook = (r: RarityLook): Look => (r.holo ? { className: 'holo-border' } : { className: '', style: { borderColor: r.color } });

/** A filled square in the rarity's colour (filter buttons). */
export const fillLook = (r: RarityLook): Look => (r.holo ? { className: 'holo-fill' } : { className: '', style: { background: r.color } });
