import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Game } from '../types';

const ART = ['art-emerald', 'art-amber', 'art-pink'];
const EMOJI = ['🎲', '♟️', '🃏', '🧩', '🎯', '🀄'];

type Variant = 'feature' | 'side' | 'small';

function GameCard({ g, variant, i }: { g: Game; variant: Variant; i: number }) {
  const amber = variant === 'side';
  return (
    <div className={`gcard bento-${variant} ${amber ? 'amber' : ''}`}>
      <div className={`gcard-art ${ART[i % ART.length]}`}>
        <span>{EMOJI[i % EMOJI.length]}</span>
      </div>
      <div className="gcard-body">
        {variant !== 'small' && (
          <span className={`badge ${amber ? 'amber' : 'primary'}`}>
            {variant === 'feature' ? 'Featured' : 'Trending'}
          </span>
        )}
        <h3>{g.title}</h3>
        <div className="tag-row">
          <span className="tag">{g.category}</span>
          <span className="tag">
            {g.min_players}–{g.max_players} players
          </span>
        </div>
        <div className="gcard-foot">
          <span>
            👥 {g.min_players}–{g.max_players}
          </span>
          <Link to="/book" className="card-link">
            Book →
          </Link>
        </div>
      </div>
    </div>
  );
}

export function GamesPage() {
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
        <span className="eyebrow">The library</span>
        <h1>The Vault</h1>
        <p className="muted">
          From high-stakes strategy to midnight party chaos. Pick your poison and let the games
          begin.
        </p>
      </header>

      <div className="chips left">
        {categories.map((c) => (
          <button
            key={c}
            className={`chip ${filter === c ? 'active' : ''}`}
            onClick={() => setFilter(c)}
          >
            {c}
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
          Showing {shown.length} of {games.length} games
        </p>
      )}
    </div>
  );
}
