import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';

/**
 * Staff side of the Wanted Board.
 *
 * This is the ONLY place interested members' identities and contact details
 * appear — the public board sends counts and nothing else. It is also where a
 * new post is approved: until staff publish it, no member can see it or
 * register interest.
 *
 * A completed post is a to-do list, not a booking. Staff phone or email the
 * people below and arrange the day and time themselves.
 */

interface StaffPost {
  id: number;
  gameTitle: string;
  playersNeeded: number;
  minPlayers: number;
  maxPlayers: number;
  sessionType: 'males_only' | 'females_only' | 'open';
  preferredDays: number[];
  status: 'pending' | 'open' | 'completed' | 'rejected';
  interestCount: number;
  posterName: string;
  posterEmail: string;
  interested: { name: string; contact: string; registeredAt: string }[];
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function StaffWanted() {
  const { t } = useI18n();
  const [posts, setPosts] = useState<StaffPost[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  function load() {
    api
      .get<{ posts: StaffPost[] }>('/staff/wanted')
      .then((r) => setPosts(r.posts))
      .catch(() => setPosts([]));
  }

  useEffect(load, []);

  async function moderate(id: number, decision: 'approve' | 'reject') {
    setBusy(id);
    try {
      await api.post(`/staff/wanted/${id}/moderate`, { decision });
      load();
    } finally {
      setBusy(null);
    }
  }

  if (posts === null) return <p>{t('loading')}</p>;
  if (posts.length === 0) return <p className="muted">{t('staff.wbNone')}</p>;

  return (
    <div className="feature-grid">
      {posts.map((p) => (
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
          <p className="muted">{p.preferredDays.map((d) => t(`day.${DAY_KEYS[d]}`)).join(' · ')}</p>
          <p className="muted">
            {t('staff.wbPoster')}: {p.posterName} — {p.posterEmail}
          </p>

          {p.status === 'pending' && (
            <div className="row">
              <button
                className="primary"
                disabled={busy === p.id}
                onClick={() => moderate(p.id, 'approve')}
              >
                {t('staff.wbApprove')}
              </button>
              <button
                className="link"
                disabled={busy === p.id}
                onClick={() => moderate(p.id, 'reject')}
              >
                {t('staff.wbReject')}
              </button>
            </div>
          )}

          {p.interested.length > 0 && (
            <>
              <h4>{t('staff.wbInterested')}</h4>
              <ul>
                {p.interested.map((i, n) => (
                  <li key={n} className="muted">
                    {i.contact}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
