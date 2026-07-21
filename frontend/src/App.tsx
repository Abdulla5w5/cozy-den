import { Link, Route, Routes } from 'react-router-dom';
import { BookingFlow } from './pages/BookingFlow';
import { Confirmation } from './pages/Confirmation';
import { StaffLogin } from './pages/StaffLogin';
import { StaffDashboard } from './pages/StaffDashboard';

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          🎲 Cozy Den
        </Link>
        <nav>
          <Link to="/">Book a table</Link>
          <Link to="/staff">Staff</Link>
        </nav>
      </header>

      <main className="content">
        <Routes>
          <Route path="/" element={<BookingFlow />} />
          <Route path="/confirmation/:code" element={<Confirmation />} />
          <Route path="/staff" element={<StaffLogin />} />
          <Route path="/staff/dashboard" element={<StaffDashboard />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>

      <footer className="footer">
        <span>Prototype — payments &amp; email are stubbed placeholders.</span>
      </footer>
    </div>
  );
}
