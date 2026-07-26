import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { Game } from '../types';

/**
 * The Wanted Board — members advertise a game they will run and collect
 * expressions of interest.
 *
 * Nothing here is a booking and nothing is scheduled: a post carries days of
 * the week, never a date or time. Once a post fills, staff contact the
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
  playersNeeded: number;
  minPlayers: number;
  maxPlayers: number;
  sessionType: SessionType;
  preferredDays: number[];
  status: 'pending' | 'open' | 'completed' | 'rejected';
  interestCount: number;
  createdAt: string;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function WantedBoard() {
  const { t } = useI18n();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [mine, setMine] = useState<Post[]>([]);
  const [interestedIn, setInterestedIn] = useState<number[]>([]);
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
      .get<{ posts: Post[]; interestedIn: number[] }>('/wanted/mine')
      .then((r) => {
        setLoggedIn(true);
        setMine(r.posts);
        setInterestedIn(r.interestedIn);
      })
      .catch(() => setLoggedIn(false));
  }

  useEffect(() => {
    loadBoard();
    loadMine();
  }, []);

  async function registerInterest(id: number) {
    setNote(null);
    try {
      await api.post(`/wanted/${id}/interest`);
      loadBoard();
      loadMine();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : t('wb.failed'));
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
              <PostCard key={p.id} post={p} mine />
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
                canJoin={loggedIn && p.status === 'open' && !interestedIn.includes(p.id)}
                joined={interestedIn.includes(p.id)}
                onJoin={() => registerInterest(p.id)}
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
  canJoin,
  joined,
  onJoin,
  mine,
}: {
  post: Post;
  canJoin?: boolean;
  joined?: boolean;
  onJoin?: () => void;
  mine?: boolean;
}) {
  const { t } = useI18n();
  const days = post.preferredDays.map((d) => t(`day.${DAY_KEYS[d]}`)).join(' · ');

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
      {/* Count only — never who. */}
      <p className="price">
        {t('wb.interested', { n: post.interestCount, max: post.maxPlayers })}
      </p>
      {mine ? null : joined ? (
        <span className="pill">{t('wb.youAreIn')}</span>
      ) : canJoin ? (
        <button className="primary" onClick={onJoin}>
          {t('wb.join')}
        </button>
      ) : post.status === 'completed' ? (
        <span className="pill">{t('wb.full')}</span>
      ) : null}
    </div>
  );
}

function PostForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [games, setGames] = useState<Game[]>([]);
  const [gameId, setGameId] = useState<number | ''>('');
  const [gameName, setGameName] = useState('');
  const [playersNeeded, setPlayersNeeded] = useState(2);
  const [minPlayers, setMinPlayers] = useState(2);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [sessionType, setSessionType] = useState<SessionType>('open');
  const [days, setDays] = useState<number[]>([]);
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

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ack) return setError(t('wb.ackRequired'));
    if (days.length === 0) return setError(t('wb.daysRequired'));
    if (gameId === '' && !gameName.trim()) return setError(t('wb.gameRequired'));
    if (maxPlayers < minPlayers) return setError(t('wb.rangeBad'));

    setBusy(true);
    try {
      await api.post('/wanted', {
        gameId: gameId === '' ? null : gameId,
        gameName: gameId === '' ? gameName.trim() : null,
        playersNeeded,
        minPlayers,
        maxPlayers,
        sessionType,
        preferredDays: days,
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
          {t('wb.needed')}
          <input
            type="number"
            min={1}
            max={50}
            value={playersNeeded}
            onChange={(e) => setPlayersNeeded(Number(e.target.value))}
          />
        </label>
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
      </div>

      <fieldset className="field">
        <legend>{t('wb.days')}</legend>
        <div className="row">
          {DAY_KEYS.map((k, i) => (
            <label key={k} className="field inline">
              <input type="checkbox" checked={days.includes(i)} onChange={() => toggleDay(i)} />{' '}
              {t(`day.${k}`)}
            </label>
          ))}
        </div>
      </fieldset>

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
