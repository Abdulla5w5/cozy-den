import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { MonthlyAnalytics, StaffBooking } from '../types';

type Tab = 'today' | 'analytics' | 'customers';

interface Customer {
  name: string;
  email: string;
  visits: number;
  totalCents: number;
  lastVisit: string;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function StaffDashboard() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [staffName, setStaffName] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('today');

  useEffect(() => {
    api
      .get<{ user: { name: string; isStaff: boolean } }>('/auth/me')
      .then((r) => {
        if (!r.user.isStaff) navigate('/'); // logged in but not staff
        else setStaffName(r.user.name);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) navigate('/register');
      });
  }, [navigate]);

  async function logout() {
    await api.post('/auth/logout').catch(() => {});
    navigate('/register');
  }

  if (!staffName) return <p>{t('loading')}</p>;

  return (
    <div className="card wide">
      <div className="dash-head">
        <h2>{t('staff.dashboard')}</h2>
        <div>
          <span className="muted">{t('staff.signedInAs', { name: staffName })}</span>
          <button className="link" onClick={logout}>
            {t('nav.logout')}
          </button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'today' ? 'active' : ''} onClick={() => setTab('today')}>
          {t('staff.today')}
        </button>
        <button className={tab === 'analytics' ? 'active' : ''} onClick={() => setTab('analytics')}>
          {t('staff.analytics')}
        </button>
        <button className={tab === 'customers' ? 'active' : ''} onClick={() => setTab('customers')}>
          {t('staff.customers')}
        </button>
      </div>

      {tab === 'today' ? <TodayTab /> : tab === 'analytics' ? <AnalyticsTab /> : <CustomersTab />}
    </div>
  );
}

function TodayTab() {
  const { t, money } = useI18n();
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
          {t('bk.date')}
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
            placeholder={t('staff.checkinPh')}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="primary">{t('staff.checkin')}</button>
        </form>
      </div>

      {error && <div className="alert error">{error}</div>}

      <table className="data">
        <thead>
          <tr>
            <th>{t('staff.time')}</th>
            <th>{t('staff.code')}</th>
            <th>{t('staff.guest')}</th>
            <th>{t('bk.table')}</th>
            <th>{t('bk.game')}</th>
            <th>{t('staff.order')}</th>
            <th>{t('bk.total')}</th>
            <th>{t('staff.status')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bookings.length === 0 && (
            <tr>
              <td colSpan={9} className="muted center">
                {t('staff.noBookings')}
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
                    {t('staff.checkin')}
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
  const { t, money } = useI18n();
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
        {t('staff.month')}
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </label>

      {error && <div className="alert error">{error}</div>}
      {!data ? (
        <p>{t('loading')}</p>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <span>{t('staff.bookings')}</span>
              <strong>{data.bookingsCount}</strong>
            </div>
            <div className="kpi">
              <span>{t('staff.revenue')}</span>
              <strong>{money(data.revenueCents)}</strong>
            </div>
          </div>

          <div className="analytics-grid">
            <div>
              <h4>{t('staff.popularGames')}</h4>
              <AnalyticsList
                rows={data.popularGames.map((g) => [g.title, g.bookings])}
                empty={t('staff.emptyGames')}
              />
            </div>
            <div>
              <h4>{t('staff.peak')}</h4>
              <AnalyticsList
                rows={data.peakSlots.map((s) => [s.timeSlot, s.bookings])}
                empty={t('staff.emptyBookings')}
              />
            </div>
            <div>
              <h4>{t('staff.utilization')}</h4>
              <AnalyticsList
                rows={data.tableUtilization.map((tb) => [`${tb.label} (${tb.capacity})`, tb.bookings])}
                empty={t('staff.noTables')}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function CustomersTab() {
  const { t, money } = useI18n();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ customers: Customer[] }>('/staff/customers')
      .then((r) => setCustomers(r.customers))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <section>
      <p className="muted">{t('cust.hint')}</p>
      {error && <div className="alert error">{error}</div>}
      {customers === null ? (
        <p>{t('loading')}</p>
      ) : customers.length === 0 ? (
        <p className="muted">{t('cust.empty')}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{t('bk.name')}</th>
              <th>{t('bk.email')}</th>
              <th>{t('cust.visits')}</th>
              <th>{t('cust.spent')}</th>
              <th>{t('cust.last')}</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.email}>
                <td>{c.name}</td>
                <td>
                  <a href={`mailto:${c.email}`} className="card-link">
                    {c.email}
                  </a>
                </td>
                <td>{c.visits}</td>
                <td>{money(c.totalCents)}</td>
                <td>{c.lastVisit}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
