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

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang, toggle } = useI18n();
  const [user, setUser] = useState<{ name: string; email: string; isStaff: boolean } | null>(null);
  const loggedIn = user !== null;
  const isStaffRoute = location.pathname.startsWith('/staff');

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
      {!isStaffRoute && (
        <header className="topbar">
          <Link to="/" className="brand">
            🎲 Cozy Den
          </Link>
          <nav className="mainnav">
            <NavLink to="/" end>
              {t('nav.home')}
            </NavLink>
            <NavLink to="/games">{t('nav.games')}</NavLink>
            <NavLink to="/menu">{t('nav.menu')}</NavLink>
            {loggedIn && !user?.isStaff && (
              <NavLink to="/account">{t('nav.mybookings')}</NavLink>
            )}
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
      )}

      <main className={isStaffRoute ? 'staff-content' : 'content'}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/menu" element={<MenuPage />} />
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

      {!isStaffRoute && (
        <footer className="footer">
          <div className="footer-inner">
            <div className="footer-brand">
              <span className="brand">🎲 Cozy Den</span>
              <p className="muted">{t('footer.tagline')}</p>
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
                <a href="#">{t('footer.rules')}</a>
                <a href="#">{t('footer.location')}</a>
                <a href="#">{t('footer.contact')}</a>
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
      )}
    </div>
  );
}
