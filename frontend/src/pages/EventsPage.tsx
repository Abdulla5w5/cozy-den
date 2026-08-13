import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
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
  const { t, money } = useI18n();
  const d = new Date(e.event_date + 'T00:00:00');
  const [open, setOpen] = useState(false);

  const left = e.capacity === null ? null : Math.max(0, e.capacity - (e.seats_taken ?? 0));
  const full = left === 0;
  // External events are somebody else's; we only list those.
  const bookable = e.type === 'internal' && !full;

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
          {e.start_time ? `${e.start_time} · ` : e.event_time ? `${e.event_time} · ` : ''}
          {e.table_label ? `${e.table_label} · ` : ''}
          {e.location}
        </p>

        {e.type === 'internal' && (
          <div className="ev-seats">
            <span className={full ? 'ev-full' : 'ev-open'}>
              {left === null
                ? t('ev.openSeating')
                : full
                  ? t('ev.soldOut')
                  : t('ev.seatsLeft', { n: left })}
            </span>
            <span className="ev-price">
              {e.seat_price_cents > 0 ? money(e.seat_price_cents) : t('ev.freeSeat')}
            </span>
            {bookable && !open && (
              <button className="primary" onClick={() => setOpen(true)}>
                {t('ev.reserve')}
              </button>
            )}
          </div>
        )}

        {open && <ReserveForm e={e} onClose={() => setOpen(false)} />}
      </div>
    </article>
  );
}

/**
 * Reserving seats. A paid event hands the browser to the gateway exactly as
 * table checkout does; a free one confirms on the spot, because there is
 * nothing to charge.
 */
function ReserveForm({ e, onClose }: { e: EventItem; onClose: () => void }) {
  const { t, money } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [seats, setSeats] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const left = e.capacity === null ? 20 : Math.max(0, e.capacity - (e.seats_taken ?? 0));
  const maxSeats = Math.min(20, left || 1);
  const total = e.seat_price_cents * seats;

  useEffect(() => {
    // Prefill from the signed-in account, as the booking form does.
    api
      .get<{ user: { name: string; email: string; phone?: string | null } }>('/auth/me')
      .then((r) => {
        setName(r.user.name);
        setEmail(r.user.email);
        if (r.user.phone) setPhone(r.user.phone);
      })
      .catch(() => {});
  }, []);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ redirectUrl?: string; code?: string; free?: boolean }>(
        `/events/${e.id}/reserve`,
        { guestName: name, guestEmail: email, guestPhone: phone || undefined, seats },
      );
      if (res.redirectUrl) {
        window.location.assign(res.redirectUrl); // leave the SPA for the gateway
        return; // keep the spinner up while the browser navigates away
      }
      setDone(res.code ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('ev.reserveFailed'));
      setBusy(false);
    }
  }

  if (done !== null) {
    return (
      <div className="alert" role="status">
        {t('ev.reserved')} <strong>{done}</strong>
      </div>
    );
  }

  return (
    <form className="ev-reserve" onSubmit={submit}>
      {error && <div className="alert error">{error}</div>}
      <div className="row">
        <label className="field inline">
          {t('bk.name')}
          <input value={name} required onChange={(ev) => setName(ev.target.value)} />
        </label>
        <label className="field inline">
          {t('bk.email')}
          <input
            type="email"
            value={email}
            required
            onChange={(ev) => setEmail(ev.target.value)}
          />
        </label>
        <label className="field inline">
          {t('ev.phone')}
          <input value={phone} onChange={(ev) => setPhone(ev.target.value)} />
        </label>
        <label className="field inline">
          {t('ev.seats')}
          <select value={seats} onChange={(ev) => setSeats(Number(ev.target.value))}>
            {Array.from({ length: maxSeats }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ev-reserve-actions">
        <button type="button" onClick={onClose} disabled={busy}>
          {t('bk.back')}
        </button>
        <button className="primary" disabled={busy || !name || !email}>
          {busy
            ? t('bk.processing')
            : total > 0
              ? t('ev.payAndReserve', { amount: money(total) })
              : t('ev.confirmFree')}
        </button>
      </div>
    </form>
  );
}
