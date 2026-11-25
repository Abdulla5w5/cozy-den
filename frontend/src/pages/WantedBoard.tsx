import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { formatDay } from '../formatDay';
import { useI18n } from '../i18n';
import { Roadmap } from '../components/Roadmap';
import { PaymentReturnNotice } from '../components/PaymentReturnNotice';
import { Game } from '../types';

/**
 * The Wanted Board — members advertise a game they will run and collect
 * expressions of interest.
 *
 * A post names its date and start time; staff arrange the table.
 *
 * The board shows counts and the poster's chosen username only. Names and
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
  startTime: string | null;
  started: boolean;
  ended: boolean;
  imageUrl: string | null;
  postedBy: string | null;
  preferredDays: number[];
  status: 'pending' | 'open' | 'completed' | 'rejected';
  interestCount: number;
  createdAt: string;
  /** Session length, and what reserving the listing costs. */
  durationMin?: number;
  /** What ONE seat on this listing costs. */
  perPlayerCents?: number;
  /** Seats sold or held, and seats still going. */
  seatsTaken?: number;
  seatsLeft?: number;
}

interface Member {
  username: string | null;
  subscribed: boolean;
  emailVerified: boolean;
}

// The café's starts that fit a 2-hour session: 14:00 to 01:00.
const STARTS = Array.from({ length: 23 }, (_, i) => {
  const m = (14 * 60 + i * 30) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});
const LENGTHS = [120, 180, 240, 300, 360];
const NOTICE_MS = 24 * 60 * 60 * 1000;

/** Minutes into the night: before 14:00 is the small hours after it. */
function nightMinutes(slot: string): number {
  const [h, m] = slot.split(':').map(Number);
  return h * 60 + m + (h < 14 ? 24 * 60 : 0);
}

const startsAt = (date: string, slot: string) =>
  Date.parse(`${date}T00:00:00+03:00`) + nightMinutes(slot) * 60_000;

/** "19:00–21:00". */
function sessionTime(start: string, durationMin: number): string {
  const end = (nightMinutes(start) + durationMin) % (24 * 60);
  // Isolated left-to-right, or Arabic would show the end first.
  return `\u2066${start}–${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}\u2069`;
}

/** The calendar day it starts: 00:30 is the day after the night it belongs to. */
function calendarDay(night: string, start: string | null): string {
  if (!start || Number(start.slice(0, 2)) >= 14) return night;
  return new Date(Date.parse(`${night}T00:00:00Z`) + 24 * 3600_000).toISOString().slice(0, 10);
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The first night that can still take a post: 24 hours from now, less the
 *  small-hours starts that belong to the night before. Kuwait time. */
function firstDate(): string {
  return new Date(Date.now() + NOTICE_MS + (3 - 1) * 3600_000).toISOString().slice(0, 10);
}

export function WantedBoard() {
  const { t } = useI18n();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [mine, setMine] = useState<Post[]>([]);
  const [joined, setJoined] = useState<number[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [reservingId, setReservingId] = useState<number | null>(null);
  // Null until the server has said which.
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Shown on the card it is about, which may be far below the top of the page.
  const [cardNote, setCardNote] = useState<{ id: number; text: string; bad: boolean } | null>(null);
  // The same lock without waiting for a render: two taps in one instant.
  const paying = useRef(false);
  const [withdrawingId, setWithdrawingId] = useState<number | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);
  const [mineFailed, setMineFailed] = useState(false);
  const [showForm, setShowForm] = useState(false);

  function loadBoard() {
    api
      .get<{ posts: Post[] }>('/wanted')
      .then((r) => {
        setPosts(r.posts);
        setBoardFailed(false);
      })
      // Whatever was already on screen stays.
      .catch(() => setBoardFailed(true));
  }

  function loadMine() {
    api
      .get<{ posts: Post[]; interestedIn: number[]; member: Member }>('/wanted/mine')
      .then((r) => {
        setLoggedIn(true);
        setMine(r.posts);
        setJoined(r.interestedIn);
        setMember(r.member);
        setMineFailed(false);
      })
      .catch((e) => {
        // Only a real "not signed in" means that; a lost connection does not.
        if (e instanceof ApiError && e.status === 401) {
          setLoggedIn(false);
          setMineFailed(false);
        } else {
          setMineFailed(true);
        }
      });
  }

  useEffect(() => {
    loadBoard();
    loadMine();
    // Coming back from the payment page with Back can restore this page as it
    // was left, with its buttons still locked.
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      paying.current = false;
      setReservingId(null);
      loadBoard();
      loadMine();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  /**
   * Buy seats on a listing. The browser is handed to the gateway exactly as
   * table checkout does; the server confirms only after re-retrieving the
   * charge.
   */
  async function reserve(id: number, seats: number) {
    if (paying.current) return;
    paying.current = true;
    setCardNote(null);
    setReservingId(id);
    try {
      const res = await api.post<{ redirectUrl?: string; free?: boolean }>(
        `/wanted/${id}/reserve`,
        { seats },
      );
      if (res.redirectUrl) {
        window.location.assign(res.redirectUrl);
        // Buttons stay locked while the browser leaves: a second tap would
        // open a second payment.
        return;
      }
      setCardNote({ id, text: t('wb.payPaid'), bad: false });
      loadBoard();
    } catch (e) {
      setCardNote({ id, text: e instanceof Error ? e.message : t('wb.reserveFailed'), bad: true });
      loadBoard();
    }
    paying.current = false;
    setReservingId(null);
  }

  async function withdraw(id: number) {
    if (withdrawingId !== null) return;
    setCardNote(null);
    setWithdrawingId(id);
    try {
      await api.del(`/wanted/${id}/interest`);
      setJoined((ids) => ids.filter((x) => x !== id));
      setCardNote({ id, text: t('wb.withdrawn'), bad: false });
      loadBoard();
    } catch (e) {
      setCardNote({ id, text: e instanceof Error ? e.message : t('wb.failed'), bad: true });
    } finally {
      setWithdrawingId(null);
    }
  }

  return (
    <div className="wanted-page">
      <header className="page-header left">
        <span className="eyebrow">{t('wb.eyebrow')}</span>
        <h1>{t('wb.title')}</h1>
        <p className="wb-sub">{t('wb.sub')}</p>
      </header>

      <PaymentReturnNotice param="reserve" paidKey="wb.payPaid" />
      <UnsubscribeNotice onDone={loadMine} />

      <section className="section wb-guide">
        <div className="section-head">
          <div>
            <span className="section-kicker">{t('wb.guideKicker')}</span>
            <h2>{t('wb.guideTitle')}</h2>
          </div>
        </div>
        <Roadmap
          className="wb-roadmap"
          steps={[
            ['wb.step1', 'wb.step1b'],
            ['wb.step2', 'wb.step2b'],
            ['wb.step3', 'wb.step3b'],
            ['wb.step4', 'wb.step4b'],
          ]}
        />
      </section>

      {note && (
        <p className="muted" role="status">
          {note}
        </p>
      )}

      {mineFailed && <LoadFailed onRetry={loadMine} />}
      {loggedIn ? (
        <div className="wb-actions">
          <button className="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? t('wb.close') : t('wb.postOne')}
          </button>
          {member && <SubscribeButton member={member} onChange={setMember} />}
        </div>
      ) : loggedIn === null ? (
        !mineFailed && <p>{t('loading')}</p>
      ) : (
        <div className="card">
          <p className="muted">{t('wb.signInToPost')}</p>
          <Link to="/register" className="cta button" style={{ marginTop: '1rem' }}>
            {t('nav.login')}
          </Link>
        </div>
      )}

      {showForm && loggedIn && member && (
        <PostForm
          member={member}
          onMember={setMember}
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
          <div className="wb-grid">
            {mine.map((p) => (
              <PostCard key={p.id} post={p} showStatus />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="sec-primary">{t('wb.open')}</h2>
          <div className="rule" />
        </div>
        {boardFailed && <LoadFailed onRetry={loadBoard} />}
        {posts === null ? (
          boardFailed ? null : <p>{t('loading')}</p>
        ) : posts.length === 0 ? (
          <p className="muted">{t('wb.empty')}</p>
        ) : (
          <div className="wb-grid">
            {posts.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                canReserve={loggedIn === true && p.status === 'open' && !p.started && (p.seatsLeft ?? 0) > 0}
                onWithdraw={joined.includes(p.id) ? () => withdraw(p.id) : undefined}
                onReserve={(seats) => reserve(p.id, seats)}
                reserving={reservingId === p.id}
                locked={reservingId !== null}
                withdrawing={withdrawingId !== null}
                note={cardNote?.id === p.id ? cardNote : null}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** A load that failed, which must not read as "nothing here". */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="alert error" role="alert">
      {t('wb.loadFailed')}{' '}
      <button type="button" className="link" onClick={onRetry}>
        {t('wb.retry')}
      </button>
    </div>
  );
}

/** The session's length, worded properly in Arabic for two hours. */
export function useLength() {
  const { t } = useI18n();
  return (min: number) => (min === 120 ? t('wb.lengthTwo') : t('wb.length', { n: min / 60 }));
}

/** Alerts for new posts: the bell, and email once the address is confirmed. */
function SubscribeButton({ member, onChange }: { member: Member; onChange: (m: Member) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.put<{ subscribed: boolean }>('/wanted/subscription', {
        subscribed: !member.subscribed,
      });
      onChange({ ...member, subscribed: r.subscribed });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('wb.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wb-subscribe">
      <button type="button" onClick={toggle} disabled={busy}>
        <span aria-hidden="true">🔔</span> {t(member.subscribed ? 'wb.unsubscribe' : 'wb.subscribe')}
      </button>
      <small className={error ? 'wb-error' : 'muted'} role={error ? 'alert' : undefined}>
        {error ??
          t(
            !member.subscribed
              ? 'wb.subscribeHint'
              : member.emailVerified
                ? 'wb.subscribedHint'
                : 'wb.subscribedBellHint',
          )}
      </small>
    </div>
  );
}

/** The link in an alert email (?unsubscribe=…). It only asks; the button acts,
 *  so a mail scanner following the link changes nothing. */
function UnsubscribeNotice({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'badLink' | 'failed'>('ask');
  const token = params.get('unsubscribe');
  if (!token) return null;

  async function go() {
    setState('busy');
    try {
      await api.post('/wanted/unsubscribe', { token });
      setState('done');
      onDone();
    } catch (e) {
      // 400 is the link itself; anything else may work on a second try.
      setState(e instanceof ApiError && e.status === 400 ? 'badLink' : 'failed');
    }
  }

  const bad = state === 'badLink' || state === 'failed';

  function dismiss() {
    params.delete('unsubscribe');
    setParams(params, { replace: true });
  }

  return (
    <div className={`pay-return ${bad ? 'bad' : state === 'done' ? 'ok' : 'wait'}`} role={bad ? 'alert' : 'status'}>
      <p>
        {t(
          state === 'done'
            ? 'wb.unsubDone'
            : state === 'badLink'
              ? 'wb.unsubFailed'
              : state === 'failed'
                ? 'wb.failed'
                : 'wb.unsubAsk',
        )}{' '}
        {state !== 'done' && state !== 'badLink' && (
          <button type="button" className="link" onClick={go} disabled={state === 'busy'}>
            {t('wb.unsubscribe')}
          </button>
        )}
      </p>
      <button type="button" className="pay-return-x" onClick={dismiss} aria-label={t('promo.close')}>
        ✕
      </button>
    </div>
  );
}

function PostCard({
  post,
  showStatus,
  canReserve,
  onReserve,
  onWithdraw,
  reserving,
  locked,
  withdrawing,
  note,
}: {
  post: Post;
  /** The member's own posts, which may be waiting or rejected. */
  showStatus?: boolean;
  canReserve?: boolean;
  onReserve?: (seats: number) => void;
  /** Set when this member has a free registration to take back. */
  onWithdraw?: () => void;
  reserving?: boolean;
  /** A payment is being opened, on this card or another. */
  locked?: boolean;
  withdrawing?: boolean;
  note?: { text: string; bad: boolean } | null;
}) {
  const { t, lang, money } = useI18n();
  const lengthText = useLength();
  // Seats are bought individually: one by default, since a member joining a
  // game is usually joining it alone, with the rest left for other players.
  const [seats, setSeats] = useState(1);
  const seatsLeft = post.seatsLeft ?? 0;
  const taking = Math.min(seats, Math.max(1, seatsLeft));
  const length = post.durationMin ?? 120;
  // New listings carry an exact date; older ones only ever had weekdays.
  const day = post.sessionDate
    ? formatDay(calendarDay(post.sessionDate, post.startTime), lang)
    : post.preferredDays.map((d) => t(`day.${DAY_KEYS[d]}`)).join(' · ');

  const facts: [string, string, string][] = [
    ['📅', t('wb.date'), day],
    [
      '🕒',
      t('wb.startTime'),
      post.startTime ? sessionTime(post.startTime, length) : t('wb.timeToArrange'),
    ],
    ['⏳', t('wb.sessionLength'), lengthText(length)],
    ['👥', t('wb.playersLabel'), t('wb.players', { min: post.minPlayers, max: post.maxPlayers })],
    [
      '🪑',
      t('wb.seats'),
      t('wb.seatsTaken', { taken: post.seatsTaken ?? 0, left: seatsLeft }),
    ],
    ...(post.perPlayerCents
      ? ([['💳', t('wb.fee'), t('wb.perPlayer', { amount: money(post.perPlayerCents) })]] as [
          string,
          string,
          string,
        ][])
      : []),
  ];

  return (
    <article className="wb-card">
      <div className="wb-card-head">
        {post.imageUrl ? (
          <img src={post.imageUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="wb-card-noimg" aria-hidden="true">
            🎲
          </span>
        )}
        <div>
          <h3>{post.gameTitle}</h3>
          {post.postedBy && (
            <p className="wb-by">
              {t('wb.postedBy')} <bdi dir="ltr">@{post.postedBy}</bdi>
            </p>
          )}
          <div className="wb-tags">
            {showStatus && !(post.ended && post.status !== 'rejected') && <span className={`status ${post.status}`}>{t(`wb.status.${post.status}`)}</span>}
            <span className="tag">{t(`wb.type.${post.sessionType}`)}</span>
          </div>
        </div>
      </div>
      <ul className="wb-facts">
        {facts.map(([icon, label, value]) => (
          <li key={label} title={label}>
            <span aria-hidden="true">{icon}</span>
            <span className="wb-sr">{label}: </span>
            <span>{value}</span>
          </li>
        ))}
      </ul>
      {post.ended ? (
        <span className="pill">{t('wb.ended')}</span>
      ) : post.status === 'pending' || post.status === 'rejected' ? null : post.started ? (
        <span className="pill">{t('wb.started')}</span>
      ) : seatsLeft === 0 ? (
        // My posts already say it in the status.
        showStatus && post.status === 'completed' ? null : (
          <span className="pill">{t('wb.full')}</span>
        )
      ) : canReserve && post.perPlayerCents ? (
        // Open to any signed-in member, the poster included. You pay for the
        // seats you take and the rest stay on the board.
        <div className="wb-buy">
          {seatsLeft > 1 ? (
            <select
              aria-label={t('wb.seats')}
              value={taking}
              disabled={locked}
              onChange={(e) => setSeats(Number(e.target.value))}
            >
              {Array.from({ length: seatsLeft }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          ) : null}
          <button className="cta" onClick={() => onReserve?.(taking)} disabled={locked}>
            {reserving
              ? t('bk.processing')
              : t(taking === 1 ? 'wb.reserveSeat' : 'wb.reserveSeats', {
                  n: taking,
                  amount: money(post.perPlayerCents * taking),
                })}
          </button>
        </div>
      ) : null}
      {note && (
        <p className={note.bad ? 'wb-error' : 'wb-ok'} role={note.bad ? 'alert' : 'status'}>
          {note.text}
        </p>
      )}
      {onWithdraw && (
        <p className="wb-joined">
          {t('wb.youAreIn')}{' '}
          <button type="button" className="link danger" onClick={onWithdraw} disabled={withdrawing}>
            {t('wb.withdraw')}
          </button>
        </p>
      )}
    </article>
  );
}

function PostForm({
  member,
  onMember,
  onDone,
}: {
  member: Member;
  onMember: (m: Member) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const lengthText = useLength();
  const [username, setUsername] = useState(member.username ?? '');
  const [games, setGames] = useState<Game[]>([]);
  const [gameId, setGameId] = useState<number | ''>('');
  const [gameName, setGameName] = useState('');
  const [minPlayers, setMinPlayers] = useState(2);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [sessionType, setSessionType] = useState<SessionType>('open');
  // The same lengths as a table booking. The price follows from this and is
  // worked out server-side, so the form never sends an amount.
  const [durationMin, setDurationMin] = useState(120);
  const [sessionDate, setSessionDate] = useState('');
  const [startTime, setStartTime] = useState('');
  // Starts that end before closing (03:00) and are at least 24 hours away.
  const starts = STARTS.filter(
    (s) =>
      nightMinutes(s) + durationMin <= 27 * 60 &&
      (!sessionDate || startsAt(sessionDate, s) - Date.now() >= NOTICE_MS),
  );
  const start = starts.includes(startTime) ? startTime : '';
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
    if (!start) return setError(t('wb.startRequired'));
    const name = username.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(name) || !/[a-z]/.test(name)) return setError(t('wb.usernameRules'));
    if (gameId === '' && !gameName.trim()) return setError(t('wb.gameRequired'));
    if (maxPlayers < minPlayers) return setError(t('wb.rangeBad'));

    setBusy(true);
    try {
      if (name !== member.username) {
        const r = await api.put<{ username: string }>('/wanted/username', { username: name });
        onMember({ ...member, username: r.username });
      }
      await api.post('/wanted', {
        gameId: gameId === '' ? null : gameId,
        gameName: gameId === '' ? gameName.trim() : null,
        minPlayers,
        maxPlayers,
        sessionType,
        durationMin,
        sessionDate,
        startTime: start,
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
            {LENGTHS.map((m) => (
              <option key={m} value={m}>
                {lengthText(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row">
        <label className="field inline">
          {t('wb.date')}
          <input
            type="date"
            min={firstDate()}
            value={sessionDate}
            onChange={(e) => setSessionDate(e.target.value)}
          />
        </label>
        <label className="field inline">
          {t('wb.startTime')}
          <select value={start} onChange={(e) => setStartTime(e.target.value)}>
            <option value="">{t('wb.pickTime')}</option>
            {starts.map((s) => (
              <option key={s} value={s}>
                {Number(s.slice(0, 2)) < 14 ? `${s} (${t('wb.afterMidnight')})` : s}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          {t('wb.username')}
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={21}
            dir="ltr"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>
      <p className="muted">{t('wb.noticeRule')}</p>
      <p className="muted">{t('wb.usernameHint')}</p>

      <label className="terms-check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>{t('wb.ack')}</span>
      </label>

      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <p className="muted">{t('wb.reviewNote')}</p>
      <button className="primary" disabled={busy || !ack}>
        {busy ? t('wb.posting') : t('wb.submit')}
      </button>
    </form>
  );
}
