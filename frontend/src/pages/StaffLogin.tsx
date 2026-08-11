import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, notifyAuthChanged } from '../api/client';
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

function isKuwaitPhone(value: string) {
  const western = value.replace(/[٠-٩۰-۹]/g, (digit) =>
    String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) % 10),
  );
  const digits = western.replace(/\D/g, '').replace(/^(?:00965|965)/, '');
  return /^(?:[2569]\d{7}|41\d{6})$/.test(digits);
}
/**
 * `locale` on renderButton is ignored — GIS takes its language from the `hl`
 * query param on the script itself, and without it Google falls back to the
 * browser's own UI language, which is how an English visitor ended up with an
 * Arabic button. The script loads once, so the language is fixed for the
 * session; switching the site toggle reloads the page anyway.
 */
function loadGis(locale: string): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://accounts.google.com/gsi/client?hl=${encodeURIComponent(locale)}`;
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
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const phoneRef = useRef('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Google's own rendered button. One Tap (accounts.id.prompt) only offers
  // sessions the browser already holds — with none, it shows nothing and there
  // is no way to type an address. The rendered button opens the full account
  // chooser, so an existing Gmail can always be entered, and signing up with
  // Google works on a browser that has never seen the account.
  const gsiRef = useRef<HTMLDivElement>(null);
  const [gsiReady, setGsiReady] = useState(false);

  function afterAuth(u: AuthUser) {
    notifyAuthChanged();
    navigate(u.isStaff ? '/staff/dashboard' : '/');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    if (mode === 'signup' && !isKuwaitPhone(phone)) {
      setError(t('auth.phoneInvalid'));
      return;
    }
    setBusy(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'login' ? { email, password } : { email, name, phone, password };
      const { user } = await api.post<{ user: AuthUser }>(path, body);
      afterAuth(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const handleCredential = async (resp: { credential: string }) => {
    if (mode === 'signup' && !isKuwaitPhone(phoneRef.current)) {
      setError(t('auth.phoneInvalid'));
      return;
    }
    try {
      const { user } = await api.post<{ user: AuthUser }>('/auth/google', {
        idToken: resp.credential,
        ...(mode === 'signup' ? { phone: phoneRef.current } : {}),
      });
      afterAuth(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed.');
    }
  };

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    loadGis(lang)
      .then(() => {
        if (cancelled || !gsiRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredential,
        });
        window.google.accounts.id.renderButton(gsiRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: mode === 'signup' ? 'signup_with' : 'signin_with',
          width: 320,
        });
        setGsiReady(true);
      })
      .catch(() => setGsiReady(false));
    return () => {
      cancelled = true;
    };
    // Re-render so the button label tracks sign-in vs sign-up.
  }, [mode, lang]);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setNote(null);
  }

  function updatePhone(value: string) {
    setPhone(value);
    phoneRef.current = value;
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
            <>
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
              <div className="auth-field">
                <label>{t('auth.phone')}</label>
                <div className="auth-input">
                  <span className="ico">📱</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    required
                    dir="ltr"
                    maxLength={20}
                    placeholder={t('auth.phonePh')}
                    value={phone}
                    onChange={(e) => updatePhone(e.target.value)}
                    aria-describedby="signup-phone-hint"
                  />
                </div>
                <small id="signup-phone-hint" className="muted">{t('auth.phoneHint')}</small>
              </div>
            </>
          )}

          <div className="auth-field">
            <div className="auth-row">
              <label>{t('staff.password')}</label>
              {mode === 'login' && (
                <Link className="auth-forgot" to="/forgot-password">
                  {t('auth.forgot')}
                </Link>
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
            <div ref={gsiRef} />
            {!gsiReady && (
            <button type="button" onClick={() => setNote(t('auth.socialSoon'))} className="google-btn">
              <svg className="google-g" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>
              {t('auth.google')}
            </button>
            )}
          </div>
        </form>

      </div>
    </div>
  );
}
