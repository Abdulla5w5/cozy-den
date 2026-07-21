import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { MonthlyAnalytics, StaffBooking, money } from '../types';

type Tab = 'today' | 'analytics';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function StaffDashboard() {
  const navigate = useNavigate();
  const [staffName, setStaffName] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('today');

  // Verify session on mount; bounce to login on 401.
  useEffect(() => {
    api
      .get<{ staff: { name: string } }>('/staff/me')
      .then((r) => setStaffName(r.staff.name))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) navigate('/staff');
      });
  }, [navigate]);

  async function logout() {
    await api.post('/staff/logout').catch(() => {});
    navigate('/staff');
  }

  if (!staffName) return <p>Loading…</p>;

  return (
    <div className="card wide">
      <div className="dash-head">
        <h2>Dashboard</h2>
        <div>
          <span className="muted">Signed in as {staffName}</span>
          <button className="link" onClick={logout}>
            Log out
          </button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'today' ? 'active' : ''} onClick={() => setTab('today')}>
          Today&apos;s bookings
        </button>
        <button
          className={tab === 'analytics' ? 'active' : ''}
          onClick={() => setTab('analytics')}
        >
          Monthly analytics
        </button>
      </div>

      {tab === 'today' ? <TodayTab /> : <AnalyticsTab />}
    </div>
  );
}

function TodayTab() {
  const [date, setDate] = useState(todayIso());
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const load = useCallback(() => {
    api
      .get<{ bookings: StaffBooking[] }>(`/staff/bookings?date=${date}`)
      .then((r) => setBookings(r.bookings))
      .catch((e) => setError(e.message));
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function checkIn(byCode: string) {
    setError(null);
    try {
      await api.post('/staff/check-in', { code: byCode });
      setCode('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check-in failed.');
    }
  }

  return (
    <section>
      <div className="row">
        <label className="field inline">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <form
          className="checkin"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) checkIn(code.trim());
          }}
        >
          <input
            placeholder="Enter code to check in"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="primary">Check in</button>
        </form>
      </div>

      {error && <div className="alert error">{error}</div>}

      <table className="data">
        <thead>
          <tr>
            <th>Time</th>
            <th>Code</th>
            <th>Guest</th>
            <th>Table</th>
            <th>Game</th>
            <th>Order</th>
            <th>Total</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bookings.length === 0 && (
            <tr>
              <td colSpan={9} className="muted center">
                No bookings for this date.
              </td>
            </tr>
          )}
          {bookings.map((b) => (
            <tr key={b.id}>
              <td>{b.timeSlot}</td>
              <td>
                <code>{b.verificationCode}</code>
              </td>
              <td>{b.guestName}</td>
              <td>{b.tableLabel}</td>
              <td>{b.gameTitle ?? '—'}</td>
              <td>
                {b.items.length === 0
                  ? '—'
                  : b.items.map((i) => `${i.quantity}×${i.name}`).join(', ')}
              </td>
              <td>{money(b.totalCents)}</td>
              <td>
                <span className={`status ${b.status}`}>{b.status}</span>
              </td>
              <td>
                {b.status === 'arrived' ? (
                  <span className="muted">✓</span>
                ) : (
                  <button className="link" onClick={() => checkIn(b.verificationCode)}>
                    Check in
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AnalyticsTab() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<MonthlyAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ analytics: MonthlyAnalytics }>(`/staff/analytics?month=${month}`)
      .then((r) => setData(r.analytics))
      .catch((e) => setError(e.message));
  }, [month]);

  return (
    <section>
      <label className="field inline">
        Month
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </label>

      {error && <div className="alert error">{error}</div>}
      {!data ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <span>Bookings</span>
              <strong>{data.bookingsCount}</strong>
            </div>
            <div className="kpi">
              <span>Revenue</span>
              <strong>{money(data.revenueCents)}</strong>
            </div>
          </div>

          <div className="analytics-grid">
            <div>
              <h4>Popular games</h4>
              <AnalyticsList
                rows={data.popularGames.map((g) => [g.title, g.bookings])}
                empty="No game bookings yet."
              />
            </div>
            <div>
              <h4>Peak time slots</h4>
              <AnalyticsList
                rows={data.peakSlots.map((s) => [s.timeSlot, s.bookings])}
                empty="No bookings yet."
              />
            </div>
            <div>
              <h4>Table utilization</h4>
              <AnalyticsList
                rows={data.tableUtilization.map((t) => [
                  `${t.label} (${t.capacity})`,
                  t.bookings,
                ])}
                empty="No tables."
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function AnalyticsList({ rows, empty }: { rows: [string, number][]; empty: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return (
    <ul className="bars">
      {rows.map(([label, value]) => (
        <li key={label}>
          <span className="bar-label">{label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(value / max) * 100}%` }} />
          </span>
          <span className="bar-value">{value}</span>
        </li>
      ))}
    </ul>
  );
}
