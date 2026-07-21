import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Game, MenuItem, money } from '../types';

export function Home() {
  const [games, setGames] = useState<Game[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);

  useEffect(() => {
    api.get<{ games: Game[] }>('/games').then((r) => setGames(r.games)).catch(() => {});
    api.get<{ items: MenuItem[] }>('/menu').then((r) => setMenu(r.items)).catch(() => {});
  }, []);

  return (
    <div className="home">
      {/* Hero */}
      <section className="hero">
        <span className="eyebrow">The ultimate midnight social hub</span>
        <h1 className="hero-title">
          Where every <span className="glow">move</span> matters, and every{' '}
          <span className="accent-text">game</span> tells a story.
        </h1>
        <p className="hero-sub">
          Book a table, pick from 100+ tabletop games, and pre-order food &amp; drink so it's
          waiting when you arrive. Your den, your rules.
        </p>
        <div className="hero-ctas">
          <Link to="/book" className="cta button">
            Claim Your Table
          </Link>
          <Link to="/games" className="ghost button">
            Explore Games
          </Link>
        </div>
        <div className="stats">
          <div className="stat">
            <strong>100+</strong>
            <span>Games on shelf</span>
          </div>
          <div className="stat">
            <strong>5</strong>
            <span>Cozy tables</span>
          </div>
          <div className="stat">
            <strong>Till 10pm</strong>
            <span>Last seating</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="section">
        <div className="section-head">
          <h2>How it works</h2>
          <p className="muted">Four steps from craving to checkmate.</p>
        </div>
        <div className="steps">
          {[
            ['event_seat', 'Pick a table', 'Choose a date and a 2-hour seating that fits your crew.'],
            ['casino', 'Choose a game', 'From quick party games to deep strategy epics.'],
            ['restaurant', 'Order ahead', 'Snacks and drinks, prepped for when you sit down.'],
            ['qr_code_2', 'Show your code', 'Pay online and flash your code at the counter.'],
          ].map(([, title, body], i) => (
            <div className="step" key={title}>
              <span className="step-num">{i + 1}</span>
              <h3>{title}</h3>
              <p className="muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Featured games */}
      <section className="section">
        <div className="section-head">
          <h2>Popular games</h2>
          <Link to="/games" className="see-all">
            See all →
          </Link>
        </div>
        <div className="feature-grid">
          {games.slice(0, 6).map((g) => (
            <div className="feature-card" key={g.id}>
              <span className="pill">{g.category}</span>
              <h3>{g.title}</h3>
              <p className="muted">
                {g.min_players}–{g.max_players} players
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Menu teaser */}
      <section className="section">
        <div className="section-head">
          <h2>On the menu</h2>
          <Link to="/menu" className="see-all">
            Full menu →
          </Link>
        </div>
        <div className="feature-grid">
          {menu.slice(0, 4).map((m) => (
            <div className="feature-card" key={m.id}>
              <span className="pill">{m.category}</span>
              <h3>{m.name}</h3>
              <p className="muted">{m.description}</p>
              <span className="price">{money(m.price_cents)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section className="cta-band">
        <h2>Your table is waiting.</h2>
        <p className="muted">Grab a seating before they're gone tonight.</p>
        <Link to="/book" className="cta button">
          Book a Table
        </Link>
      </section>
    </div>
  );
}
