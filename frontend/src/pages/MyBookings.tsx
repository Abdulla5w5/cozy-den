import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { Booking, formatHours, Game, HistoryEntry } from '../types';
import { QrPass } from '../components/QrPass';

/** Customer profile: booking history + the games they've logged playing. */
export function MyBookings() {
  const navigate = useNavigate();
  const { t, money } = useI18n();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  // The API withholds history until the address is confirmed — see
  // auth.routes.ts. Distinguish that from a genuinely empty history.
  const [unverified, setUnverified] = useState(false);

  useEffect(() => {
    api
      .get<{ bookings: Booking[]; emailUnverified?: boolean }>('/auth/bookings')
      .then((r) => {
        setBookings(r.bookings);
        setUnverified(r.emailUnverified === true);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) navigate('/register');
        else setBookings([]);
      });
  }, [navigate]);

  return (
    <div>
      <header className="page-header left">
        <span className="eyebrow">{t('nav.mybookings')}</span>
        <h1>{t('acct.title')}</h1>
        <p className="muted">{t('acct.sub')}</p>
      </header>

      {bookings === null ? (
        <p>{t('loading')}</p>
      ) : unverified ? (
        <div className="card">
          <p className="muted">{t('acct.verifyFirst')}</p>
        </div>
      ) : bookings.length === 0 ? (
        <div className="card">
          <p className="muted">{t('acct.empty')}</p>
          <Link to="/book" className="cta button" style={{ marginTop: '1rem' }}>
            {t('home.book')}
          </Link>
        </div>
      ) : (
        <div className="feature-grid">
          {bookings.map((b) => (
            <div className="feature-card" key={b.id}>
              <div className="mcard-top">
                <span className={`status ${b.status}`}>{t(`status.${b.status}`)}</span>
                <span className="price">{money(b.totalCents)}</span>
              </div>
              <h3>{b.tableLabel}</h3>
              <p className="muted">
                {b.date} · {b.timeSlot} ({t('bk.sessionHours', { n: formatHours(b.durationMin) })})
              </p>
              {/* Only bookings made from this account carry their code; one
                  staff entered under the same email does not. */}
              {b.verificationCode ? (
                <span className="tag">{b.verificationCode}</span>
              ) : (
                <span className="muted">{t('acct.codeAtCounter')}</span>
              )}
              {b.checkinToken && <BookingPass booking={b} />}
            </div>
          ))}
        </div>
      )}

      <SeatPasses />

      <GameHistory />
    </div>
  );
}

function GameHistory() {
  const { t } = useI18n();
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [gameId, setGameId] = useState<number | ''>('');
  const [playedDate, setPlayedDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api
      .get<{ history: HistoryEntry[] }>('/history')
      .then((r) => setHistory(r.history))
      .catch(() => setHistory([]));
  }

  useEffect(() => {
    load();
    api.get<{ games: Game[] }>('/games').then((r) => setGames(r.games)).catch(() => {});
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (gameId === '') return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api.post<{ alreadyLogged: boolean }>('/history', {
        gameId,
        playedDate,
      });
      if (r.alreadyLogged) setNote(t('gh.already'));
      setGameId('');
      load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    await api.del(`/history/${id}`).catch(() => {});
    load();
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="sec-primary">{t('gh.title')}</h2>
        <div className="rule" />
      </div>
      <p className="muted">{t('gh.sub')}</p>

      <form className="summary manual-form" onSubmit={add}>
        <div className="row">
          <label className="field inline">
            {t('gh.pick')}
            <select
              value={gameId}
              onChange={(e) => setGameId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">—</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field inline">
            {t('gh.date')}
            <input
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={playedDate}
              onChange={(e) => setPlayedDate(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy || gameId === ''}>
            {t('gh.save')}
          </button>
        </div>
        {note && <p className="muted">{note}</p>}
      </form>

      {history === null ? (
        <p>{t('loading')}</p>
      ) : history.length === 0 ? (
        <p className="muted">{t('gh.empty')}</p>
      ) : (
        <div className="feature-grid">
          {history.map((h) => (
            <div className="feature-card" key={h.id}>
              <span className="pill">{h.category}</span>
              <h3>{h.title}</h3>
              <p className="muted">{h.played_date}</p>
              <button className="link" onClick={() => remove(h.id)}>
                {t('gh.remove')}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** The QR pass for one of the customer's own bookings, opened on demand so a
 *  long history is not a wall of codes. Shown only while it would scan. */
function BookingPass({ booking }: { booking: Booking }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const yesterday = new Date(Date.now() + 3 * 3600_000 - 864e5).toISOString().slice(0, 10);
  if (!booking.checkinToken || booking.date < yesterday) return null;
  if (!['pending', 'arrived'].includes(booking.status)) return null;
  return (
    <div className="booking-pass">
      <button type="button" className="link" onClick={() => setOpen((o) => !o)}>
        {open ? t('qr.hide') : t('qr.show')}
      </button>
      {open && (
        <QrPass
          token={booking.checkinToken}
          lines={[`${booking.tableLabel} · ${booking.date}`, `${booking.timeSlot} · ${booking.partySize}`]}
        />
      )}
    </div>
  );
}

interface SeatPass {
  kind: 'event' | 'wanted';
  title: string;
  date: string;
  timeSlot: string | null;
  people: number;
  token: string;
  checkedIn: boolean;
}

/** Event and Wanted Board seats still to come, so a pass can always be found
 *  again after leaving the page that first showed it. */
function SeatPasses() {
  const { t } = useI18n();
  const [passes, setPasses] = useState<SeatPass[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ passes: SeatPass[] }>('/checkin/mine')
      .then((r) => setPasses(r.passes))
      .catch(() => setPasses([]));
  }, []);

  if (passes.length === 0) return null;
  return (
    <section className="section">
      <h2>{t('qr.seatPasses')}</h2>
      <div className="feature-grid">
        {passes.map((p) => (
          <div className="feature-card" key={p.token}>
            <span className="tag">{t(`ci.kind.${p.kind}`)}</span>
            <h3>{p.title}</h3>
            <p className="muted">
              {p.date}
              {p.timeSlot ? ` · ${p.timeSlot}` : ''} · {t('bk.people', { n: p.people })}
            </p>
            {p.checkedIn ? (
              <p className="muted">{t('ci.already')}</p>
            ) : (
              <div className="booking-pass">
                <button
                  type="button"
                  className="link"
                  onClick={() => setOpen(open === p.token ? null : p.token)}
                >
                  {open === p.token ? t('qr.hide') : t('qr.show')}
                </button>
                {open === p.token && (
                  <QrPass token={p.token} lines={[p.title, `${p.date} ${p.timeSlot ?? ''}`.trim()]} />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
