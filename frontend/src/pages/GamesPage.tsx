import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { Game } from '../types';

const ART = ['art-emerald', 'art-amber', 'art-pink'];
const EMOJI = ['🎲', '♟️', '🃏', '🧩', '🎯', '🀄'];
const FLAVOR_KEYS = ['Strategy', 'Family', 'Party', 'Cooperative', 'Abstract'];

type Variant = 'feature' | 'side' | 'small';

function GameCard({ g, variant, i }: { g: Game; variant: Variant; i: number }) {
  const { t } = useI18n();
  const amber = variant === 'side';
  const flavorKey = FLAVOR_KEYS.includes(g.category) ? `flavor.${g.category}` : 'flavor.default';
  return (
    <div className={`gcard bento-${variant} ${amber ? 'amber' : ''}`}>
      <div className={`gcard-art ${ART[i % ART.length]}`}>
        <span>{EMOJI[i % EMOJI.length]}</span>
      </div>
      <div className="game-pop" aria-hidden="true">
        <span className="game-pop-emoji">{EMOJI[i % EMOJI.length]}</span>
        <p>{t(flavorKey)}</p>
        <span className="game-pop-meta">
          {g.min_players}–{g.max_players} {t('players')} · {g.category}
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
          <span className="tag">
            {g.min_players}–{g.max_players} {t('players')}
          </span>
        </div>
        <div className="gcard-foot">
          <span>
            👥 {g.min_players}–{g.max_players}
          </span>
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
    api.get<{ games: Game[] }>('/games').then((r) => setGames(r.games)).catch(() => {});
  }, []);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(games.map((g) => g.category))).sort()],
    [games]
  );
  const shown = filter === 'All' ? games : games.filter((g) => g.category === filter);

  return (
    <div>
      <header className="page-header left">
        <span className="eyebrow">{t('games.eyebrow')}</span>
        <h1>{t('games.title')}</h1>
        <p className="muted">{t('games.sub')}</p>
      </header>

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

      {shown.length > 0 && (
        <p className="showing muted">
          {t('games.showing', { n: shown.length, total: games.length })}
        </p>
      )}
    </div>
  );
}
