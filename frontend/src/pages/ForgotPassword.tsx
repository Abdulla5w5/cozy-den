import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';

/**
 * Request a reset link.
 *
 * The confirmation deliberately does not say whether the address had an
 * account — the API answers identically either way, and the UI must not undo
 * that by wording the two cases differently.
 */
export function ForgotPassword() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fp.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="page-header left">
        <span className="eyebrow">{t('fp.eyebrow')}</span>
        <h1>{t('fp.title')}</h1>
        <p className="muted">{t('fp.sub')}</p>
      </header>

      {sent ? (
        <div className="card">
          <p>{t('fp.sentBody')}</p>
          <Link to="/register" className="cta button" style={{ marginTop: '1rem' }}>
            {t('nav.login')}
          </Link>
        </div>
      ) : (
        <form className="summary manual-form" onSubmit={submit}>
          <label className="field">
            {t('bk.email')}
            <input
              type="email"
              required
              maxLength={200}
              placeholder="player@cozyden.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary" disabled={busy}>
            {busy ? t('fp.sending') : t('fp.send')}
          </button>
        </form>
      )}
    </div>
  );
}

/** Redeem the link from the email and choose a new password. */
export function ResetPassword() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) setError(t('rp.noToken'));
  }, [token, t]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError(t('rp.mismatch'));
    if (password.length < 8) return setError(t('rp.tooShort'));

    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      // Any session that existed before the reset is now refused by the API,
      // so send them to sign in fresh with the new password.
      setTimeout(() => navigate('/register'), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rp.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="page-header left">
        <span className="eyebrow">{t('fp.eyebrow')}</span>
        <h1>{t('rp.title')}</h1>
        <p className="muted">{t('rp.sub')}</p>
      </header>

      {done ? (
        <div className="card">
          <p>{t('rp.doneBody')}</p>
          <Link to="/register" className="cta button" style={{ marginTop: '1rem' }}>
            {t('nav.login')}
          </Link>
        </div>
      ) : (
        <form className="summary manual-form" onSubmit={submit}>
          <label className="field">
            {t('rp.newPassword')}
            <input
              type="password"
              required
              minLength={8}
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="field">
            {t('rp.confirmPassword')}
            <input
              type="password"
              required
              minLength={8}
              maxLength={200}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary" disabled={busy || !token}>
            {busy ? t('rp.saving') : t('rp.save')}
          </button>
        </form>
      )}
    </div>
  );
}
