import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { EventItem } from '../types';

type Filter = 'all' | 'internal' | 'external';

/** Our Calendar — grouped-by-month list (clearer than a month grid on mobile). */
export function EventsPage() {
  const { t } = useI18n();
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    api
      .get<{ events: EventItem[] }>('/events')
      .then((r) => setEvents(r.events))
      .catch(() => setEvents([]));
  }, []);

  const shown = (events ?? []).filter((e) => filter === 'all' || e.type === filter);

  // Group into "August 2026" buckets, preserving the API's date ordering.
  const months = useMemo(() => {
    const out: { key: string; label: string; items: EventItem[] }[] = [];
    for (const e of shown) {
      const d = new Date(e.event_date + 'T00:00:00');
      const key = e.event_date.slice(0, 7);
      const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      let bucket = out.find((m) => m.key === key);
      if (!bucket) out.push((bucket = { key, label, items: [] }));
      bucket.items.push(e);
    }
    return out;
  }, [shown]);

  return (
    <div>
      <header className="page-header left">
        <span className="eyebrow">{t('ev.eyebrow')}</span>
        <h1>{t('ev.title')}</h1>
        <p className="muted">{t('ev.sub')}</p>
      </header>

      <div className="chips left">
        {(['all', 'internal', 'external'] as Filter[]).map((f) => (
          <button
            key={f}
            className={`chip ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? t('ev.all') : f === 'internal' ? t('ev.internal') : t('ev.external')}
          </button>
        ))}
      </div>

      {events === null ? (
        <p>{t('loading')}</p>
      ) : months.length === 0 ? (
        <p className="muted">{t('ev.none')}</p>
      ) : (
        months.map((m) => (
          <section className="section" key={m.key}>
            <div className="section-head">
              <h2 className="sec-primary">{m.label}</h2>
              <div className="rule" />
            </div>
            <div className="ev-list">
              {m.items.map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

export function EventRow({ e }: { e: EventItem }) {
  const { t } = useI18n();
  const d = new Date(e.event_date + 'T00:00:00');
  return (
    <article className={`ev-row ${e.type}`}>
      <div className="ev-date">
        <strong>{d.getDate()}</strong>
        <span>{d.toLocaleDateString(undefined, { month: 'short' })}</span>
      </div>
      <div className="ev-body">
        <div className="ev-head">
          <h3>{e.title}</h3>
          <span className={`pill ${e.type === 'external' ? 'ext' : ''}`}>
            {e.type === 'internal' ? t('ev.internal') : t('ev.external')}
          </span>
        </div>
        {e.description && <p className="muted">{e.description}</p>}
        <p className="ev-meta">
          {e.event_time ? `${e.event_time} · ` : ''}
          {e.location}
        </p>
      </div>
    </article>
  );
}
