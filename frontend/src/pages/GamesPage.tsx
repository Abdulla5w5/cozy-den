import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { Game } from '../types';
import { GameCard } from '../components/GameCard';

// The library runs to hundreds of titles. Rendering all of them costs the
// customer's phone real work for cards most visitors never scroll to, so the
// list starts at one page and grows only when asked.
const PAGE_SIZE = 50;

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
  // Alphabetical is the order the library is read in — someone looking for a
  // title they already have in mind should not have to hunt for it. Sorted
  // here rather than relying on the API's ORDER BY, so a category view is in
  // the same order as the full list, and localeCompare puts accented and
  // Arabic titles where a reader expects them instead of by code point.
  const matching = useMemo(() => {
    const list = filter === 'All' ? games : games.filter((g) => g.category === filter);
    // Letters first, numbers after: "0.01" and "777" are not what anyone
    // scans for first, and leading the list with them buried the A's.
    const numeric = (t: string) => (/^\d/.test(t.trim()) ? 1 : 0);
    return [...list].sort(
      (a, b) =>
        numeric(a.title) - numeric(b.title) ||
        a.title.localeCompare(b.title, undefined, { numeric: true }),
    );
  }, [games, filter]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const listRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  // A new filter is a new list: show it from its first title rather than
  // dropping the reader wherever the previous filter's scroll depth happened
  // to leave them, which on a 300-title library is usually past the end of the
  // shorter list they just asked for. The landing page is left alone.
  useEffect(() => {
    setLimit(PAGE_SIZE);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Measured after the shorter list has rendered, and applied as a relative
    // move: an absolute target computed beforehand overshoots, because
    // dropping to a dozen cards shortens the page under the scroll. The site
    // header is sticky, so the list is parked below it rather than beneath it.
    const raf = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      const topbar = document.querySelector<HTMLElement>('.topbar');
      const headerBottom = topbar?.getBoundingClientRect().bottom ?? 0;
      const delta = list.getBoundingClientRect().top - (headerBottom + 14);
      if (Math.abs(delta) > 1) {
        window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [filter]);
  const shown = matching.slice(0, limit);
  const remaining = matching.length - shown.length;

  return (
    <div className="games-page-pad">
      {/* One Book button for the whole library, floating clear of the page so
          it is in reach at any scroll depth — rather than one repeated on all
          three hundred cards. */}
      <Link to="/book" className="cta button games-book-float">
        {t('home.book')}
      </Link>

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

      <div className="game-grid" ref={listRef}>
        {shown.map((g) => (
          <GameCard key={g.id} g={g} />
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
