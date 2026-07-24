import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { EventItem, Game, MenuItem } from '../types';

export function Home() {
  const { t, money } = useI18n();
  const [games, setGames] = useState<Game[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);

  useEffect(() => {
    api.get<{ games: Game[] }>('/games').then((r) => setGames(r.games)).catch(() => {});
    api.get<{ items: MenuItem[] }>('/menu').then((r) => setMenu(r.items)).catch(() => {});
    api
      .get<{ events: EventItem[] }>('/events?featured=true')
      .then((r) => setEvents(r.events))
      .catch(() => {});
  }, []);

  const steps = [
    ['home.step1', 'home.step1b'],
    ['home.step2', 'home.step2b'],
    ['home.step3', 'home.step3b'],
    ['home.step4', 'home.step4b'],
  ];

  return (
    <div className="home">
      <section className="hero">
        <span className="eyebrow">{t('home.eyebrow')}</span>
        <h1 className="hero-title">
          {t('home.title.a')} <span className="glow">{t('home.title.move')}</span>{' '}
          {t('home.title.b')} <span className="accent-text">{t('home.title.game')}</span>{' '}
          {t('home.title.c')}
        </h1>
        <p className="hero-sub">{t('home.sub')}</p>
        <div className="hero-ctas">
          <Link to="/book" className="cta button">
            {t('home.claim')}
          </Link>
          <Link to="/games" className="ghost button">
            {t('home.explore')}
          </Link>
        </div>
        <div className="stats">
          <div className="stat">
            <strong>100+</strong>
            <span>{t('home.stat.games')}</span>
          </div>
          <div className="stat">
            <strong>5</strong>
            <span>{t('home.stat.tables')}</span>
          </div>
          <div className="stat">
            <strong>{t('home.stat.hours')}</strong>
            <span>{t('home.stat.hoursSub')}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t('home.how')}</h2>
          <p className="muted">{t('home.howSub')}</p>
        </div>
        <div className="steps">
          {steps.map(([title, body], i) => (
            <div className="step" key={title}>
              <span className="step-num">{i + 1}</span>
              <h3>{t(title)}</h3>
              <p className="muted">{t(body)}</p>
            </div>
          ))}
        </div>
      </section>

      {events.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{t('ev.upcoming')}</h2>
            <Link to="/events" className="see-all">
              {t('ev.seeAll')}
            </Link>
          </div>
          <div className="ev-strip">
            {events.slice(0, 4).map((e) => (
              <Link to="/events" className="ev-card" key={e.id}>
                {e.image_url && <img className="ev-card-img" src={e.image_url} alt="" />}
                <span className={`pill ${e.type === 'external' ? 'ext' : ''}`}>
                  {e.type === 'internal' ? t('ev.internal') : t('ev.external')}
                </span>
                <h3>{e.title}</h3>
                <p className="muted">
                  {e.event_date}
                  {e.event_time ? ` · ${e.event_time}` : ''}
                </p>
                {e.description && <p className="muted ev-card-desc">{e.description}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>{t('home.popular')}</h2>
          <Link to="/games" className="see-all">
            {t('home.seeAll')}
          </Link>
        </div>
        <div className="feature-grid">
          {games.slice(0, 6).map((g) => (
            <div className="feature-card" key={g.id}>
              <span className="pill">{g.category}</span>
              <h3>{g.title}</h3>
              <p className="muted">
                {g.min_players}–{g.max_players} {t('players')}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t('home.onMenu')}</h2>
          <Link to="/menu" className="see-all">
            {t('home.fullMenu')}
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

      <section className="cta-band">
        <h2>{t('home.ctaTitle')}</h2>
        <p className="muted">{t('home.ctaSub')}</p>
        <Link to="/book" className="cta button">
          {t('home.book')}
        </Link>
      </section>
    </div>
  );
}
