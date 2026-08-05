import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, notifyAuthChanged, AUTH_CHANGED } from './api/client';
import { useI18n } from './i18n';
import { Home } from './pages/Home';
import { PromoModal } from './components/PromoModal';
import { VerifyBanner } from './components/VerifyBanner';

// The home shell is eager; secondary and staff pages load only when visited.
// This keeps staff/admin code out of every customer's initial browser heap and
// lets the browser release never-requested route modules entirely.
const GamesPage = lazy(() => import('./pages/GamesPage').then((m) => ({ default: m.GamesPage })));
const MenuPage = lazy(() => import('./pages/MenuPage').then((m) => ({ default: m.MenuPage })));
const BookingFlow = lazy(() => import('./pages/BookingFlow').then((m) => ({ default: m.BookingFlow })));
const Confirmation = lazy(() => import('./pages/Confirmation').then((m) => ({ default: m.Confirmation })));
const StaffLogin = lazy(() => import('./pages/StaffLogin').then((m) => ({ default: m.StaffLogin })));
const StaffDashboard = lazy(() => import('./pages/StaffDashboard').then((m) => ({ default: m.StaffDashboard })));
const MyBookings = lazy(() => import('./pages/MyBookings').then((m) => ({ default: m.MyBookings })));
const EventsPage = lazy(() => import('./pages/EventsPage').then((m) => ({ default: m.EventsPage })));
const SupportPage = lazy(() => import('./pages/SupportPage').then((m) => ({ default: m.SupportPage })));
const SupportThreadPage = lazy(() => import('./pages/SupportPage').then((m) => ({ default: m.SupportThreadPage })));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail').then((m) => ({ default: m.VerifyEmail })));
const WantedBoard = lazy(() => import('./pages/WantedBoard').then((m) => ({ default: m.WantedBoard })));
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/ForgotPassword').then((m) => ({ default: m.ResetPassword })));

type Theme = 'light' | 'dark';

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem('cd_theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* localStorage may be unavailable */
  }
  // Light is the brand default for first-time visitors. We deliberately do NOT
  // follow prefers-color-scheme here — a visitor whose OS is in dark mode would
  // otherwise land on the dark skin, which isn't the look we lead with. Anyone
  // who picks dark via the toggle keeps it (handled by the saved value above).
  return 'light';
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang, toggle } = useI18n();
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    // Keep the mobile browser chrome (address bar) in step with the theme.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0d0f14' : '#fffaf1');
    try {
      localStorage.setItem('cd_theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const [user, setUser] = useState<{
    name: string;
    email: string;
    isStaff: boolean;
    isAdmin: boolean;
    emailVerified: boolean;
  } | null>(null);
  const [authTick, setAuthTick] = useState(0);
  const loggedIn = user !== null;

  useEffect(() => {
    let active = true;
    api
      .get<{ user: { name: string; email: string; isStaff: boolean; isAdmin: boolean; emailVerified: boolean } }>(
        '/auth/me',
      )
      .then((r) => active && setUser(r.user))
      .catch(() => active && setUser(null));
    return () => {
      active = false;
    };
    // Deliberately NOT keyed on the route. Identity does not change because
    // someone clicked "Menu", and refetching it on every navigation put a
    // round trip in front of each menu click. Sign-in and sign-out announce
    // themselves instead, via the AUTH_CHANGED event handled below.
  }, [authTick]);

  // Router navigation keeps the previous scroll offset, so arriving at a new
  // page part-way down read as the page having "not changed" on short pages.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    const bump = () => setAuthTick((n) => n + 1);
    window.addEventListener(AUTH_CHANGED, bump);
    return () => window.removeEventListener(AUTH_CHANGED, bump);
  }, []);

  async function logout() {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
    notifyAuthChanged();
    navigate('/');
  }

  return (
    <div className="app">
      <PromoModal />
      {loggedIn && user && !user.emailVerified && !user.isStaff && (
        <VerifyBanner email={user.email} />
      )}
      <header className="topbar">
        <Link to="/" className="brand brand-lockup" aria-label={t('brand.home')}>
          <img src="/brand/cozy-den-wordmark.png" alt="Cozy Den" />
        </Link>
        {/* Guests see four links, which fit without scrolling; signed-in users
            get extra links and the row becomes swipeable. */}
        <nav className={`mainnav ${loggedIn ? 'authed' : 'guest'}`}>
          <NavLink to="/" end>
            {t('nav.home')}
          </NavLink>
          <NavLink to="/games">{t('nav.games')}</NavLink>
          <NavLink to="/menu">{t('nav.menu')}</NavLink>
          <NavLink to="/events">{t('nav.events')}</NavLink>
          <NavLink to="/wanted">{t('nav.wanted')}</NavLink>
          <NavLink to="/about">{t('nav.about')}</NavLink>
          {loggedIn && !user?.isStaff && (
            <NavLink to="/account">{t('nav.mybookings')}</NavLink>
          )}
          {loggedIn && !user?.isStaff && <NavLink to="/support">{t('nav.support')}</NavLink>}
          {user?.isStaff && <NavLink to="/staff/dashboard">{t('nav.staff')}</NavLink>}
        </nav>
        <div className="nav-actions">
          {/* Light / dark theme toggle */}
          <button
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
            aria-label={theme === 'light' ? t('theme.dark') : t('theme.light')}
            title={theme === 'light' ? t('theme.dark') : t('theme.light')}
          >
            <span className="theme-toggle-track" aria-hidden="true">
              <span className="theme-toggle-thumb">{theme === 'light' ? '☀' : '☾'}</span>
            </span>
          </button>
          {/* Language switch (EN ⇄ عربي), right by the login/out button */}
          <button
            className="lang-toggle"
            onClick={toggle}
            aria-label="Switch language"
            title={lang === 'en' ? 'التبديل إلى العربية' : 'Switch to English'}
          >
            {lang === 'en' ? 'عربي' : 'EN'}
          </button>
          {loggedIn ? (
            <button className="cta button nav-cta" onClick={logout}>
              {t('nav.logout')}
            </button>
          ) : (
            <Link to="/register" className="cta button nav-cta">
              {t('nav.register')}
            </Link>
          )}
        </div>
      </header>

      <main className="content">
        <Suspense fallback={<p aria-live="polite">{t('loading')}</p>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/games" element={<GamesPage />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/wanted" element={<WantedBoard />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/support" element={<SupportPage />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/support/:id" element={<SupportThreadPage />} />
            <Route path="/book" element={<BookingFlow />} />
            <Route path="/confirmation/:code" element={<Confirmation />} />
            {/* Public auth page — separate from the staff namespace. */}
            <Route path="/register" element={<StaffLogin />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/account" element={<MyBookings />} />
            <Route path="/staff/dashboard" element={<StaffDashboard />} />
            {/* Bare /staff just points at the dashboard (which guards itself). */}
            <Route path="/staff" element={<Navigate to="/staff/dashboard" replace />} />
            <Route path="*" element={<p>Page not found.</p>} />
          </Routes>
        </Suspense>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <Link to="/" className="brand footer-lockup" aria-label={t('brand.home')}>
              <img src="/brand/cozy-den-wordmark.png" alt="Cozy Den" />
            </Link>
            <p className="muted">{t('footer.tagline')}</p>
            <a
              className="social-link"
              href="https://www.instagram.com/cozyden.kw/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('footer.instagram')}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <rect
                  x="2.5"
                  y="2.5"
                  width="19"
                  height="19"
                  rx="5.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="17.4" cy="6.6" r="1.2" fill="currentColor" />
              </svg>
              <span>@cozyden.kw</span>
            </a>
          </div>
          <div className="footer-cols">
            <div>
              <h4>{t('footer.visit')}</h4>
              <Link to="/book">{t('footer.book')}</Link>
              <Link to="/games">{t('footer.library')}</Link>
              <Link to="/menu">{t('footer.food')}</Link>
            </div>
            <div>
              <h4>{t('footer.cafe')}</h4>
              <a
                href="https://maps.app.goo.gl/trvMLY888ZiGpdpQ7"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('footer.location')}
              </a>
              <Link to="/support">{t('footer.contact')}</Link>
            </div>
            {user?.isStaff && (
              <div>
                <h4>{t('nav.staff')}</h4>
                <Link to="/staff/dashboard">{t('footer.dashboard')}</Link>
              </div>
            )}
          </div>
        </div>
        <div className="footer-legal muted">{t('footer.legal')}</div>
      </footer>
    </div>
  );
}
