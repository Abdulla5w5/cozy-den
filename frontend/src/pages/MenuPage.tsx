import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { MenuItem } from '../types';

const EMOJI: Record<string, string> = { food: '🍽️', drink: '🥤' };
type Filter = 'All' | 'food' | 'drink';

export function MenuPage() {
  const { t, money } = useI18n();
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [filter, setFilter] = useState<Filter>('All');

  useEffect(() => {
    api.get<{ items: MenuItem[] }>('/menu').then((r) => setMenu(r.items)).catch(() => {});
  }, []);

  const sections = useMemo(() => {
    const defs: { key: 'food' | 'drink'; titleKey: string }[] = [
      { key: 'food', titleKey: 'menu.foodTitle' },
      { key: 'drink', titleKey: 'menu.drinkTitle' },
    ];
    return defs
      .filter((d) => filter === 'All' || filter === d.key)
      .map((d) => ({ ...d, items: menu.filter((m) => m.category === d.key) }));
  }, [menu, filter]);

  const filterLabel = (c: Filter) =>
    c === 'All' ? t('menu.all') : c === 'food' ? t('menu.food') : t('menu.drink');

  return (
    <div>
      <header className="page-header left">
        <span className="eyebrow">{t('menu.eyebrow')}</span>
        <h1>{t('menu.title')}</h1>
        <p className="muted">{t('menu.sub')}</p>
      </header>

      <div className="chips left sticky-filter">
        {(['All', 'food', 'drink'] as Filter[]).map((c) => (
          <button
            key={c}
            className={`chip ${filter === c ? 'active' : ''}`}
            onClick={() => setFilter(c)}
          >
            {filterLabel(c)}
          </button>
        ))}
      </div>

      {sections.map(
        (s) =>
          s.items.length > 0 && (
            <section className="section" key={s.key}>
              <div className="section-head">
                <h2 className="sec-primary">{t(s.titleKey)}</h2>
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
                        {t('menu.add')}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
      )}

      <section className="cta-band">
        <h2>{t('menu.ctaTitle')}</h2>
        <p className="muted">{t('menu.ctaSub')}</p>
        <Link to="/book" className="cta button">
          {t('menu.book')}
        </Link>
      </section>
    </div>
  );
}
