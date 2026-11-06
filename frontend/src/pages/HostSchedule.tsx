import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { formatHours } from '../types';

/**
 * "My host schedule" — the one page a game host has (migration 049). They add
 * the times they are free, remove ones nobody has booked, and see the groups
 * that booked them. Their price is set by the café, so it is shown, not edited.
 */
interface Profile {
  id: number;
  name: string;
  bio: string;
  photoUrl: string | null;
  hourlyCents: number;
  offersBoardGames: boolean;
  offersClocktower: boolean;
  offersDnd: boolean;
  isActive: boolean;
}
interface Window {
  id: number;
  date: string;
  timeSlot: string;
  durationMin: number;
}
interface Session {
  bookingId: number;
  date: string;
  timeSlot: string;
  durationMin: number;
  tableLabel: string;
  groupName: string;
  groupPhone: string | null;
  partySize: number;
  status: string;
  feeCents: number;
}
interface Schedule {
  profile: Profile;
  availability: Window[];
  sessions: Session[];
}

const OPEN = 14 * 60;
const CLOSE = 27 * 60; // 03:00 the next morning
const LAST_START = 26 * 60; // 02:00
const fmt = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (slot: string) => {
  const [h, m] = slot.split(':').map(Number);
  return h * 60 + m + (h < 14 ? 24 * 60 : 0);
};
const STARTS = Array.from({ length: (LAST_START - OPEN) / 30 + 1 }, (_, i) => fmt(OPEN + i * 30));

function todayKuwait(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}

export function HostSchedule() {
  const { t, money, lang } = useI18n();
  // "Thu 5 Nov" rather than 2026-11-05: a host reads this at a glance.
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(lang === 'ar' ? 'ar' : 'en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  const [data, setData] = useState<Schedule | null>(null);
  const [denied, setDenied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [date, setDate] = useState(todayKuwait());
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('23:00');

  useEffect(() => {
    api
      .get<Schedule>('/hosts/me')
      .then(setData)
      .catch(() => setDenied(true));
  }, []);

  // Ends from an hour after the start up to closing.
  const ends: string[] = [];
  for (let m = toMin(start) + 60; m <= CLOSE; m += 30) ends.push(fmt(m));
  const endValue = ends.includes(end) ? end : ends[ends.length - 1];

  async function add(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    try {
      const r = await api.post<Schedule>('/hosts/me/availability', {
        date,
        timeSlot: start,
        durationMin: toMin(endValue) - toMin(start),
      });
      setData(r);
      setNote(t('hs.added'));
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : t('pr.failed'));
    }
  }

  async function remove(id: number) {
    setNote(null);
    try {
      setData(await api.del<Schedule>(`/hosts/me/availability/${id}`));
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : t('pr.failed'));
    }
  }

  if (denied) {
    return (
      <div className="card">
        <p className="muted">{t('hs.notHost')}</p>
      </div>
    );
  }
  if (!data) return <p>{t('loading')}</p>;
  const p = data.profile;
  const until = (w: { timeSlot: string; durationMin: number }) =>
    fmt(toMin(w.timeSlot) + w.durationMin);

  return (
    <div className="host-schedule">
      <header className="page-header left">
        <span className="eyebrow">{t('hs.eyebrow')}</span>
        <h1>{t('hs.title')}</h1>
        <p className="muted">
          {p.name} ·{' '}
          {[
            p.offersBoardGames && t('host.kind.normal'),
            p.offersClocktower && t('host.kind.clocktower'),
            p.offersDnd && t('hs.dnd'),
          ]
            .filter(Boolean)
            .join(' + ')}
        </p>
      </header>

      {note && <p className="muted">{note}</p>}

      {!p.isActive && <p className="pay-return wait">{t('hs.inactive')}</p>}

      {p.isActive && (
      <form className="summary manual-form" onSubmit={add}>
        <h3>{t('hs.addTitle')}</h3>
        <p className="muted">{t('hs.addHelp')}</p>
        <div className="row">
          <label className="field inline">
            {t('pr.date')}
            <input
              type="date"
              value={date}
              min={todayKuwait()}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>
          <label className="field inline">
            {t('hs.from')}
            <select value={start} onChange={(e) => setStart(e.target.value)}>
              {STARTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="field inline">
            {t('hs.until')}
            <select value={endValue} onChange={(e) => setEnd(e.target.value)}>
              {ends.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button className="primary">{t('hs.add')}</button>
        </div>
      </form>
      )}

      <h3>{t('hs.freeTimes')}</h3>
      {data.availability.length === 0 ? (
        <p className="muted">{t('hs.noTimes')}</p>
      ) : (
        <ul className="host-list">
          {data.availability.map((w) => (
            <li key={w.id}>
              <span>
                <strong>{day(w.date)}</strong> · {w.timeSlot}–{until(w)}
              </span>
              <button type="button" className="link" onClick={() => remove(w.id)}>
                {t('pr.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>{t('hs.sessions')}</h3>
      {data.sessions.length === 0 ? (
        <p className="muted">{t('hs.noSessions')}</p>
      ) : (
        <div className="feature-grid">
          {data.sessions.map((s) => (
            <div className="feature-card" key={s.bookingId}>
              <div className="mcard-top">
                <span className={`status ${s.status}`}>{t(`status.${s.status}`)}</span>
                <span className="price">{money(s.feeCents)}</span>
              </div>
              <h3>
                {day(s.date)} · {s.timeSlot}–{until(s)}
              </h3>
              <p className="muted">
                {s.tableLabel} · {formatHours(s.durationMin)} h ·{' '}
                {t('bk.people', { n: s.partySize })}
              </p>
              <p>
                {s.groupName}
                {s.groupPhone && (
                  <>
                    {' · '}
                    <a href={`tel:${s.groupPhone}`} dir="ltr">
                      {s.groupPhone}
                    </a>
                  </>
                )}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
