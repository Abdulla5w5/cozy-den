import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';

/**
 * Admin: the café's game hosts (migration 049). A host is an existing account,
 * found by email, with a name, bio and photo, and ticks for what they offer:
 * normal hosting, Blood on the Clocktower, D&D. Customers pick an option rather
 * than a person and a free host is assigned, so the price lives on the option,
 * in the Pricing tab.
 */
interface Host {
  id: number;
  email: string;
  name: string;
  bio: string;
  photoUrl: string | null;
  hourlyCents: number;
  offersBoardGames: boolean;
  offersClocktower: boolean;
  offersDnd: boolean;
  isActive: boolean;
}

const EMPTY = {
  email: '',
  displayName: '',
  bio: '',
  photoUrl: '',
  offersBoardGames: true,
  offersClocktower: false,
  offersDnd: false,
  isActive: true,
};

// Service-night times: before 14:00 is the small hours of the next morning.
const OPEN = 14 * 60;
const CLOSE = 27 * 60;
const LAST_START = 26 * 60;
const fmt = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (slot: string) => {
  const [h, m] = slot.split(':').map(Number);
  return h * 60 + m + (h < 14 ? 24 * 60 : 0);
};
const STARTS = Array.from({ length: (LAST_START - OPEN) / 30 + 1 }, (_, i) => fmt(OPEN + i * 30));
const todayKuwait = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

interface Upcoming {
  date: string;
  timeSlot: string;
  tableLabel: string;
  groupName: string;
  groupPhone: string | null;
}

interface FreeTime {
  id: number;
  date: string;
  timeSlot: string;
  durationMin: number;
  booked: boolean;
}

/** One coach's free times: add, and delete any of them. */
function HostTimes({ host, onClose }: { host: Host; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [times, setTimes] = useState<FreeTime[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [date, setDate] = useState(todayKuwait());
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('23:00');
  const base = `/staff/hosts/${host.id}/availability`;

  useEffect(() => {
    api
      .get<{ availability: FreeTime[] }>(base)
      .then((r) => setTimes(r.availability))
      .catch(() => setTimes([]));
  }, [base]);

  const ends: string[] = [];
  for (let m = toMin(start) + 60; m <= CLOSE; m += 30) ends.push(fmt(m));
  const endValue = ends.includes(end) ? end : ends[ends.length - 1];
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(lang === 'ar' ? 'ar' : 'en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

  async function add(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    try {
      const r = await api.post<{ availability: FreeTime[] }>(base, {
        date,
        timeSlot: start,
        durationMin: toMin(endValue) - toMin(start),
      });
      setTimes(r.availability);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : t('pr.failed'));
    }
  }

  async function remove(w: FreeTime) {
    if (w.booked && !window.confirm(t('sh.deleteBookedTime'))) return;
    setNote(null);
    try {
      const r = await api.del<{ availability: FreeTime[] }>(`${base}/${w.id}`);
      setTimes(r.availability);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : t('pr.failed'));
    }
  }

  return (
    <div className="summary host-times">
      <div className="host-times-head">
        <h3>{t('sh.timesFor', { name: host.name })}</h3>
        <button type="button" className="link" onClick={onClose}>
          {t('sh.close')}
        </button>
      </div>
      {note && <p className="muted">{note}</p>}
      <form className="row" onSubmit={add}>
        <label className="field inline">
          {t('pr.date')}
          <input type="date" value={date} min={todayKuwait()} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field inline">
          {t('hs.from')}
          <select value={start} onChange={(e) => setStart(e.target.value)}>
            {STARTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          {t('hs.until')}
          <select value={endValue} onChange={(e) => setEnd(e.target.value)}>
            {ends.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button className="primary">{t('hs.add')}</button>
      </form>
      {times === null ? (
        <p>{t('loading')}</p>
      ) : times.length === 0 ? (
        <p className="muted">{t('hs.noTimes')}</p>
      ) : (
        <ul className="host-list">
          {times.map((w) => (
            <li key={w.id}>
              <span>
                <strong>{day(w.date)}</strong> · {w.timeSlot}–{fmt(toMin(w.timeSlot) + w.durationMin)}
                {w.booked && <span className="tag">{t('sh.hasBooking')}</span>}
              </span>
              <button type="button" className="link danger" onClick={() => remove(w)}>
                {t('sh.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StaffHosts() {
  const { t } = useI18n();
  const [hosts, setHosts] = useState<Host[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [note, setNote] = useState<string | null>(null);
  // Set while changing an existing coach: their email is then fixed, so an
  // edit can never turn into a second coach.
  const [editing, setEditing] = useState<string | null>(null);
  const [timesFor, setTimesFor] = useState<Host | null>(null);
  // Groups who have paid for a coach just removed: someone must sort them out.
  const [upcoming, setUpcoming] = useState<{ name: string; sessions: Upcoming[] } | null>(null);

  useEffect(() => {
    api
      .get<{ hosts: Host[] }>('/staff/hosts')
      .then((r) => setHosts(r.hosts))
      .catch(() => setHosts([]));
  }, []);

  function edit(h: Host) {
    setForm({
      email: h.email,
      displayName: h.name,
      bio: h.bio,
      photoUrl: h.photoUrl ?? '',
      offersBoardGames: h.offersBoardGames,
      offersClocktower: h.offersClocktower,
      offersDnd: h.offersDnd,
      isActive: h.isActive,
    });
    setEditing(h.email);
    setNote(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setForm(EMPTY);
    setEditing(null);
  }

  async function removeHost(h: Host) {
    if (!window.confirm(t('sh.deleteConfirm', { name: h.name }))) return;
    setNote(null);
    try {
      const r = await api.del<{
        outcome: 'deleted' | 'deactivated';
        upcoming: Upcoming[];
        hosts: Host[];
      }>(`/staff/hosts/${h.id}`);
      // Only ever replaced by another warning: this one needs acting on.
      if (r.upcoming.length) setUpcoming({ name: h.name, sessions: r.upcoming });
      setHosts(r.hosts);
      if (timesFor?.id === h.id) setTimesFor(null);
      if (editing === h.email) cancelEdit();
      setNote(r.outcome === 'deleted' ? t('sh.deleted') : t('sh.deactivated', { name: h.name }));
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : t('pr.failed'));
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    try {
      const r = await api.put<{ hosts: Host[]; upcoming: Upcoming[] }>('/staff/hosts', {
        email: form.email.trim(),
        displayName: form.displayName.trim(),
        bio: form.bio.trim(),
        photoUrl: form.photoUrl.trim() || null,
        offersBoardGames: form.offersBoardGames,
        offersClocktower: form.offersClocktower,
        offersDnd: form.offersDnd,
        isActive: form.isActive,
      });
      setHosts(r.hosts);
      if (r.upcoming.length) setUpcoming({ name: form.displayName, sessions: r.upcoming });
      setForm(EMPTY);
      setEditing(null);
      setNote(t('pr.saved'));
    } catch (err) {
      setNote(err instanceof Error ? err.message : t('pr.failed'));
    }
  }

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      {note && <p className="muted">{note}</p>}
      {upcoming && (
        <div className="pay-return bad" role="alert">
          <p>
            <strong>{t('sh.upcomingWarn', { name: upcoming.name })}</strong>
          </p>
          <ul>
            {upcoming.sessions.map((u) => (
              <li key={`${u.date}${u.timeSlot}`}>
                {u.date} {u.timeSlot} · {u.tableLabel} · {u.groupName}
                {u.groupPhone ? ` · ${u.groupPhone}` : ''}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="pay-return-x"
            onClick={() => setUpcoming(null)}
            aria-label={t('promo.close')}
          >
            ✕
          </button>
        </div>
      )}
      <form className="summary manual-form" onSubmit={save}>
        <h3>{editing ? t('sh.editing', { name: form.displayName }) : t('sh.title')}</h3>
        <p className="muted">{t('sh.help')}</p>
        <div className="row">
          <label className="field inline">
            {t('sh.email')}
            <input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              required
              dir="ltr"
              readOnly={editing !== null}
            />
          </label>
          <label className="field inline">
            {t('sh.name')}
            <input
              value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              maxLength={60}
              required
            />
          </label>
        </div>
        <label className="field">
          {t('sh.bio')}
          <textarea value={form.bio} onChange={(e) => set('bio', e.target.value)} maxLength={400} rows={2} />
        </label>
        <label className="field">
          {t('sh.photo')}
          <input
            value={form.photoUrl}
            onChange={(e) => set('photoUrl', e.target.value)}
            placeholder="https://… or /hosts/name.jpg"
            dir="ltr"
          />
        </label>
        <div className="row">
          <label className="terms-check">
            <input
              type="checkbox"
              checked={form.offersBoardGames}
              onChange={(e) => set('offersBoardGames', e.target.checked)}
            />
            <span>{t('host.kind.normal')}</span>
          </label>
          <label className="terms-check">
            <input
              type="checkbox"
              checked={form.offersClocktower}
              onChange={(e) => set('offersClocktower', e.target.checked)}
            />
            <span>{t('host.kind.clocktower')}</span>
          </label>
          <label className="terms-check">
            <input
              type="checkbox"
              checked={form.offersDnd}
              onChange={(e) => set('offersDnd', e.target.checked)}
            />
            <span>{t('sh.dnd')}</span>
          </label>
          <label className="terms-check">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
            />
            <span>{t('sh.active')}</span>
          </label>
          <button className="primary">{editing ? t('pr.save') : t('sh.addHost')}</button>
          {editing && (
            <button type="button" onClick={cancelEdit}>
              {t('sh.cancel')}
            </button>
          )}
        </div>
      </form>

      {timesFor && <HostTimes host={timesFor} onClose={() => setTimesFor(null)} />}

      {hosts === null ? (
        <p>{t('loading')}</p>
      ) : hosts.length === 0 ? (
        <p className="muted">{t('sh.none')}</p>
      ) : (
        <div className="feature-grid">
          {hosts.map((h) => (
            <div className="feature-card" key={h.id}>
              <div className="mcard-top">
                <span className="tag">{h.isActive ? t('pr.codeOn') : t('pr.codeOff')}</span>
              </div>
              <h3>{h.name}</h3>
              <p className="muted" dir="ltr">
                {h.email}
              </p>
              <p className="muted">
                {[
                  h.offersBoardGames && t('host.kind.normal'),
                  h.offersClocktower && t('host.kind.clocktower'),
                  h.offersDnd && t('hs.dnd'),
                ]
                  .filter(Boolean)
                  .join(' + ') || '—'}
              </p>
              <div className="host-actions">
                <button type="button" className="link" onClick={() => edit(h)}>
                  {t('sh.edit')}
                </button>
                <button type="button" className="link" onClick={() => setTimesFor(h)}>
                  {t('sh.times')}
                </button>
                <button type="button" className="link danger" onClick={() => removeHost(h)}>
                  {t('sh.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
