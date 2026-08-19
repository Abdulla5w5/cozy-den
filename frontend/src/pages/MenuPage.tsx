import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { MenuItem } from '../types';

const EMOJI: Record<string, string> = { food: '🍽️', drink: '🥤' };
type Filter = 'All' | 'food' | 'drink';

/**
 * The menu is grouped by its own headings — Coffee, Ramen, Ice Cream — rather
 * than lumped under "Food" and "Drinks". With ~185 items those two buckets were
 * an unbrowsable wall, and the headings are what the café actually publishes.
 *
 * Content is bilingual and comes from the database, so it cannot go through the
 * i18n dictionary the rest of the UI uses. Arabic falls back to the English
 * copy when a translation is missing, which is how a staff-added item behaves
 * until someone fills the Arabic in.
 */
export function MenuPage() {
  const { t, money, lang } = useI18n();
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [filter, setFilter] = useState<Filter>('All');

  useEffect(() => {
    api.getCached<{ items: MenuItem[] }>('/menu').then((r) => setMenu(r.items)).catch(() => {});
  }, []);

  const ar = lang === 'ar';
  const itemName = (m: MenuItem) => (ar && m.name_ar ? m.name_ar : m.name);
  const itemDesc = (m: MenuItem) => (ar && m.description_ar ? m.description_ar : m.description);

  const sections = useMemo(() => {
    const visible = menu.filter((m) => filter === 'All' || m.category === filter);
    // Preserve the order the API sends (Foodics' own menu order); Map keeps
    // first-seen insertion order, so no re-sorting is needed.
    const grouped = new Map<string, { title: string; category: string; items: MenuItem[] }>();
    for (const m of visible) {
      const key = m.section || m.category;
      let group = grouped.get(key);
      if (!group) {
        group = {
          title: (ar && m.section_ar ? m.section_ar : m.section) || t(`menu.${m.category}Title`),
          category: m.category,
          items: [],
        };
        grouped.set(key, group);
      }
      group.items.push(m);
    }
    return [...grouped.entries()].map(([key, g]) => ({ key, ...g }));
  }, [menu, filter, ar, t]);

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

      {/* Jump links: with this many sections, scrolling to "Ice Cream" by hand
          is the difference between a usable menu and a very long page. */}
      {sections.length > 1 && (
        <nav className="menu-jump" aria-label={t('menu.sectionsNav')}>
          {sections.map((s) => (
            <a key={s.key} href={`#menu-${encodeURIComponent(s.key)}`}>
              {s.title}
            </a>
          ))}
        </nav>
      )}

      {sections.map((s) => (
        <section className="section" key={s.key} id={`menu-${encodeURIComponent(s.key)}`}>
          <div className="section-head">
            <h2 className="sec-primary">{s.title}</h2>
            <div className="rule" />
          </div>
          <div className="menu-grid2">
            {s.items.map((m) => (
              <div className="mcard" key={m.id}>
                <div className={`mcard-art ${m.category === 'drink' ? 'art-pink' : 'art-amber'}`}>
                  {m.image_url ? (
                    /* Lazy + async so a 180-item menu costs only the cards the
                       visitor actually scrolls to, and decoding never blocks
                       the scroll. The coloured tile stays underneath as the
                       placeholder, so there is nothing to lay out twice. */
                    <img
                      src={m.image_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={480}
                      height={480}
                    />
                  ) : (
                    <span>{EMOJI[m.category]}</span>
                  )}
                </div>
                <div className="mcard-body">
                  <div className="mcard-top">
                    <h3>{itemName(m)}</h3>
                    {/* Zero is not "free" — it is how staff mark an item whose
                        price they have chosen not to publish. Show nothing
                        rather than "KD 0.000", and never label it free. */}
                    {m.price_cents > 0 && <span className="price">{money(m.price_cents)}</span>}
                  </div>
                  {itemDesc(m) && <p className="muted">{itemDesc(m)}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

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
