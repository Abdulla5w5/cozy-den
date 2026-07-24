import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { SupportKind, SupportRequest, SupportSeverity, SupportThread } from '../types';

const KINDS: SupportKind[] = ['suggestion', 'complaint', 'question'];
const SEVERITIES: SupportSeverity[] = ['low', 'normal', 'urgent'];

// Threads are polled rather than pushed — cheap and dependable at this scale.
const POLL_MS = 25000;

function when(iso: string) {
  return new Date(iso).toLocaleString();
}

/** Customer inbox: list of my requests + the new-request form. */
export function SupportPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<SupportRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<SupportKind>('suggestion');
  const [severity, setSeverity] = useState<SupportSeverity>('normal');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ requests: SupportRequest[] }>('/support')
      .then((r) => setRequests(r.requests))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) navigate('/register');
        else setError(e.message);
      });
  }, [navigate]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload =
        kind === 'complaint'
          ? { kind, severity, subject: subject.trim(), body: body.trim() }
          : { kind, subject: subject.trim(), body: body.trim() };
      const r = await api.post<{ request: SupportRequest }>('/support', payload);
      setSubject('');
      setBody('');
      navigate(`/support/${r.request.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="page-header left">
        <span className="eyebrow">{t('sup.eyebrow')}</span>
        <h1>{t('sup.title')}</h1>
        <p className="muted">{t('sup.sub')}</p>
      </header>

      <div className="card">
        <h3>{t('sup.newTitle')}</h3>
        <form onSubmit={submit}>
          <div className="chips left">
            {KINDS.map((k) => (
              <button
                type="button"
                key={k}
                className={`chip ${kind === k ? 'active' : ''}`}
                onClick={() => setKind(k)}
              >
                {t(`sup.kind.${k}`)}
              </button>
            ))}
          </div>

          {kind === 'complaint' && (
            <label className="field">
              {t('sup.severity')}
              <select value={severity} onChange={(e) => setSeverity(e.target.value as SupportSeverity)}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sup.sev.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="field">
            {t('sup.subject')}
            <input
              required
              minLength={3}
              maxLength={140}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('sup.subjectPh')}
            />
          </label>
          <label className="field">
            {t('sup.message')}
            <textarea
              required
              rows={5}
              maxLength={4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('sup.messagePh')}
            />
          </label>

          {error && <div className="alert error">{error}</div>}
          <button className="primary" disabled={busy}>
            {busy ? t('loading') : t('sup.send')}
          </button>
        </form>
      </div>

      <h3 className="sup-list-title">{t('sup.mine')}</h3>
      {requests === null ? (
        <p>{t('loading')}</p>
      ) : requests.length === 0 ? (
        <p className="muted">{t('sup.none')}</p>
      ) : (
        <ul className="sup-list">
          {requests.map((r) => (
            <li key={r.id}>
              <Link to={`/support/${r.id}`} className="sup-row">
                <span className="sup-row-main">
                  <strong>{r.subject}</strong>
                  <span className="muted">
                    {t(`sup.kind.${r.kind}`)} · {when(r.updatedAt)}
                  </span>
                </span>
                <span className={`status ${r.status}`}>{t(`sup.status.${r.status}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One conversation. Polls so a staff reply appears without a refresh. */
export function SupportThreadPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<SupportThread>(`/support/${id}`)
      .then(setThread)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) navigate('/register');
        else setError(e.message);
      });
  }, [id, navigate]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    // Stop polling while the tab is hidden; resume (and refresh) on return.
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/support/${id}/messages`, { body: reply.trim() });
      setReply('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="alert error">{error}</div>;
  if (!thread) return <p>{t('loading')}</p>;

  const closed = thread.request.status === 'closed';

  return (
    <div>
      <Link to="/support" className="card-link">
        ← {t('sup.back')}
      </Link>
      <header className="page-header left">
        <h1>{thread.request.subject}</h1>
        <p className="muted">
          {t(`sup.kind.${thread.request.kind}`)}
          {thread.request.severity ? ` · ${t(`sup.sev.${thread.request.severity}`)}` : ''} ·{' '}
          <span className={`status ${thread.request.status}`}>
            {t(`sup.status.${thread.request.status}`)}
          </span>
        </p>
      </header>

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

      {closed ? (
        <p className="muted">{t('sup.closedNote')}</p>
      ) : (
        <form onSubmit={send} className="card">
          <label className="field">
            {t('sup.reply')}
            <textarea
              required
              rows={3}
              maxLength={4000}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {t('sup.send')}
          </button>
        </form>
      )}
    </div>
  );
}
