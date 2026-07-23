import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';

type Mode = 'login' | 'signup';
interface AuthUser {
  email: string;
  name: string;
  isStaff: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
  }
}

// Google client id is baked in at build time; unset => button shows a notice.
const GOOGLE_CLIENT_ID =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOOGLE_CLIENT_ID as
    | string
    | undefined) || undefined;

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('gis load failed'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

export function StaffLogin() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function afterAuth(u: AuthUser) {
    navigate(u.isStaff ? '/staff/dashboard' : '/');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'login' ? { email, password } : { email, name, password };
      const { user } = await api.post<{ user: AuthUser }>(path, body);
      afterAuth(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function googleSignIn() {
    setError(null);
    setNote(null);
    if (!GOOGLE_CLIENT_ID) {
      setNote(t('auth.socialSoon'));
      return;
    }
    try {
      await loadGis();
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp: { credential: string }) => {
          try {
            const { user } = await api.post<{ user: AuthUser }>('/auth/google', {
              idToken: resp.credential,
            });
            afterAuth(user);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Google sign-in failed.');
          }
        },
      });
      window.google.accounts.id.prompt();
    } catch {
      setNote(t('auth.socialSoon'));
    }
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setNote(null);
  }

  return (
    <div className="auth-page">
      <span className="auth-blob one" />
      <span className="auth-blob two" />

      <div className="auth-editorial">
        <h1>
          {t('auth.h1a')} <span className="glow">{t('auth.h1b')}</span> {t('auth.h1c')}
        </h1>
        <p className="hero-sub">{t('auth.sub')}</p>
        <div className="auth-stats">
          <div className="auth-stat">
            <span className="ico">🎲</span>
            <div>
              <div className="k">{t('auth.stat1k')}</div>
              <div className="v">{t('auth.stat1v')}</div>
            </div>
          </div>
          <div className="auth-stat">
            <span className="ico">👥</span>
            <div>
              <div className="k">{t('auth.stat2k')}</div>
              <div className="v">{t('auth.stat2v')}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-card">
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => switchMode('signup')}
          >
            {t('auth.join')}
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => switchMode('login')}
          >
            {t('auth.signin')}
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}
        {note && <div className="auth-note">{note}</div>}

        <form onSubmit={onSubmit}>
          <div className="auth-field">
            <label>{t('bk.email')}</label>
            <div className="auth-input">
              <span className="ico">✉️</span>
              <input
                type="email"
                required
                placeholder={t('auth.emailPh')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          {mode === 'signup' && (
            <div className="auth-field">
              <label>{t('auth.username')}</label>
              <div className="auth-input">
                <span className="ico">👤</span>
                <input
                  type="text"
                  required
                  placeholder={t('auth.usernamePh')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="auth-field">
            <div className="auth-row">
              <label>{t('staff.password')}</label>
              {mode === 'login' && (
                <a
                  className="auth-forgot"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setNote(t('auth.socialSoon'));
                  }}
                >
                  {t('auth.forgot')}
                </a>
              )}
            </div>
            <div className="auth-input">
              <span className="ico">🔒</span>
              <input
                type={showPass ? 'text' : 'password'}
                required
                minLength={mode === 'signup' ? 8 : undefined}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="eye"
                aria-label="Toggle password"
                onClick={() => setShowPass((v) => !v)}
              >
                {showPass ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          <button className="auth-submit" disabled={busy} type="submit">
            {busy ? t('staff.signing') : mode === 'login' ? t('auth.enter') : t('auth.create')}
          </button>

          <div className="auth-divider">
            <span className="line" />
            <span>{t('auth.quick')}</span>
            <span className="line" />
          </div>

          <div className="auth-social single">
            <button type="button" onClick={googleSignIn}>
              🌐 {t('auth.google')}
            </button>
          </div>
        </form>

        <p className="muted" style={{ marginTop: '1rem' }}>
          {t('staff.creds')}
        </p>
      </div>
    </div>
  );
}
