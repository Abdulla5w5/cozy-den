import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { Game } from '../types';
import { gameEmoji } from './gameEmoji';

const ART = ['art-emerald', 'art-amber', 'art-pink'];

// The library runs to hundreds of titles. Rendering all of them costs the
// customer's phone real work for cards most visitors never scroll to, so the
// list starts at one page and grows only when asked.
const PAGE_SIZE = 50;

type Variant = 'feature' | 'side' | 'small';

/** "2–6", or null when the range is not recorded yet — the library was imported
 *  from a sheet carrying titles and categories only. */
function playerRange(g: Game): string | null {
  return g.min_players && g.max_players ? `${g.min_players}–${g.max_players}` : null;
}

function GameCard({ g, variant, i }: { g: Game; variant: Variant; i: number }) {
  const { t } = useI18n();
  const amber = variant === 'side';
  const range = playerRange(g);
  return (
    <div className={`gcard bento-${variant} ${amber ? 'amber' : ''}`}>
      <div className={`gcard-art ${ART[i % ART.length]}`}>
        {g.image_url ? (
          <img className="gcard-img" src={g.image_url} alt={g.title} loading="lazy" />
        ) : (
          <span>{gameEmoji(g.title, g.category)}</span>
        )}
      </div>
      {/* The hover panel carries the game's own face and its details. It used
          to open with a line of flavour text keyed off the category, which the
          imported library turned into the same sentence on nearly every card —
          three hundred games all called a cozy-night favourite. */}
      <div className="game-pop" aria-hidden="true">
        <span className="game-pop-emoji">{gameEmoji(g.title, g.category)}</span>
        <span className="game-pop-meta">
          {range ? `${range} ${t('players')} · ` : ''}
          {g.category}
        </span>
      </div>
      <div className="gcard-body">
        {variant !== 'small' && (
          <span className={`badge ${amber ? 'amber' : 'primary'}`}>
            {t(variant === 'feature' ? 'games.featured' : 'games.trending')}
          </span>
        )}
        <h3>{g.title}</h3>
        <div className="tag-row">
          <span className="tag">{g.category}</span>
          {range && (
            <span className="tag">
              {range} {t('players')}
            </span>
          )}
        </div>
        {g.description && <p className="muted gcard-desc">{g.description}</p>}
        {g.purchase_url && (
          <a
            className="add-den buy-btn"
            href={g.purchase_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('gl.buy')}
          </a>
        )}
        <div className="gcard-foot">
          <span>{range ? `👥 ${range}` : ''}</span>
          <Link to="/book" className="card-link">
            {t('games.book')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export function GamesPage() {
  const { t } = useI18n();
  const [games, setGames] = useState<Game[]>([]);
  const [filter, setFilter] = useState('All');

  useEffect(() => {
    api.getCached<{ games: Game[] }>('/games').then((r) => setGames(r.games)).catch(() => {});
  }, []);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(games.map((g) => g.category))).sort()],
    [games]
  );
  const matching = useMemo(
    () => (filter === 'All' ? games : games.filter((g) => g.category === filter)),
    [games, filter],
  );
  const [limit, setLimit] = useState(PAGE_SIZE);
  // A new filter is a new list; start it at the top rather than carrying the
  // previous filter's scroll depth into it.
  useEffect(() => setLimit(PAGE_SIZE), [filter]);
  const shown = matching.slice(0, limit);
  const remaining = matching.length - shown.length;

  return (
    <div>
      <header className="page-header left">
        <span className="eyebrow">{t('games.eyebrow')}</span>
        <h1>{t('games.title')}</h1>
        <p className="muted">{t('games.sub')}</p>
      </header>

      {/* Partner store — customers who want to own a game they played here. */}
      <a
        className="store-banner"
        href="https://boardgamesq8.com/index.php?route=product/category&path=66"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="store-banner-icon" aria-hidden="true">
          🛍️
        </span>
        <span className="store-banner-copy">
          <strong>{t('gl.storeTitle')}</strong>
          <span className="muted">{t('gl.storeSub')}</span>
        </span>
        <span className="store-banner-cta">{t('gl.storeCta')}</span>
      </a>

      <div className="chips left">
        {categories.map((c) => (
          <button
            key={c}
            className={`chip ${filter === c ? 'active' : ''}`}
            onClick={() => setFilter(c)}
          >
            {c === 'All' ? t('games.all') : c}
          </button>
        ))}
      </div>

      <div className="bento">
        {shown.map((g, i) => (
          <GameCard
            key={g.id}
            g={g}
            i={i}
            variant={i === 0 ? 'feature' : i === 1 ? 'side' : 'small'}
          />
        ))}
      </div>

      {remaining > 0 && (
        <div className="load-more">
          <button className="primary" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            {t('gl.loadMore', { n: Math.min(PAGE_SIZE, remaining) })}
          </button>
        </div>
      )}

      {/* One count for the page, and it counts what the filter is showing —
          "12 of 12" under the Kids chip, not "12 of 329". */}
      {shown.length > 0 && (
        <p className="showing muted">
          {t('games.showing', { n: shown.length, total: matching.length })}
        </p>
      )}
    </div>
  );
}
