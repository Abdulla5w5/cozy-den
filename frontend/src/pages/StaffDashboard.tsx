import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { MonthlyAnalytics, StaffBooking, Table, TableAvailability } from '../types';

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

  if (!staffName) return <p className="staff-loading">{t('loading')}</p>;

  return (
    <div className="staff-dashboard">
      <header className="staff-portal-bar">
        <div className="staff-brand">
          <span>Cozy Den</span>
          <small>Staff portal</small>
        </div>
        <nav className="staff-nav" aria-label="Staff dashboard views">
          <button className={tab === 'today' ? 'active' : ''} onClick={() => setTab('today')}>
            {t('staff.today')}
          </button>
          <button className={tab === 'analytics' ? 'active' : ''} onClick={() => setTab('analytics')}>
            {t('staff.analytics')}
          </button>
          <button className={tab === 'customers' ? 'active' : ''} onClick={() => setTab('customers')}>
            {t('staff.customers')}
          </button>
        </nav>
        <div className="staff-profile">
          <span className="staff-avatar" aria-hidden="true">{staffName.slice(0, 1).toUpperCase()}</span>
          <span className="staff-profile-name">{staffName}</span>
          <button className="staff-signout" onClick={logout}>{t('nav.logout')}</button>
        </div>
      </header>
      <main className="staff-dashboard-main">
        {tab === 'today' ? <TodayTab /> : tab === 'analytics' ? <AnalyticsTab /> : <CustomersTab />}
      </main>
    </div>
  );
}

type StatusFilter = 'all' | 'pending' | 'print_receipt' | 'order_complete';
const STATUS_FILTERS: StatusFilter[] = ['all', 'pending', 'print_receipt', 'order_complete'];

function TodayTab() {
  const { t, money } = useI18n();
  const [date, setDate] = useState(todayIso());
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ bookings: StaffBooking[] }>(`/staff/bookings?date=${date}`)
      .then((r) => setBookings(r.bookings))
      .catch((e) => setError(e.message));
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(path: string, body?: unknown) {
    setError(null);
    try {
      await api.post(path, body);
      setCode('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    }
  }

  const shown = filter === 'all' ? bookings : bookings.filter((b) => b.status === filter);
  const outstanding = bookings.filter((b) => b.status === 'print_receipt').length;

  return (
    <section className="staff-floor">
      <div className="staff-page-heading">
        <div>
          <span className="staff-kicker">Operations board</span>
          <h1>Daily floor map</h1>
          <p>Live arrivals, orders, and table handoffs for the selected service date.</p>
        </div>
        <button className="staff-new-booking" onClick={() => setShowForm((v) => !v)}>
          {showForm ? t('staff.closeForm') : t('staff.newBooking')}
        </button>
      </div>

      <div className="staff-control-bar">
        <label className="field inline">
          {t('bk.date')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <form
          className="staff-quick-checkin"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) act('/staff/confirm', { code: code.trim() });
          }}
        >
          <input
            placeholder={t('staff.confirmPh')}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button>{t('staff.confirmBtn')}</button>
        </form>
      </div>

      {showForm && (
        <ManualBookingForm
          defaultDate={date}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="staff-filter-row">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            className={filter === f ? 'active' : ''}
            onClick={() => setFilter(f)}
          >
            {t(`status.${f}`)}
            {f === 'print_receipt' && outstanding > 0 ? ` (${outstanding})` : ''}
          </button>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="staff-arrivals-card">
        <div className="staff-card-head">
          <div>
            <span className="staff-kicker">Live queue</span>
            <h2>Active arrivals</h2>
          </div>
          <span>{shown.length} shown</span>
        </div>
      <table className="data staff-arrivals-table">
        <thead>
          <tr>
            <th>{t('staff.time')}</th>
            <th>{t('staff.code')}</th>
            <th>{t('staff.guest')}</th>
            <th>{t('staff.contact')}</th>
            <th>{t('bk.table')}</th>
            <th>{t('staff.source')}</th>
            <th>{t('bk.total')}</th>
            <th>{t('staff.status')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td colSpan={9} className="muted center">
                {t('staff.noBookings')}
              </td>
            </tr>
          )}
          {shown.map((b) => (
            <tr key={b.id}>
              <td>{b.timeSlot}</td>
              <td>
                <code>{b.verificationCode}</code>
              </td>
              <td>{b.guestName}</td>
              <td>{b.guestContact}</td>
              <td>{b.tableLabel}</td>
              <td>
                <span className="pill">{t(`source.${b.source}`)}</span>
              </td>
              <td>{money(b.totalCents)}</td>
              <td>
                <span className={`status ${b.status}`}>{t(`status.${b.status}`)}</span>
              </td>
              <td>
                {b.status === 'pending' ? (
                  <button className="link" onClick={() => act(`/staff/bookings/${b.id}/confirm`)}>
                    {t('staff.confirmBtn')}
                  </button>
                ) : b.status === 'print_receipt' ? (
                  <button className="link" onClick={() => act(`/staff/bookings/${b.id}/printed`)}>
                    {t('staff.printedBtn')}
                  </button>
                ) : (
                  <span className="muted">✓</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}

// Manual entry for phone/WhatsApp bookings — same rules as the online flow
// (30-min starts, 2h sessions, no overlap), tagged source: staff_manual.
function ManualBookingForm({
  defaultDate,
  onCreated,
}: {
  defaultDate: string;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [tables, setTables] = useState<Table[]>([]);
  const [availability, setAvailability] = useState<TableAvailability[]>([]);
  const [date, setDate] = useState(defaultDate);
  const [tableId, setTableId] = useState<number | ''>('');
  const [timeSlot, setTimeSlot] = useState('');
  const [guestName, setGuestName] = useState('');
  const [contact, setContact] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ tables: Table[] }>('/tables').then((r) => setTables(r.tables)).catch(() => {});
  }, []);

  useEffect(() => {
    setTimeSlot('');
    api
      .get<{ availability: TableAvailability[] }>(`/tables/availability?date=${date}`)
      .then((r) => setAvailability(r.availability))
      .catch(() => {});
  }, [date]);

  const freeSlots =
    tableId === '' ? [] : availability.find((a) => a.tableId === tableId)?.freeSlots ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/staff/bookings', { tableId, date, timeSlot, guestName, contact });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create booking.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="summary manual-form" onSubmit={submit}>
      <h3>{t('staff.newBooking')}</h3>
      {error && <div className="alert error">{error}</div>}
      <div className="row">
        <label className="field inline">
          {t('bk.date')}
          <input
            type="date"
            min={todayIso()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="field inline">
          {t('bk.table')}
          <select
            value={tableId}
            onChange={(e) => {
              setTableId(e.target.value === '' ? '' : Number(e.target.value));
              setTimeSlot('');
            }}
          >
            <option value="">—</option>
            {tables.map((tb) => (
              <option key={tb.id} value={tb.id}>
                {tb.label} ({tb.capacity})
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          {t('staff.start')}
          <select value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)}>
            <option value="">—</option>
            {freeSlots.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <label className="field inline">
          {t('bk.name')}
          <input value={guestName} onChange={(e) => setGuestName(e.target.value)} />
        </label>
        <label className="field inline">
          {t('staff.contact')}
          <input
            placeholder={t('staff.contactPh')}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={busy || tableId === '' || !timeSlot || !guestName || contact.trim().length < 3}
        >
          {busy ? t('bk.processing') : t('staff.createBtn')}
        </button>
      </div>
    </form>
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

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}-01T00:00:00`));
  const topSlot = data?.peakSlots[0];
  const activeTables = data?.tableUtilization.filter((table) => table.bookings > 0).length ?? 0;
  const averageBookingValue =
    data && data.bookingsCount > 0 ? Math.round(data.revenueCents / data.bookingsCount) : 0;

  return (
    <section className="staff-analytics">
      <div className="staff-analytics-heading">
        <div>
          <span className="staff-kicker">Performance desk</span>
          <h1>Monthly analytics</h1>
          <p>Booking demand, revenue, and floor usage for {monthLabel}.</p>
        </div>
        <label className="staff-month-picker">
          <span>{t('staff.month')}</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>

      {error && <div className="alert error">{error}</div>}
      {!data ? (
        <div className="staff-analytics-loading">{t('loading')}</div>
      ) : (
        <>
          <div className="staff-analytics-kpis">
            <article className="staff-analytics-kpi revenue">
              <div className="staff-analytics-kpi-label">
                <span>{t('staff.revenue')}</span>
                <small>{data.month === thisMonth() ? 'Live month' : 'Selected month'}</small>
              </div>
              <strong>{money(data.revenueCents)}</strong>
              <p>{money(averageBookingValue)} average booking value</p>
            </article>

            <article className="staff-analytics-kpi bookings">
              <div className="staff-analytics-kpi-label">
                <span>{t('staff.bookings')}</span>
                <small>{activeTables} active tables</small>
              </div>
              <strong>{data.bookingsCount}</strong>
              <p>
                {activeTables > 0
                  ? `${(data.bookingsCount / activeTables).toFixed(1)} per active table`
                  : 'No table activity yet'}
              </p>
            </article>

            <article className="staff-analytics-kpi peak">
              <div className="staff-analytics-kpi-label">
                <span>{t('staff.peak')}</span>
                <small>Highest demand</small>
              </div>
              <strong>{topSlot?.timeSlot ?? '--:--'}</strong>
              <p>
                {topSlot
                  ? `${topSlot.bookings} booking${topSlot.bookings === 1 ? '' : 's'} in this slot`
                  : 'No peak window yet'}
              </p>
            </article>
          </div>

          <div className="staff-analytics-grid">
            <article className="staff-analytics-panel">
              <div className="staff-analytics-panel-heading">
                <div>
                  <span className="staff-kicker">Service rhythm</span>
                  <h2>{t('staff.peak')}</h2>
                  <p>Booking volume by arrival time.</p>
                </div>
                <span className="staff-analytics-period">{monthLabel}</span>
              </div>
              <AnalyticsList
                rows={data.peakSlots.map((s) => [s.timeSlot, s.bookings])}
                empty={t('staff.emptyBookings')}
                valueLabel="bookings"
                tone="amber"
              />
            </article>

            <article className="staff-analytics-panel">
              <div className="staff-analytics-panel-heading">
                <div>
                  <span className="staff-kicker">Floor balance</span>
                  <h2>{t('staff.utilization')}</h2>
                  <p>Monthly reservations by table and capacity.</p>
                </div>
                <span className="staff-analytics-period">
                  {activeTables}/{data.tableUtilization.length} active
                </span>
              </div>
              <AnalyticsList
                rows={data.tableUtilization.map((tb) => [`${tb.label} (${tb.capacity})`, tb.bookings])}
                empty={t('staff.noTables')}
                valueLabel="bookings"
                tone="violet"
              />
            </article>
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

function AnalyticsList({
  rows,
  empty,
  valueLabel,
  tone = 'primary',
}: {
  rows: [string, number][];
  empty: string;
  valueLabel: string;
  tone?: 'primary' | 'amber' | 'violet';
}) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return (
    <ul className={`staff-analytics-bars ${tone}`}>
      {rows.map(([label, value]) => (
        <li key={label}>
          <div>
            <strong>{label}</strong>
            <span>
              {value} {valueLabel}
            </span>
          </div>
          <span className="staff-analytics-bar-track" aria-hidden="true">
            <span
              className="staff-analytics-bar-fill"
              style={{ width: `${(value / max) * 100}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
