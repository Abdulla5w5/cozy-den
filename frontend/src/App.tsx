import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api/client';
import { Home } from './pages/Home';
import { GamesPage } from './pages/GamesPage';
import { MenuPage } from './pages/MenuPage';
import { BookingFlow } from './pages/BookingFlow';
import { Confirmation } from './pages/Confirmation';
import { StaffLogin } from './pages/StaffLogin';
import { StaffDashboard } from './pages/StaffDashboard';

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [staff, setStaff] = useState<{ name: string; email: string } | null>(null);
  const loggedIn = staff !== null;

  // Re-check the session on navigation so the nav stays accurate.
  useEffect(() => {
    let active = true;
    api
      .get<{ staff: { name: string; email: string } }>('/staff/me')
      .then((r) => active && setStaff(r.staff))
      .catch(() => active && setStaff(null));
    return () => {
      active = false;
    };
  }, [location.pathname]);

  async function logout() {
    await api.post('/staff/logout').catch(() => {});
    setStaff(null);
    navigate('/');
  }

  // On the booking page the "Book a Table" CTA is redundant, so swap it for an
  // account action: Log out if signed in, otherwise Sign up.
  const inBooking = location.pathname === '/book';

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          🎲 Cozy Den
        </Link>
        <nav className="mainnav">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/games">Games</NavLink>
          <NavLink to="/menu">Menu</NavLink>
          {/* Staff entry is unlisted; only appears once signed in. */}
          {loggedIn && <NavLink to="/staff/dashboard">Staff</NavLink>}
        </nav>
        <div className="nav-actions">
          {inBooking ? (
            loggedIn ? (
              <button className="cta button nav-cta" onClick={logout}>
                Log out
              </button>
            ) : (
              <Link to="/staff" className="cta button nav-cta">
                Sign up
              </Link>
            )
          ) : (
            <Link to="/book" className="cta button nav-cta">
              Book a Table
            </Link>
          )}
        </div>
      </header>

      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/book" element={<BookingFlow />} />
          <Route path="/confirmation/:code" element={<Confirmation />} />
          <Route path="/staff" element={<StaffLogin />} />
          <Route path="/staff/dashboard" element={<StaffDashboard />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="brand">🎲 Cozy Den</span>
            <p className="muted">Board games, great food, and good company — nightly.</p>
          </div>
          <div className="footer-cols">
            <div>
              <h4>Visit</h4>
              <Link to="/book">Book a table</Link>
              <Link to="/games">Game library</Link>
              <Link to="/menu">Food &amp; drink</Link>
            </div>
            <div>
              <h4>Café</h4>
              <a href="#">House rules</a>
              <a href="#">Location</a>
              <a href="#">Contact</a>
            </div>
            {loggedIn && (
              <div>
                <h4>Staff</h4>
                <Link to="/staff/dashboard">Dashboard</Link>
              </div>
            )}
          </div>
        </div>
        <div className="footer-legal muted">
          © 2026 Cozy Den Board Game Café · Prototype — payments &amp; email are stubbed.
        </div>
      </footer>
    </div>
  );
}
