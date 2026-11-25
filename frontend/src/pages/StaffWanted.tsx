import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { formatDay } from '../formatDay';
import { LoadFailed, useLength } from './WantedBoard';
import { money } from '../types';

/**
 * Staff side of the Wanted Board.
 *
 * This is the ONLY place interested members' identities and contact details
 * appear — the public board sends counts and nothing else. It is also where a
 * new post is approved: until staff publish it, no member can see it or
 * register interest.
 *
 * A completed post is a to-do list, not a booking. Staff arrange the table, and
 * phone or email the people below. A session that is over moves to the archive.
 */

interface StaffPost {
  id: number;
  gameTitle: string;
  minPlayers: number;
  maxPlayers: number;
  sessionType: 'males_only' | 'females_only' | 'open';
  sessionDate: string | null;
  startTime: string | null;
  durationMin?: number;
  postedBy: string | null;
  started: boolean;
  /** Over: shown in the archive only. */
  ended: boolean;
  preferredDays: number[];
  status: 'pending' | 'open' | 'completed' | 'rejected';
  interestCount: number;
  posterName: string;
  posterEmail: string;
  interested: { name: string; contact: string; registeredAt: string }[];
  seatsTaken?: number;
  seatsLeft?: number;
  perPlayerCents?: number;
  seatBuyers?: { name: string; contact: string; seats: number; paid: boolean }[];
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function StaffWanted() {
  const { t, lang } = useI18n();
  const lengthText = useLength();
  const [loadFailed, setLoadFailed] = useState(false);
  const [posts, setPosts] = useState<StaffPost[] | null>(null);
  const [archive, setArchive] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);

  function load(): Promise<void> {
    return api
      .get<{ posts: StaffPost[] }>('/staff/wanted')
      .then((r) => {
        setPosts(r.posts);
        setLoadFailed(false);
      })
      // The list already on screen stays.
      .catch(() => setLoadFailed(true));
  }

  useEffect(() => {
    void load();
  }, []);

  async function moderate(post: StaffPost, decision: 'approve' | 'reject') {
    const id = post.id;
    if (
      decision === 'reject' &&
      !window.confirm(t('staff.wbRejectConfirm', { game: post.gameTitle, name: post.posterName }))
    ) {
      return;
    }
    setError(null);
    setBusy(id);
    try {
      await api.post(`/staff/wanted/${id}/moderate`, { decision });
      await load();
    } catch (e) {
      // A colleague may have handled it already: show the post as it is now.
      await load();
      setError({ id, text: e instanceof Error ? e.message : t('staff.wbActionFailed') });
    } finally {
      setBusy(null);
    }
  }

  async function remove(post: StaffPost) {
    if (!window.confirm(t('staff.wbDeleteConfirm', { game: post.gameTitle }))) return;
    setError(null);
    setBusy(post.id);
    try {
      await api.del(`/staff/wanted/${post.id}`);
      setPosts((current) => current?.filter((item) => item.id !== post.id) ?? []);
    } catch (e) {
      setError({ id: post.id, text: e instanceof Error ? e.message : t('staff.wbActionFailed') });
    } finally {
      setBusy(null);
    }
  }

  if (posts === null) return loadFailed ? <LoadFailed onRetry={load} /> : <p>{t('loading')}</p>;
  // A rejected post needs nothing more from staff either.
  const isPast = (p: StaffPost) => p.ended || p.status === 'rejected';
  const past = posts.filter(isPast);
  const shown = archive ? past : posts.filter((p) => !isPast(p));

  return (
    <>
      <div className="chips left">
        <button type="button" className={`chip ${archive ? '' : 'active'}`} aria-pressed={!archive} onClick={() => setArchive(false)}>
          {t('staff.wbCurrent', { n: posts.length - past.length })}
        </button>
        <button type="button" className={`chip ${archive ? 'active' : ''}`} aria-pressed={archive} onClick={() => setArchive(true)}>
          {t('staff.wbArchive', { n: past.length })}
        </button>
      </div>
      {shown.length === 0 && <p className="muted">{t('staff.wbNone')}</p>}
      {loadFailed && <LoadFailed onRetry={load} />}
      <div className="feature-grid staff-wanted">
        {shown.map((p) => (
          <div className="feature-card" key={p.id}>
            <div className="mcard-top">
              <span className={`status ${p.status}`}>{t(`wb.status.${p.status}`)}</span>
              <span className="tag">{t(`wb.type.${p.sessionType}`)}</span>
            </div>
            <h3>{p.gameTitle}</h3>
            <p className="muted">
              {t('wb.players', { min: p.minPlayers, max: p.maxPlayers })} ·{' '}
              {t('wb.interested', { n: p.interestCount, max: p.maxPlayers })}
            </p>
            <p className="muted">
              {p.sessionDate
                ? formatDay(p.sessionDate, lang)
                : p.preferredDays.map((d) => t(`day.${DAY_KEYS[d]}`)).join(' · ')}
              {p.startTime
                ? ` · ${p.startTime}${Number(p.startTime.slice(0, 2)) < 14 ? ` (${t('wb.afterMidnight')})` : ''}`
                : ''}
              {p.durationMin ? ` · ${lengthText(p.durationMin)}` : ''}
            </p>
            <p className="muted">
              {t('staff.wbPoster')}: <bdi>{p.posterName}</bdi> — <bdi dir="ltr">{p.posterEmail}</bdi>
              {p.postedBy && (
                <>
                  {' '}
                  <bdi dir="ltr">(@{p.postedBy})</bdi>
                </>
              )}
            </p>
            {/* Seats are bought individually, so a listing can have several
                payers. Staff run the session from this list. */}
            <p className="muted">
              {t('staff.wbSeats', {
                taken: p.seatsTaken ?? 0,
                max: p.maxPlayers,
                amount: money(p.perPlayerCents ?? 0),
              })}
            </p>
            {p.seatBuyers && p.seatBuyers.length > 0 ? (
              <ul className="muted">
                {p.seatBuyers.map((b, i) => (
                  <li key={i}>
                    <bdi>{b.name}</bdi> — <bdi dir="ltr">{b.contact}</bdi> · {t('staff.wbSeatCount', { n: b.seats })}
                    {b.paid ? '' : ` · ${t('staff.wbSeatPending')}`}
                  </li>
                ))}
              </ul>
            ) : null}

            {p.interested.length > 0 && (
              <>
                <h4>{t('staff.wbInterested')}</h4>
                <ul>
                  {p.interested.map((i, n) => (
                    <li key={n} className="muted">
                      <bdi dir="ltr">{i.contact}</bdi>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {error?.id === p.id && (
              <p className="wb-error" role="alert">
                {error.text}
              </p>
            )}
            {p.status === 'pending' && p.started && (
              <p className="wb-error">{t('staff.wbTooLate')}</p>
            )}
            <div className="host-actions">
              {p.status === 'pending' && (
                <>
                  <button
                    className="primary"
                    disabled={busy !== null || p.started}
                    onClick={() => moderate(p, 'approve')}
                  >
                    {t('staff.wbApprove')}
                  </button>
                  <button
                    type="button"
                    className="link danger"
                    disabled={busy !== null}
                    onClick={() => moderate(p, 'reject')}
                  >
                    {t('staff.wbReject')}
                  </button>
                </>
              )}
              <button
                type="button"
                className="link danger"
                disabled={busy !== null}
                onClick={() => remove(p)}
              >
                {t('staff.wbDelete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
