import { useI18n } from '../i18n';
import { Game } from '../types';

// The four flat colours of the identity. Each game keeps one for good — taken
// from its title, not its position — so a card does not change colour when a
// filter reshuffles the list.
const TILES = ['gtile-orange', 'gtile-blue', 'gtile-red', 'gtile-yellow'];
export function tileFor(title: string) {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return TILES[h % TILES.length];
}

/** "2–6", or null when the range is not recorded yet — the library was imported
 *  from a sheet carrying titles and categories only. */
function playerRange(g: Game): string | null {
  return g.min_players && g.max_players ? `${g.min_players}–${g.max_players}` : null;
}

// Every card is the same size. The library used to open with an oversized
// "Featured" card and a tall "Trending" one, but in an A–Z list those labels
// only ever fell on whichever titles happened to sort first.
export function GameCard({ g }: { g: Game }) {
  const { t } = useI18n();
  const range = playerRange(g);
  return (
    <div className="gcard">
      {/* The brand's own device for every card: a flat colour panel with its
          game-piece pattern. A game with a photo sits on it whole, like the
          product shots in the brand book; one without gets its title as a
          sticker label — designed, never an empty slot or a stand-in emoji. */}
      <div className={`gcard-art brand-tile ${tileFor(g.title)}`}>
        {g.image_url ? (
          <img className="gcard-img" src={g.image_url} alt={g.title} loading="lazy" />
        ) : (
          <span className="tile-label" dir="auto">
            {g.title}
          </span>
        )}
      </div>
      <div className="gcard-body">
        <h3>{g.title}</h3>
        <div className="tag-row">
          <span className="tag">{g.category}</span>
          {range && (
            <span className="tag">
              {range} {t('players')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

