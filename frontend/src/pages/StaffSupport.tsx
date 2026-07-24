import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { SupportRequest, SupportStatus, SupportThread } from '../types';

const FILTERS: (SupportStatus | 'all')[] = ['all', 'open', 'in_progress', 'resolved', 'closed'];
const NEXT_STATUS: SupportStatus[] = ['open', 'in_progress', 'resolved', 'closed'];
const POLL_MS = 25000;

function when(iso: string) {
  return new Date(iso).toLocaleString();
}

/** Staff support inbox: triage list on top, selected thread below. */
export function SupportTab() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<SupportStatus | 'all'>('open');
  const [requests, setRequests] = useState<SupportRequest[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = filter === 'all' ? '' : `?status=${filter}`;
    api
      .get<{ requests: SupportRequest[] }>(`/staff/support${q}`)
      .then((r) => setRequests(r.requests))
      .catch((e) => setError(e.message));
  }, [filter]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <section>
      <div className="chips left">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`chip ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? t('status.all') : t(`sup.status.${f}`)}
          </button>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}

      {requests === null ? (
        <p>{t('loading')}</p>
      ) : requests.length === 0 ? (
        <p className="muted">{t('sup.none')}</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('sup.subject')}</th>
                <th>{t('sup.type')}</th>
                <th>{t('staff.guest')}</th>
                <th>{t('staff.status')}</th>
                <th>{t('sup.updated')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.subject}</td>
                  <td>
                    <span className="pill">{t(`sup.kind.${r.kind}`)}</span>
                    {r.severity && (
                      <span className={`pill sev-${r.severity}`}>{t(`sup.sev.${r.severity}`)}</span>
                    )}
                  </td>
                  <td>{r.customerName}</td>
                  <td>
                    <span className={`status ${r.status}`}>{t(`sup.status.${r.status}`)}</span>
                  </td>
                  <td>{when(r.updatedAt)}</td>
                  <td>
                    <button className="link" onClick={() => setOpenId(r.id)}>
                      {t('sup.open')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId !== null && (
        <StaffThread id={openId} onChanged={load} onClose={() => setOpenId(null)} />
      )}
    </section>
  );
}

function StaffThread({
  id,
  onChanged,
  onClose,
}: {
  id: number;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<SupportThread>(`/support/${id}`)
      .then(setThread)
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/staff/support/${id}/messages`, { body: body.trim(), internal });
      setBody('');
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  async function move(status: SupportStatus) {
    setError(null);
    try {
      await api.post(`/staff/support/${id}/status`, { status });
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    }
  }

  if (!thread) return <p>{t('loading')}</p>;

  return (
    <div className="card sup-panel">
      <div className="dash-head">
        <h3>
          #{thread.request.id} · {thread.request.subject}
        </h3>
        <button className="link" onClick={onClose}>
          {t('promo.close')}
        </button>
      </div>
      <p className="muted">
        {thread.request.customerName} · {thread.request.customerEmail}
      </p>

      <div className="chips left">
        {NEXT_STATUS.map((s) => (
          <button
            key={s}
            className={`chip ${thread.request.status === s ? 'active' : ''}`}
            disabled={thread.request.status === s}
            onClick={() => move(s)}
          >
            {t(`sup.status.${s}`)}
          </button>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}

      <ul className="sup-thread">
        {thread.messages.map((m) => (
          <li key={m.id} className={`sup-msg ${m.authorRole}${m.isInternal ? ' internal' : ''}`}>
            <div className="sup-msg-head">
              <strong>{m.authorName}</strong>
              <span className="muted">{when(m.createdAt)}</span>
              {m.isInternal && <span className="pill">{t('sup.internal')}</span>}
            </div>
            <p>{m.body}</p>
          </li>
        ))}
      </ul>

      <form onSubmit={send}>
        <label className="field">
          {t('sup.reply')}
          <textarea
            required
            rows={3}
            maxLength={4000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <label className="field inline check">
          <input
            type="checkbox"
            checked={internal}
            onChange={(e) => setInternal(e.target.checked)}
          />
          {t('sup.internalNote')}
        </label>
        <button className="primary" disabled={busy}>
          {internal ? t('sup.saveNote') : t('sup.send')}
        </button>
      </form>

      <details className="sup-audit">
        <summary>{t('sup.history')}</summary>
        <ul>
          {thread.statusHistory.map((e, i) => (
            <li key={i} className="muted">
              {when(e.createdAt)} — {e.actorName}: {e.from ?? '—'} → {e.to}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
