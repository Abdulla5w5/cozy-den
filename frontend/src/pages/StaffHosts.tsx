import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { LoadFailed } from './WantedBoard';

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
  /** Library games this host can run. */
  gameIds: number[];
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
  gameIds: [] as number[],
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

interface Earning {
  hostId: number;
  name: string;
  sessions: number;
  minutes: number;
  onlineCents: number;
  counterCents: number;
}

/** What each host earned in a month, for paying them. */
function HostEarnings() {
  const { t, money } = useI18n();
  const [month, setMonth] = useState(() => todayKuwait().slice(0, 7));
  const [rows, setRows] = useState<Earning[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    let active = true;
    setRows(null);
    setFailed(false);
    api
      .get<{ earnings: Earning[] }>(`/staff/hosts/earnings?month=${month}`)
      .then((r) => active && setRows(r.earnings))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [month, tick]);

  const total = (rows ?? []).reduce((s, r) => s + r.onlineCents + r.counterCents, 0);

  return (
    <section className="host-earnings">
      <h3>{t('sh.earnings')}</h3>
      <p className="muted">{t('sh.earningsHelp')}</p>
      <label className="field inline">
        {t('staff.month')}
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </label>
      {failed ? (
        <LoadFailed onRetry={() => setTick((n) => n + 1)} />
      ) : rows === null ? (
        <p>{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="muted">{t('sh.earningsNone')}</p>
      ) : (
        <div className="table-scroll">
          <table className="host-earnings-table">
            <thead>
              <tr>
                <th>{t('sh.name')}</th>
                <th>{t('sh.earnSessions')}</th>
                <th>{t('sh.earnHours')}</th>
                <th>{t('sh.earnOnline')}</th>
                <th>{t('sh.earnCounter')}</th>
                <th>{t('sh.earnTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.hostId}>
                  <td>
                    <bdi>{r.name}</bdi>
                  </td>
                  <td>{r.sessions}</td>
                  <td>{r.minutes / 60}</td>
                  <td>{money(r.onlineCents)}</td>
                  <td>{money(r.counterCents)}</td>
                  <td>
                    <strong>{money(r.onlineCents + r.counterCents)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>{t('sh.earnAll')}</td>
                <td>
                  <strong>{money(total)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

export function StaffHosts() {
  const { t } = useI18n();
  const [hosts, setHosts] = useState<Host[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [games, setGames] = useState<{ id: number; title: string; is_active: boolean }[] | null>(null);
  const [gamesFailed, setGamesFailed] = useState(false);
  const [gameFilter, setGameFilter] = useState('');
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
    loadGames();
  }, []);

  function loadGames() {
    // Retired games too: a host's list keeps them, and they may come back.
    api
      .get<{ games: { id: number; title: string; is_active: boolean }[] }>('/games/all')
      .then((r) => {
        setGames([...r.games].sort((a, b) => a.title.localeCompare(b.title)));
        setGamesFailed(false);
      })
      .catch(() => setGamesFailed(true));
  }

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
      gameIds: h.gameIds,
    });
    setGameFilter('');
    setEditing(h.email);
    setNote(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setForm(EMPTY);
    setGameFilter('');
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
        // Not sent if the games never loaded, so a save cannot wipe them.
        ...(games ? { gameIds: form.gameIds } : {}),
      });
      setHosts(r.hosts);
      if (r.upcoming.length) setUpcoming({ name: form.displayName, sessions: r.upcoming });
      setForm(EMPTY);
      setGameFilter('');
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
        {gamesFailed && !games && <LoadFailed onRetry={loadGames} />}
        {games && (
          <fieldset className="host-games">
            <legend>{t('sh.games', { n: form.gameIds.length })}</legend>
            <input
              type="search"
              value={gameFilter}
              onChange={(e) => setGameFilter(e.target.value)}
              placeholder={t('sh.gamesFind')}
              aria-label={t('sh.gamesFind')}
              // Enter here must not save a half-filled host.
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            />
            <div className="host-games-list">
              {games
                .filter((g) => g.title.toLowerCase().includes(gameFilter.trim().toLowerCase()))
                .map((g) => (
                  <label className="terms-check" key={g.id}>
                    <input
                      type="checkbox"
                      checked={form.gameIds.includes(g.id)}
                      onChange={(e) =>
                        set(
                          'gameIds',
                          e.target.checked
                            ? [...form.gameIds, g.id]
                            : form.gameIds.filter((id) => id !== g.id),
                        )
                      }
                    />
                    <span>
                      {g.title}
                      {g.is_active ? '' : ` (${t('sh.gameRetired')})`}
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
        )}
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
              {games && h.gameIds.length > 0 && (
                <p className="muted">
                  {t('sh.canRun')}{' '}
                  {games
                    .filter((g) => h.gameIds.includes(g.id))
                    .map((g) => g.title)
                    .join(', ')}
                </p>
              )}
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

      <HostEarnings />
    </div>
  );
}
