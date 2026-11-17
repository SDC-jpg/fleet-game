// One level-up card, as it looks on the level-up screen. Also used by the
// card index (Settings), so both always look the same.

import type { CardInfo } from './game/progress';
import type { Game } from './game/Game';
import { SpriteIcon } from './CardScreen';
import { borderLook, textLook } from './rarityLook';

export function CardView({
  card,
  game,
  number,
  onPick,
  className = '',
  outline = false,
}: {
  card: CardInfo;
  game: Game | null;
  /** Shown in the corner (the key that picks it), if given. */
  number?: number;
  /** Clicking picks it (level-up screen); without it the card can't be clicked. */
  onPick?: () => void;
  className?: string;
  /** A thin 1 px outline in the rarity's colour instead of a glow (card index). */
  outline?: boolean;
}) {
  const border = card.rarity ? borderLook(card.rarity) : null;
  const glow =
    card.rarity && !card.rarity.holo ? { boxShadow: outline ? `0 0 0 1px ${card.rarity.color}` : `0 0 14px ${card.rarity.color}55` } : undefined;
  const Tag = onPick ? 'button' : 'div';
  return (
    <Tag
      className={`card ${border?.className ?? ''} ${card.rarity?.holo ? (outline ? 'holo-outline' : 'holo-glow') : ''} ${onPick ? '' : 'static'} ${className}`}
      style={{ ...border?.style, ...glow }}
      onClick={
        onPick
          ? (e: React.MouseEvent<HTMLElement>) => {
              onPick();
              e.currentTarget.blur(); // so Space doesn't press it again
            }
          : undefined
      }
    >
      {number !== undefined && <span className="number">{number}</span>}
      <SpriteIcon game={game} name={card.icon} size={64} />
      <span className="label">{card.label}</span>
      <span className="title">{card.title}</span>
      {card.rarity && (
        <span className={'rarity ' + textLook(card.rarity).className} style={textLook(card.rarity).style}>
          {card.rarity.name}
        </span>
      )}
      <span className="text">{card.text}</span>
    </Tag>
  );
}
