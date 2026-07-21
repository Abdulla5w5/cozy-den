import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { MenuItem, money } from '../types';

const EMOJI: Record<string, string> = { food: '🍽️', drink: '🥤' };
type Filter = 'All' | 'food' | 'drink';

export function MenuPage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [filter, setFilter] = useState<Filter>('All');

  useEffect(() => {
    api.get<{ items: MenuItem[] }>('/menu').then((r) => setMenu(r.items)).catch(() => {});
  }, []);

  const sections = useMemo(() => {
    const defs: { key: 'food' | 'drink'; title: string }[] = [
      { key: 'food', title: 'Food' },
      { key: 'drink', title: 'Drinks' },
    ];
    return defs
      .filter((d) => filter === 'All' || filter === d.key)
      .map((d) => ({ ...d, items: menu.filter((m) => m.category === d.key) }));
  }, [menu, filter]);

  return (
    <div>
      <header className="page-header left">
        <span className="eyebrow">The provisions</span>
        <h1>The Provision Menu</h1>
        <p className="muted">
          Fuel your focus and satisfy the squad with our curated selection of high-energy snacks
          and refreshing beverages.
        </p>
      </header>

      <div className="chips left sticky-filter">
        {(['All', 'food', 'drink'] as Filter[]).map((c) => (
          <button
            key={c}
            className={`chip ${filter === c ? 'active' : ''}`}
            onClick={() => setFilter(c)}
          >
            {c === 'All' ? 'All Items' : c === 'food' ? 'Food' : 'Drinks'}
          </button>
        ))}
      </div>

      {sections.map(
        (s) =>
          s.items.length > 0 && (
            <section className="section" key={s.key}>
              <div className="section-head">
                <h2 className="sec-primary">{s.title}</h2>
                <div className="rule" />
              </div>
              <div className="menu-grid2">
                {s.items.map((m) => (
                  <div className="mcard" key={m.id}>
                    <div className={`mcard-art ${m.category === 'drink' ? 'art-pink' : 'art-amber'}`}>
                      <span>{EMOJI[m.category]}</span>
                    </div>
                    <div className="mcard-body">
                      <div className="mcard-top">
                        <h3>{m.name}</h3>
                        <span className="price">{money(m.price_cents)}</span>
                      </div>
                      <p className="muted">{m.description}</p>
                      <Link to="/book" className="add-den">
                        Add to Den →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
      )}

      <section className="cta-band">
        <h2>Hungry yet?</h2>
        <p className="muted">Add these to your booking at checkout.</p>
        <Link to="/book" className="cta button">
          Book a Table
        </Link>
      </section>
    </div>
  );
}
