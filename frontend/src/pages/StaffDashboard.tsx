import { createPortal } from 'react-dom';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { MonthlyAnalytics, StaffBooking, Table, TableAvailability, TeamMember } from '../types';
import { EventsTab, PromoTab, GamesTab, MenuTab } from './StaffContent';
import { SupportTab } from './StaffSupport';
import { StaffWanted } from './StaffWanted';
import { StaffPricing } from './StaffPricing';
import { CafeFloorPlan, FloorTable } from '../components/CafeFloorPlan';

type Tab = 'today' | 'analytics' | 'customers' | 'events' | 'promo' | 'team' | 'support' | 'wanted' | 'pricing' | 'games' | 'menu';

interface Customer {
  name: string;
  email: string;
  phone: string | null;
  visits: number;
  totalCents: number;
  lastVisit: string | null;
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
  const [staffEmail, setStaffEmail] = useState('');
  // Team management is admin-only server-side; hide the tab so the UI can't
  // offer an action that would just 403.
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<Tab>('today');

  useEffect(() => {
    api
      .get<{ user: { name: string; email: string; isStaff: boolean; isAdmin: boolean } }>('/auth/me')
      .then((r) => {
        if (!r.user.isStaff) navigate('/'); // logged in but not staff
        else {
          setIsAdmin(r.user.isAdmin);
          setStaffName(r.user.name);
          setStaffEmail(r.user.email);
        }
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
        <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>
          {t('staff.events')}
        </button>
        <button className={tab === 'games' ? 'active' : ''} onClick={() => setTab('games')}>
          {t('staff.games')}
        </button>
        <button className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>
          {t('staff.menu')}
        </button>
        <button className={tab === 'promo' ? 'active' : ''} onClick={() => setTab('promo')}>
          {t('staff.promo')}
        </button>
        {isAdmin && (
          <button className={tab === 'pricing' ? 'active' : ''} onClick={() => setTab('pricing')}>
            {t('staff.pricing')}
          </button>
        )}
        <button className={tab === 'wanted' ? 'active' : ''} onClick={() => setTab('wanted')}>
          {t('staff.wanted')}
        </button>
        <button className={tab === 'support' ? 'active' : ''} onClick={() => setTab('support')}>
          {t('staff.support')}
        </button>
        {isAdmin && (
          <button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>
            {t('staff.team')}
          </button>
        )}
      </div>

      {tab === 'today' ? (
        <TodayTab />
      ) : tab === 'analytics' ? (
        <AnalyticsTab />
      ) : tab === 'customers' ? (
        <CustomersTab />
      ) : tab === 'events' ? (
        <EventsTab />
      ) : tab === 'support' ? (
        <SupportTab />
      ) : tab === 'games' ? (
        <GamesTab />
      ) : tab === 'menu' ? (
        <MenuTab />
      ) : tab === 'pricing' ? (
        <StaffPricing />
      ) : tab === 'wanted' ? (
        <StaffWanted />
      ) : tab === 'team' ? (
        <TeamTab meEmail={staffEmail} />
      ) : (
        <PromoTab />
      )}
    </div>
  );
}

type StatusFilter = 'all' | 'pending' | 'arrived' | 'order_complete';
const STATUS_FILTERS: StatusFilter[] = ['all', 'pending', 'arrived', 'order_complete'];

function TodayTab() {
  const { t, money } = useI18n();
  const [date, setDate] = useState(todayIso());
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [printing, setPrinting] = useState<StaffBooking | null>(null);

  const load = useCallback(() => {
    // A date field held mid-edit (or cleared) reports an empty value, which the
    // API rightly refuses — don't ask it, and don't flash "Validation failed"
    // at someone who is halfway through typing a past date.
    if (!date) return;
    setError(null);
    api
      .get<{ bookings: StaffBooking[] }>(`/staff/bookings?date=${encodeURIComponent(date)}`)
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

  /**
   * Print flow: render the receipt off-screen and hand it to the browser's
   * print dialog (which also offers "Save as PDF").
   *
   * That is the whole of it. Printing changes no state, so cancelling the
   * dialog costs nothing and a receipt can be printed again as often as
   * needed — neither of which was true when `afterprint` advanced the order,
   * since that event fires whether or not paper came out.
   *
   * The wait is two animation frames rather than a 50ms guess: the receipt is
   * portalled into <body>, and printing before the browser has laid it out
   * yields a blank page.
   */
  useEffect(() => {
    if (!printing) return;
    let cancelled = false;
    const clear = () => setPrinting(null);
    window.addEventListener('afterprint', clear, { once: true });
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!cancelled) window.print();
      }),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('afterprint', clear);
    };
  }, [printing]);

  const shown = filter === 'all' ? bookings : bookings.filter((b) => b.status === filter);
  const outstanding = bookings.filter((b) => b.status === 'arrived').length;

  return (
    <section>
      <div className="row">
        <label className="field inline">
          {t('bk.date')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? t('staff.closeForm') : t('staff.newBooking')}
        </button>
        <form
          className="checkin"
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
          <button className="primary">{t('staff.confirmBtn')}</button>
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

      <div className="chips left">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            className={`chip ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {t(`status.${f}`)}
            {f === 'arrived' && outstanding > 0 ? ` (${outstanding})` : ''}
          </button>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}

      <TableFloorView date={date} bookings={bookings} onAct={act} onPrint={setPrinting} />

      <div className="table-scroll">
        <table className="data">
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
                {b.status === 'pending' && (
                  <button className="link" onClick={() => act(`/staff/bookings/${b.id}/confirm`)}>
                    {t('staff.confirmBtn')}
                  </button>
                )}
                {b.status === 'arrived' && (
                  <button className="link" onClick={() => act(`/staff/bookings/${b.id}/complete`)}>
                    {t('staff.completeBtn')}
                  </button>
                )}
                {b.status === 'order_complete' && <span className="muted">✓</span>}
                {/* Available on anything confirmed and paid, as often as needed. */}
                {(b.status === 'arrived' || b.status === 'order_complete') && (
                  <button className="link" onClick={() => setPrinting(b)}>
                    {t('staff.printBtn')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
        </div>
      {printing && <Receipt booking={printing} date={date} />}
    </section>
  );
}

// Café hours, mirrored from the server's utils/slots: the day runs 14:00 to
// 03:00, so a slot before opening belongs to the small hours after midnight.
const FLOOR_OPEN_MIN = 14 * 60;
const FLOOR_SESSION_MIN = 120;

function slotMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const minutes = h * 60 + m;
  return minutes < FLOOR_OPEN_MIN ? minutes + 24 * 60 : minutes;
}

function minutesLabel(min: number) {
  const h = Math.floor(min / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * The service date the clock currently sits in, and how far into it we are.
 * At 01:00 the café is still serving *yesterday's* date — closing is 03:00 —
 * so the small hours count towards the previous day, not the next.
 */
function serviceNow() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const day = new Date(now);
  if (minutes < FLOOR_OPEN_MIN) day.setDate(day.getDate() - 1);
  const y = day.getFullYear();
  const mo = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  return {
    date: `${y}-${mo}-${d}`,
    minutes: minutes < FLOOR_OPEN_MIN ? minutes + 24 * 60 : minutes,
  };
}

type Phase = 'earlier' | 'now' | 'upcoming';

/**
 * The floor as staff see it: every table drawn where it stands, coloured by
 * whether someone is sitting there right now or due later. Picking a table
 * lists everything booked on it for the picked day — one service day, 14:00
 * through the 02:00 last seating — finished, in progress and still to come,
 * including holds still waiting on payment, so a table that looks free on the
 * map is never a surprise at the door.
 */
function TableFloorView({
  date,
  bookings,
  onAct,
  onPrint,
}: {
  date: string;
  bookings: StaffBooking[];
  onAct: (path: string) => void;
  onPrint: (b: StaffBooking) => void;
}) {
  const { t } = useI18n();
  const [tables, setTables] = useState<FloorTable[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  // Re-classify "now" as the evening moves on without anyone touching the page.
  const [clock, setClock] = useState(serviceNow);

  function pick(id: number) {
    const next = selectedId === id ? null : id;
    setSelectedId(next);
    // On a phone the panel sits below the map, out of view; bring it up so the
    // tap visibly did something.
    if (next !== null && window.matchMedia('(max-width: 960px)').matches) {
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    }
  }

  useEffect(() => {
    setLoadFailed(false);
    api
      .get<{ tables: Table[] }>('/tables')
      .then((r) => setTables(r.tables.map((tb) => ({ tableId: tb.id, label: tb.label, capacity: tb.capacity }))))
      .catch(() => setLoadFailed(true));
  }, [retry]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(serviceNow()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const isToday = clock.date === date;
  const isPast = date < clock.date;

  function phaseOf(b: StaffBooking): Phase {
    if (isPast) return 'earlier';
    if (!isToday) return 'upcoming';
    const start = slotMinutes(b.timeSlot);
    const end = start + (b.durationMin ?? FLOOR_SESSION_MIN);
    if (clock.minutes >= end) return 'earlier';
    if (clock.minutes >= start) return 'now';
    return 'upcoming';
  }

  function endOf(b: StaffBooking) {
    return minutesLabel(slotMinutes(b.timeSlot) + (b.durationMin ?? FLOOR_SESSION_MIN));
  }

  const byTable = new Map<number, StaffBooking[]>();
  for (const b of bookings) {
    const list = byTable.get(b.tableId) ?? [];
    list.push(b);
    byTable.set(b.tableId, list);
  }
  for (const list of byTable.values()) {
    list.sort((a, b) => slotMinutes(a.timeSlot) - slotMinutes(b.timeSlot));
  }

  const selected = tables.find((tb) => tb.tableId === selectedId) ?? null;
  const selectedBookings = selected ? byTable.get(selected.tableId) ?? [] : [];
  const phases: Phase[] = ['now', 'upcoming', 'earlier'];

  return (
    <div className="floor-booking-layout staff-floor">
      <div className="cafe-map-shell">
        <div className="map-heading">
          <div>
            <span className="map-title">{t('bk.floorPlan')}</span>
            <span className="map-hint">{t('staff.floorHint')}</span>
          </div>
          <span className="map-live-badge">
            <i aria-hidden="true" /> {isToday ? t('staff.floorLive') : date}
          </span>
        </div>

        <CafeFloorPlan
          tables={tables}
          selectedId={selectedId}
          onSelect={pick}
          loading={tables.length === 0 && !loadFailed}
          loadError={loadFailed}
          onRetry={() => setRetry((n) => n + 1)}
          decorate={(tb) => {
            const list = byTable.get(tb.tableId) ?? [];
            const live = list.find((b) => phaseOf(b) === 'now');
            const next = list.find((b) => phaseOf(b) === 'upcoming');
            const className = live ? 'live' : list.length ? 'booked' : '';
            const summary = live
              ? t('staff.seatedUntil', { name: live.guestName, time: endOf(live) })
              : next
                ? t('staff.nextAt', { time: next.timeSlot, name: next.guestName })
                : list.length
                  ? t('staff.allDone')
                  : t('staff.freeAllDay');
            return {
              className,
              accent: live ? '#f47700' : list.length ? '#1177ee' : '#2d7055',
              ariaLabel: `${tb.label}: ${t('staff.bookingsCount', { n: list.length })}. ${summary}`,
              badge: list.length ? <b className="table-count">{list.length}</b> : undefined,
              tooltip: (
                <>
                  <strong>{tb.label}</strong>
                  <small>{t('staff.bookingsCount', { n: list.length })}</small>
                  <em>{summary}</em>
                </>
              ),
            };
          }}
        />

        <div className="floor-legend" aria-label={t('bk.legend')}>
          <span><i className="available" />{t('staff.legendFree')}</span>
          <span><i className="booked" />{t('staff.legendBooked')}</span>
          <span><i className="live" />{t('staff.legendLive')}</span>
        </div>
      </div>

      <aside
        ref={panelRef}
        className={`booking-slot-panel ${selected ? 'has-table' : ''}`}
        aria-live="polite"
      >
        {selected ? (
          <>
            <div className="slot-panel-head">
              <span className="slot-panel-kicker">{t('bk.table')}</span>
              <h2>{selected.label}</h2>
              <div className="slot-panel-meta">
                <span>♟ {t('bk.seats', { n: selected.capacity })}</span>
                <span className={selectedBookings.length ? 'open' : 'closed'}>
                  <i aria-hidden="true" />
                  {t('staff.bookingsCount', { n: selectedBookings.length })}
                </span>
              </div>
            </div>
            <div className="slot-panel-body table-day">
              {selectedBookings.length === 0 && (
                <p className="muted center">{t('staff.noTableBookings')}</p>
              )}
              {phases.map((phase) => {
                const rows = selectedBookings.filter((b) => phaseOf(b) === phase);
                if (rows.length === 0) return null;
                return (
                  <section key={phase} className={`table-day-group ${phase}`}>
                    <h3>{t(`staff.phase.${phase}`)}</h3>
                    {rows.map((b) => (
                      <div key={b.id} className="table-day-row">
                        <div className="table-day-time">
                          <strong>{b.timeSlot}</strong>
                          <small>→ {endOf(b)}</small>
                        </div>
                        <div className="table-day-who">
                          <strong>{b.guestName}</strong>
                          <small>
                            {b.partySize ? `${t('bk.seats', { n: b.partySize })} · ` : ''}
                            <code>{b.verificationCode}</code>
                          </small>
                        </div>
                        <div className="table-day-state">
                          <span className={`status ${b.status}`}>{t(`status.${b.status}`)}</span>
                          {b.status === 'pending' && (
                            <button className="link" onClick={() => onAct(`/staff/bookings/${b.id}/confirm`)}>
                              {t('staff.confirmBtn')}
                            </button>
                          )}
                          {b.status === 'arrived' && (
                            <button className="link" onClick={() => onAct(`/staff/bookings/${b.id}/complete`)}>
                              {t('staff.completeBtn')}
                            </button>
                          )}
                          {(b.status === 'arrived' || b.status === 'order_complete') && (
                            <button className="link" onClick={() => onPrint(b)}>
                              {t('staff.printBtn')}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </section>
                );
              })}
            </div>
          </>
        ) : (
          <div className="slot-panel-empty">
            <span className="empty-map-pin" aria-hidden="true">⌖</span>
            <h2>{t('staff.pickTable')}</h2>
            <p>{t('staff.pickTableSub')}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

// Printable receipt. Hidden on screen, sole visible element when printing
// (see .receipt-sheet in styles.css) so the browser lays it out on its own page.
function Receipt({ booking, date }: { booking: StaffBooking; date: string }) {
  const { t, money } = useI18n();
  const row = (label: string, value: string) => (
    <div className="receipt-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
  return createPortal(
    <div className="receipt-sheet">
      <h1>🎲 Cozy Den</h1>
      <h2>{t('receipt.title')}</h2>
      <div className="receipt-code">{booking.verificationCode}</div>
      {row(t('receipt.guest'), booking.guestName)}
      {row(t('receipt.contact'), booking.guestContact)}
      {row(t('receipt.table'), booking.tableLabel)}
      {row(t('receipt.date'), date)}
      {row(t('receipt.time'), booking.timeSlot)}
      {booking.durationMin ? row(t('receipt.length'), `${booking.durationMin / 60}h`) : null}
      {booking.partySize ? row(t('receipt.party'), String(booking.partySize)) : null}
      <hr />
      {row(t('receipt.fee'), money(booking.totalCents))}
      <div className="receipt-row total">
        <span>{t('receipt.total')}</span>
        <strong>{money(booking.totalCents)}</strong>
      </div>
      <p className="receipt-thanks">{t('receipt.thanks')}</p>
    </div>,
    document.body,
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
        <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>{t('bk.name')}</th>
              <th>{t('bk.email')}</th>
              <th>{t('auth.phone')}</th>
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
                <td>
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="card-link" dir="ltr">
                      {c.phone}
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{c.visits}</td>
                <td>{money(c.totalCents)}</td>
                <td>{c.lastVisit ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
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

// Staff access is a column on users, granted here rather than by editing an env
// var and redeploying. Grants target existing accounts only.
function TeamTab({ meEmail }: { meEmail: string }) {
  const { t } = useI18n();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ team: TeamMember[] }>('/staff/team')
      .then((r) => setTeam(r.team))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function grant(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/staff/team', { email: email.trim() });
      setEmail('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  // Admin is the top rung: only an admin can move anyone on or off it.
  async function setAdmin(m: TeamMember, makeAdmin: boolean) {
    if (!window.confirm(t(makeAdmin ? 'team.confirmAdmin' : 'team.confirmUnadmin', { email: m.email })))
      return;
    setError(null);
    try {
      if (makeAdmin) await api.post(`/staff/team/${m.id}/admin`);
      else await api.del(`/staff/team/${m.id}/admin`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    }
  }

  async function revoke(m: TeamMember) {
    if (!window.confirm(t('team.confirmRevoke', { email: m.email }))) return;
    setError(null);
    try {
      await api.del(`/staff/team/${m.id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    }
  }

  return (
    <section>
      <p className="muted">{t('team.hint')}</p>
      <form className="row" onSubmit={grant}>
        <label className="field inline">
          {t('team.email')}
          <input
            type="email"
            required
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          {t('team.grant')}
        </button>
      </form>

      {error && <div className="alert error">{error}</div>}

      {team === null ? (
        <p>{t('loading')}</p>
      ) : (
        <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>{t('bk.name')}</th>
              <th>{t('bk.email')}</th>
              <th>{t('team.role')}</th>
              <th>{t('team.since')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.email}</td>
                <td>
                  <span className="pill">{t(m.isAdmin ? 'team.admin' : 'team.staff')}</span>
                </td>
                <td>{m.createdAt.slice(0, 10)}</td>
                <td>
                  {m.email === meEmail ? (
                    <span className="muted">{t('team.you')}</span>
                  ) : (
                    <>
                      <button className="link" onClick={() => setAdmin(m, !m.isAdmin)}>
                        {t(m.isAdmin ? 'team.makeStaff' : 'team.makeAdmin')}
                      </button>{' '}
                      <button className="link" onClick={() => revoke(m)}>
                        {t('team.revoke')}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}
