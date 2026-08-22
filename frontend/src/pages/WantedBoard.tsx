import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { Game } from '../types';

/**
 * The Wanted Board — members advertise a game they will run and collect
 * expressions of interest.
 *
 * Nothing here is a booking and nothing is scheduled: a post names the one date
 * the session is for, and no time. Once a post fills, staff contact the
 * interested members and arrange the session by hand.
 *
 * The board deliberately shows only HOW MANY people are interested. Names and
 * contact details exist solely in the staff dashboard — the public API never
 * sends them, so there is nothing identifying here to leak.
 */

type SessionType = 'males_only' | 'females_only' | 'open';

interface Post {
  id: number;
  gameId: number | null;
  gameTitle: string;
  minPlayers: number;
  maxPlayers: number;
  sessionType: SessionType;
  sessionDate: string | null;
  preferredDays: number[];
  status: 'pending' | 'open' | 'completed' | 'rejected';
  interestCount: number;
  createdAt: string;
  /** Session length, and what reserving the listing costs. */
  durationMin?: number;
  /** Quoted price to reserve now — present on every open listing. */
  reserveCents?: number;
  /** Each player's share of the table total (display only for now). */
  perPlayerCents?: number;
  amountCents?: number;
  paymentState?: 'none' | 'pending_payment' | 'paid';
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** YYYY-MM-DD in the reader's locale, e.g. "Sun, 24 Aug 2026". */
export function formatSessionDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}

/** Today as YYYY-MM-DD, for the date input's floor. */
function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function WantedBoard() {
  const { t } = useI18n();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [mine, setMine] = useState<Post[]>([]);
  const [reservingId, setReservingId] = useState<number | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function loadBoard() {
    api
      .get<{ posts: Post[] }>('/wanted')
      .then((r) => setPosts(r.posts))
      .catch(() => setPosts([]));
  }

  function loadMine() {
    api
      .get<{ posts: Post[] }>('/wanted/mine')
      .then((r) => {
        setLoggedIn(true);
        setMine(r.posts);
      })
      .catch(() => setLoggedIn(false));
  }

  useEffect(() => {
    loadBoard();
    loadMine();
  }, []);

  /**
   * Take the listing and pay for it. Paid listings hand the browser to the
   * gateway exactly as table checkout does; the server confirms only after
   * re-retrieving the charge.
   */
  async function reserve(id: number) {
    setReservingId(id);
    try {
      const res = await api.post<{ redirectUrl?: string; free?: boolean }>(`/wanted/${id}/reserve`);
      if (res.redirectUrl) {
        window.location.assign(res.redirectUrl);
        return; // keep the spinner up while the browser navigates away
      }
      loadBoard();
    } catch (e) {
      setNote(e instanceof Error ? e.message : t('wb.reserveFailed'));
    } finally {
      setReservingId(null);
    }
  }

  return (
    <div>
      <header className="page-header left">
        <span className="eyebrow">{t('wb.eyebrow')}</span>
        <h1>{t('wb.title')}</h1>
        <p className="muted">{t('wb.sub')}</p>
      </header>

      {note && <p className="muted">{note}</p>}

      {loggedIn ? (
        <button className="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? t('wb.close') : t('wb.postOne')}
        </button>
      ) : (
        <div className="card">
          <p className="muted">{t('wb.signInToPost')}</p>
          <Link to="/register" className="cta button" style={{ marginTop: '1rem' }}>
            {t('nav.login')}
          </Link>
        </div>
      )}

      {showForm && loggedIn && (
        <PostForm
          onDone={() => {
            setShowForm(false);
            setNote(t('wb.pendingReview'));
            loadMine();
          }}
        />
      )}

      {mine.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="sec-primary">{t('wb.mine')}</h2>
            <div className="rule" />
          </div>
          <div className="feature-grid">
            {mine.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="sec-primary">{t('wb.open')}</h2>
          <div className="rule" />
        </div>
        {posts === null ? (
          <p>{t('loading')}</p>
        ) : posts.length === 0 ? (
          <p className="muted">{t('wb.empty')}</p>
        ) : (
          <div className="feature-grid">
            {posts.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                canReserve={loggedIn && p.status === 'open' && p.paymentState === 'none'}
                onReserve={() => reserve(p.id)}
                reserving={reservingId === p.id}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PostCard({
  post,
  canReserve,
  onReserve,
  reserving,
}: {
  post: Post;
  canReserve?: boolean;
  onReserve?: () => void;
  reserving?: boolean;
}) {
  const { t, money } = useI18n();
  // New listings carry an exact date; older ones only ever had weekdays.
  const days = post.sessionDate
    ? formatSessionDate(post.sessionDate)
    : post.preferredDays.map((d) => t(`day.${DAY_KEYS[d]}`)).join(' · ');

  return (
    <div className="feature-card">
      <div className="mcard-top">
        <span className={`status ${post.status}`}>{t(`wb.status.${post.status}`)}</span>
        <span className="tag">{t(`wb.type.${post.sessionType}`)}</span>
      </div>
      <h3>{post.gameTitle}</h3>
      <p className="muted">
        {t('wb.players', { min: post.minPlayers, max: post.maxPlayers })}
      </p>
      <p className="muted">{days}</p>
      {post.durationMin ? (
        <p className="muted">{t('wb.length', { n: post.durationMin / 60 })}</p>
      ) : null}
      {post.paymentState === 'paid' ? (
        <span className="pill">{t('wb.reservedAlready')}</span>
      ) : (
        <>
          {post.status === 'completed' ? <span className="pill">{t('wb.full')}</span> : null}
          {/* Reserving is the only action now — expressing interest was dropped,
              since it committed to nothing. Open to any signed-in member, the
              poster included; whoever reserves pays for the table. The price is
              quoted from the listing (reserveCents) before anyone reserves. */}
          {canReserve && post.reserveCents ? (
            <>
              {post.perPlayerCents ? (
                <p className="muted wb-per-player">
                  {t('wb.perPlayer', { amount: money(post.perPlayerCents) })}
                </p>
              ) : null}
              <button className="cta" onClick={onReserve} disabled={reserving}>
                {reserving
                  ? t('bk.processing')
                  : t('wb.reserveFor', { amount: money(post.reserveCents) })}
              </button>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function PostForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [games, setGames] = useState<Game[]>([]);
  const [gameId, setGameId] = useState<number | ''>('');
  const [gameName, setGameName] = useState('');
  const [minPlayers, setMinPlayers] = useState(2);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [sessionType, setSessionType] = useState<SessionType>('open');
  // Whole blocks, same as a table booking. The price follows from this and is
  // worked out server-side, so the form never sends an amount.
  const [durationMin, setDurationMin] = useState(120);
  const [sessionDate, setSessionDate] = useState('');
  // Mandatory. The server refuses without it and the database has a CHECK
  // constraint, so this is a courtesy to the poster, not the actual guard.
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ games: Game[] }>('/games')
      .then((r) => setGames(r.games))
      .catch(() => setGames([]));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ack) return setError(t('wb.ackRequired'));
    if (!sessionDate) return setError(t('wb.dateRequired'));
    if (sessionDate < today()) return setError(t('wb.datePast'));
    if (gameId === '' && !gameName.trim()) return setError(t('wb.gameRequired'));
    if (maxPlayers < minPlayers) return setError(t('wb.rangeBad'));

    setBusy(true);
    try {
      await api.post('/wanted', {
        gameId: gameId === '' ? null : gameId,
        gameName: gameId === '' ? gameName.trim() : null,
        minPlayers,
        maxPlayers,
        sessionType,
        durationMin,
        sessionDate,
        acknowledgmentConfirmed: ack,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('wb.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="summary manual-form" onSubmit={submit}>
      <div className="row">
        <label className="field inline">
          {t('wb.game')}
          <select
            value={gameId}
            onChange={(e) => setGameId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">{t('wb.notInLibrary')}</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
        {gameId === '' && (
          <label className="field inline">
            {t('wb.gameName')}
            <input value={gameName} onChange={(e) => setGameName(e.target.value)} maxLength={160} />
          </label>
        )}
      </div>

      <div className="row">
        <label className="field inline">
          {t('wb.min')}
          <input
            type="number"
            min={1}
            max={50}
            value={minPlayers}
            onChange={(e) => setMinPlayers(Number(e.target.value))}
          />
        </label>
        <label className="field inline">
          {t('wb.max')}
          <input
            type="number"
            min={1}
            max={50}
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
          />
        </label>
        <label className="field inline">
          {t('wb.type')}
          <select value={sessionType} onChange={(e) => setSessionType(e.target.value as SessionType)}>
            <option value="open">{t('wb.type.open')}</option>
            <option value="males_only">{t('wb.type.males_only')}</option>
            <option value="females_only">{t('wb.type.females_only')}</option>
          </select>
        </label>
        <label className="field inline">
          {t('wb.sessionLength')}
          <select value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
            {[120, 240, 360].map((m) => (
              <option key={m} value={m}>
                {t('wb.length', { n: m / 60 })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field inline">
        {t('wb.date')}
        <input
          type="date"
          min={today()}
          value={sessionDate}
          onChange={(e) => setSessionDate(e.target.value)}
        />
      </label>

      <label className="field">
        <span>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{' '}
          {t('wb.ack')}
        </span>
      </label>

      {error && <p className="muted">{error}</p>}
      <p className="muted">{t('wb.reviewNote')}</p>
      <button className="primary" disabled={busy || !ack}>
        {busy ? t('wb.posting') : t('wb.submit')}
      </button>
    </form>
  );
}
