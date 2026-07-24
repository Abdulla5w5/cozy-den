import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api/client';
import { useI18n } from './i18n';
import { Home } from './pages/Home';
import { GamesPage } from './pages/GamesPage';
import { MenuPage } from './pages/MenuPage';
import { BookingFlow } from './pages/BookingFlow';
import { Confirmation } from './pages/Confirmation';
import { StaffLogin } from './pages/StaffLogin';
import { StaffDashboard } from './pages/StaffDashboard';
import { MyBookings } from './pages/MyBookings';
import { EventsPage } from './pages/EventsPage';
import { SupportPage, SupportThreadPage } from './pages/SupportPage';
import { PromoModal } from './components/PromoModal';

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang, toggle } = useI18n();
  const [user, setUser] = useState<{ name: string; email: string; isStaff: boolean } | null>(null);
  const loggedIn = user !== null;

  useEffect(() => {
    let active = true;
    api
      .get<{ user: { name: string; email: string; isStaff: boolean } }>('/auth/me')
      .then((r) => active && setUser(r.user))
      .catch(() => active && setUser(null));
    return () => {
      active = false;
    };
  }, [location.pathname]);

  async function logout() {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
    navigate('/');
  }

  return (
    <div className="app">
      <PromoModal />
      <header className="topbar">
        <Link to="/" className="brand">
          🎲 Cozy Den
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
          {loggedIn && !user?.isStaff && (
            <NavLink to="/account">{t('nav.mybookings')}</NavLink>
          )}
          {loggedIn && !user?.isStaff && <NavLink to="/support">{t('nav.support')}</NavLink>}
          {user?.isStaff && <NavLink to="/staff/dashboard">{t('nav.staff')}</NavLink>}
        </nav>
        <div className="nav-actions">
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
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/support/:id" element={<SupportThreadPage />} />
          <Route path="/book" element={<BookingFlow />} />
          <Route path="/confirmation/:code" element={<Confirmation />} />
          {/* Public auth page — separate from the staff namespace. */}
          <Route path="/register" element={<StaffLogin />} />
          <Route path="/account" element={<MyBookings />} />
          <Route path="/staff/dashboard" element={<StaffDashboard />} />
          {/* Bare /staff just points at the dashboard (which guards itself). */}
          <Route path="/staff" element={<Navigate to="/staff/dashboard" replace />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="brand">🎲 Cozy Den</span>
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
