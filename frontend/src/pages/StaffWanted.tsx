import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { formatDay } from '../formatDay';
import { CancelSession, EditSession } from '../components/SessionEditor';
import { LoadFailed, useLength } from './WantedBoard';

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
  status: 'pending' | 'open' | 'completed' | 'rejected' | 'cancelled';
  interestCount: number;
  posterName: string;
  posterEmail: string;
  interested: { name: string; contact: string; registeredAt: string }[];
  seatsTaken?: number;
  seatsLeft?: number;
  perPlayerCents?: number;
  seatBuyers?: {
    id: number;
    name: string;
    contact: string;
    seats: number;
    amountCents: number;
    paid: boolean;
    refunded: boolean;
  }[];
  cancelNote: string | null;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function StaffWanted() {
  const { t, lang, money: siteMoney } = useI18n();
  const lengthText = useLength();
  const [loadFailed, setLoadFailed] = useState(false);
  const [posts, setPosts] = useState<StaffPost[] | null>(null);
  const [archive, setArchive] = useState(false);
  // One open editor at a time, and what the last save said.
  const [editing, setEditing] = useState<{ id: number; what: 'edit' | 'cancel' } | null>(null);
  // A tick shown at once, while it saves.
  const [ticking, setTicking] = useState<{ id: number; value: boolean } | null>(null);
  const [saved, setSaved] = useState<{ id: number; text: string } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);

  /** True once the list on screen is the server's own. */
  function load(): Promise<boolean> {
    return api
      .get<{ posts: StaffPost[] }>('/staff/wanted')
      .then((r) => {
        setPosts(r.posts);
        setLoadFailed(false);
        return true;
      })
      // The list already on screen stays.
      .catch(() => {
        setLoadFailed(true);
        return false;
      });
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
    const paid = (post.seatBuyers ?? []).some((b) => b.paid && b.amountCents > 0);
    const ask = t('staff.wbDeleteConfirm', { game: post.gameTitle });
    if (!window.confirm(paid ? `${ask}\n\n${t('staff.wbDeletePaid')}` : ask)) return;
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

  const payments = (p: StaffPost) =>
    (p.seatBuyers ?? []).filter((b) => b.paid && b.amountCents > 0 && !b.refunded);
  // A cancelled one stays current until everyone in it has been refunded.
  const owed = (p: StaffPost) => (p.status === 'cancelled' ? payments(p) : []);

  async function setRefunded(post: StaffPost, seatId: number, refunded: boolean) {
    setError(null);
    setSaved(null);
    setBusy(post.id);
    setTicking({ id: seatId, value: refunded });
    const last = refunded && owed(post).length === 1;
    // Unticking an archived card brings it back to Current.
    const reopens = !refunded && owed(post).length === 0;
    let ok = false;
    try {
      await api.put(`/staff/wanted/seats/${seatId}/refunded`, { refunded });
      ok = true;
    } catch (e) {
      setError({ id: post.id, text: e instanceof Error ? e.message : t('staff.wbActionFailed') });
    }
    // The tick stays as shown until the list really says so.
    const fresh = await load();
    if (ok && fresh && last) setSaved({ id: post.id, text: t('staff.wbAllRefunded') });
    if (ok && fresh && reopens) setSaved({ id: post.id, text: t('staff.wbReopened') });
    if (fresh || !ok) setTicking(null);
    setBusy(null);
  }

  function open(post: StaffPost, what: 'edit' | 'cancel') {
    setError(null);
    setSaved(null);
    setEditing({ id: post.id, what });
  }

  /** Close the editor and show the post as it is now, then say it worked. */
  async function finished(id: number, text: string) {
    await load();
    setEditing((e) => (e?.id === id ? null : e));
    setSaved({ id, text });
    setBusy(null);
  }

  if (posts === null) return loadFailed ? <LoadFailed onRetry={load} /> : <p>{t('loading')}</p>;
  // A rejected post needs nothing more from staff either.
  const isPast = (p: StaffPost) =>
    owed(p).length === 0 && (p.ended || p.status === 'rejected' || p.status === 'cancelled');
  const past = posts.filter(isPast);
  // Refunds still owed come first.
  const shown = archive
    ? past
    : posts
        .filter((p) => !isPast(p))
        .sort((a, b) => Number(owed(b).length > 0) - Number(owed(a).length > 0));

  return (
    <>
      <div className="chips left">
        <button type="button" className={`chip ${archive ? '' : 'active'}`} aria-pressed={!archive} disabled={editing !== null || busy !== null} onClick={() => setArchive(false)}>
          {t('staff.wbCurrent', { n: posts.length - past.length })}
        </button>
        <button type="button" className={`chip ${archive ? 'active' : ''}`} aria-pressed={archive} disabled={editing !== null || busy !== null} onClick={() => setArchive(true)}>
          {t('staff.wbArchive', { n: past.length })}
        </button>
      </div>
      {shown.length === 0 && <p className="muted">{t('staff.wbNone')}</p>}
      {loadFailed && <LoadFailed onRetry={load} />}
      {/* Its card has just moved to the other list. */}
      {saved && !shown.some((p) => p.id === saved.id) && (
        <p className="wb-ok" role="status">
          <bdi>{posts.find((p) => p.id === saved.id)?.gameTitle}</bdi>: {saved.text}
        </p>
      )}
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
                amount: siteMoney(p.perPlayerCents ?? 0),
              })}
            </p>
            {p.seatBuyers && p.seatBuyers.length > 0 ? (
              <ul className="muted">
                {p.seatBuyers.map((b) => (
                  <li key={b.id}>
                    <bdi>{b.name}</bdi> — <bdi dir="ltr">{b.contact}</bdi> · {t('staff.wbSeatCount', { n: b.seats })}
                    {b.paid ? ` · ${siteMoney(b.amountCents)}` : ` · ${t('staff.wbSeatPending')}`}
                    {p.status === 'cancelled' && b.paid && b.amountCents > 0 && (
                      <label className="terms-check wb-refund">
                        <input
                          type="checkbox"
                          aria-label={`${t('staff.wbRefunded')}: ${b.name}, ${siteMoney(b.amountCents)}`}
                          checked={ticking?.id === b.id ? ticking.value : b.refunded}
                          disabled={busy !== null || editing !== null}
                          onChange={(e) => setRefunded(p, b.id, e.target.checked)}
                        />
                        <span>{t('staff.wbRefunded')}</span>
                      </label>
                    )}
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
            {owed(p).length > 0 && (
              <p className="wb-error">
                {t('staff.wbOwed', {
                  n: owed(p).length,
                  amount: siteMoney(owed(p).reduce((sum, b) => sum + b.amountCents, 0)),
                })}
              </p>
            )}
            {p.status === 'cancelled' && p.cancelNote && (
              <p className="muted wb-note">
                {t('staff.wbNoteSent')} <bdi>{p.cancelNote}</bdi>
              </p>
            )}
            {saved?.id === p.id && (
              <p className="wb-ok" role="status">
                {saved.text}
              </p>
            )}
            {error?.id === p.id && (
              <p className="wb-error" role="alert">
                {error.text}
              </p>
            )}
            {p.status === 'pending' && p.started && (
              <p className="wb-error">{t('staff.wbTooLate')}</p>
            )}
            {editing?.id === p.id && editing.what === 'edit' && (
              <EditSession
                session={p}
                busy={busy !== null}
                setBusy={(b) => setBusy(b ? p.id : null)}
                onClose={() => {
                  setEditing(null);
                  void load();
                }}
                onDone={(text) => void finished(p.id, text)}
              />
            )}
            {editing?.id === p.id && editing.what === 'cancel' && (
              <CancelSession
                session={p}
                owed={
                  payments(p).length > 0
                    ? t('staff.wbOwedShort', {
                        n: payments(p).length,
                        amount: siteMoney(payments(p).reduce((sum, b) => sum + b.amountCents, 0)),
                      })
                    : null
                }
                busy={busy !== null}
                setBusy={(b) => setBusy(b ? p.id : null)}
                onClose={() => setEditing(null)}
                onDone={() => void finished(p.id, t('staff.wbCancelled'))}
              />
            )}
            {editing?.id !== p.id && (
              <div className="host-actions">
                {p.status === 'pending' && (
                  <>
                    <button
                      className="primary"
                      disabled={busy !== null || editing !== null || p.started}
                      onClick={() => moderate(p, 'approve')}
                    >
                      {t('staff.wbApprove')}
                    </button>
                    <button
                      type="button"
                      className="link danger"
                      disabled={busy !== null || editing !== null}
                      onClick={() => moderate(p, 'reject')}
                    >
                      {t('staff.wbReject')}
                    </button>
                  </>
                )}
                {!p.started && ['pending', 'open', 'completed'].includes(p.status) && (
                  <button
                    type="button"
                    className="link"
                    disabled={busy !== null || editing !== null}
                    onClick={() => open(p, 'edit')}
                  >
                    {t('staff.changeBtn')}
                  </button>
                )}
                {!p.ended && ['open', 'completed'].includes(p.status) && (
                  <button
                    type="button"
                    className="link danger"
                    disabled={busy !== null || editing !== null}
                    onClick={() => open(p, 'cancel')}
                  >
                    {t('staff.wbCancel')}
                  </button>
                )}
                <button
                  type="button"
                  className="link danger"
                  disabled={busy !== null || editing !== null}
                  onClick={() => remove(p)}
                >
                  {t('staff.wbDelete')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
