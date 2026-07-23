import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { Booking, Game, MenuItem, TableAvailability } from '../types';

type Step = 1 | 2 | 3 | 4;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function BookingFlow() {
  const navigate = useNavigate();
  const { t, money } = useI18n();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(todayIso());
  const [availability, setAvailability] = useState<TableAvailability[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [tableId, setTableId] = useState<number | null>(null);
  const [timeSlot, setTimeSlot] = useState<string | null>(null);

  const [games, setGames] = useState<Game[]>([]);
  const [gameId, setGameId] = useState<number | null>(null);

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<Record<number, number>>({});

  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [paymentToken, setPaymentToken] = useState('tok_demo');
  const [submitting, setSubmitting] = useState(false);

  const TABLE_FEE_CENTS = 500;

  useEffect(() => {
    setError(null);
    setTableId(null);
    setTimeSlot(null);
    api
      .get<{ slots: string[]; availability: TableAvailability[] }>(
        `/tables/availability?date=${date}`
      )
      .then((r) => {
        setSlots(r.slots);
        setAvailability(r.availability);
      })
      .catch((e) => setError(e.message));
  }, [date]);

  useEffect(() => {
    api.get<{ games: Game[] }>('/games').then((r) => setGames(r.games)).catch(() => {});
    api.get<{ items: MenuItem[] }>('/menu').then((r) => setMenu(r.items)).catch(() => {});
    // Prefill from the signed-in account so bookings link to their history.
    api
      .get<{ user: { name: string; email: string } }>('/auth/me')
      .then((r) => {
        setGuestName(r.user.name);
        setGuestEmail(r.user.email);
      })
      .catch(() => {});
  }, []);

  const selectedTable = availability.find((tb) => tb.tableId === tableId) || null;

  const itemsTotal = useMemo(
    () =>
      Object.entries(cart).reduce((sum, [id, qty]) => {
        const item = menu.find((m) => m.id === Number(id));
        return sum + (item ? item.price_cents * qty : 0);
      }, 0),
    [cart, menu]
  );
  const grandTotal = itemsTotal + TABLE_FEE_CENTS;

  function setQty(id: number, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const items = Object.entries(cart).map(([id, qty]) => ({
        menuItemId: Number(id),
        quantity: qty,
      }));
      const { booking } = await api.post<{ booking: Booking }>('/bookings', {
        tableId,
        gameId,
        date,
        timeSlot,
        guestName,
        guestEmail,
        items,
        paymentToken,
      });
      navigate(`/confirmation/${booking.verificationCode}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('bk.wrong'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <Stepper step={step} />
      {error && <div className="alert error">{error}</div>}

      {step === 1 && (
        <section>
          <h2>{t('bk.s1title')}</h2>
          <label className="field">
            {t('bk.date')}
            <input
              type="date"
              min={todayIso()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <div className="table-grid">
            {availability.map((tb) => (
              <div key={tb.tableId} className={`table-card ${tableId === tb.tableId ? 'sel' : ''}`}>
                <div className="table-head">
                  <strong>{tb.label}</strong>
                  <span className="pill">{t('bk.seats', { n: tb.capacity })}</span>
                </div>
                <div className="slots">
                  {slots.map((s) => {
                    const free = tb.freeSlots.includes(s);
                    const active = tableId === tb.tableId && timeSlot === s;
                    return (
                      <button
                        key={s}
                        disabled={!free}
                        className={`slot ${active ? 'active' : ''}`}
                        onClick={() => {
                          setTableId(tb.tableId);
                          setTimeSlot(s);
                        }}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="actions">
            <button className="primary" disabled={!tableId || !timeSlot} onClick={() => setStep(2)}>
              {t('bk.nextGame')}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h2>{t('bk.s2title')}</h2>
          <div className="game-grid">
            <button
              className={`game-card ${gameId === null ? 'sel' : ''}`}
              onClick={() => setGameId(null)}
            >
              <strong>{t('bk.noGame')}</strong>
              <span>{t('bk.justTable')}</span>
            </button>
            {games.map((g) => (
              <button
                key={g.id}
                className={`game-card ${gameId === g.id ? 'sel' : ''}`}
                onClick={() => setGameId(g.id)}
              >
                <strong>{g.title}</strong>
                <span>
                  {g.min_players}–{g.max_players} {t('players')} · {g.category}
                </span>
              </button>
            ))}
          </div>
          <div className="actions">
            <button onClick={() => setStep(1)}>{t('bk.back')}</button>
            <button className="primary" onClick={() => setStep(3)}>
              {t('bk.nextFood')}
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h2>{t('bk.s3title')}</h2>
          <div className="menu-list">
            {menu.map((m) => (
              <div key={m.id} className="menu-row">
                <div>
                  <strong>{m.name}</strong> <span className="pill">{m.category}</span>
                  <div className="muted">{m.description}</div>
                </div>
                <div className="qty">
                  <span className="price">{money(m.price_cents)}</span>
                  <button onClick={() => setQty(m.id, (cart[m.id] || 0) - 1)}>−</button>
                  <span className="qnum">{cart[m.id] || 0}</span>
                  <button onClick={() => setQty(m.id, (cart[m.id] || 0) + 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
          <div className="actions">
            <button onClick={() => setStep(2)}>{t('bk.back')}</button>
            <button className="primary" onClick={() => setStep(4)}>
              {t('bk.nextDetails')}
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section>
          <h2>{t('bk.s4title')}</h2>

          <div className="summary">
            <h3>{t('bk.summary')}</h3>
            <p>
              {selectedTable?.label} · {date} · {timeSlot} {t('bk.seating')}
              <br />
              {t('bk.gameLabel')} {games.find((g) => g.id === gameId)?.title ?? t('bk.none')}
            </p>
            <ul>
              {Object.entries(cart).map(([id, qty]) => {
                const item = menu.find((m) => m.id === Number(id));
                if (!item) return null;
                return (
                  <li key={id}>
                    {qty} × {item.name} — {money(item.price_cents * qty)}
                  </li>
                );
              })}
              <li>
                {t('bk.tableFee')} — {money(TABLE_FEE_CENTS)}
              </li>
            </ul>
            <p className="total">
              {t('bk.total')} {money(grandTotal)}
            </p>
          </div>

          <label className="field">
            {t('bk.name')}
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          </label>
          <label className="field">
            {t('bk.email')}
            <input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
          </label>

          <label className="field">
            {t('bk.payToken')}
            <input value={paymentToken} onChange={(e) => setPaymentToken(e.target.value)} />
          </label>
          <p className="muted">{t('bk.payHint')}</p>

          <div className="actions">
            <button onClick={() => setStep(3)}>{t('bk.back')}</button>
            <button
              className="primary"
              disabled={submitting || !guestName || !guestEmail}
              onClick={submit}
            >
              {submitting ? t('bk.processing') : t('bk.pay', { amount: money(grandTotal) })}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const { t } = useI18n();
  const labels = ['bk.table', 'bk.game', 'bk.menu', 'bk.checkout'];
  return (
    <ol className="stepper">
      {labels.map((l, i) => (
        <li key={l} className={step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}>
          {i + 1}. {t(l)}
        </li>
      ))}
    </ol>
  );
}
