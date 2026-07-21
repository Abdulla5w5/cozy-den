import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Booking, Game, MenuItem, TableAvailability, money } from '../types';

type Step = 1 | 2 | 3 | 4;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function BookingFlow() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — date, table, slot
  const [date, setDate] = useState(todayIso());
  const [availability, setAvailability] = useState<TableAvailability[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [tableId, setTableId] = useState<number | null>(null);
  const [timeSlot, setTimeSlot] = useState<string | null>(null);

  // Step 2 — game
  const [games, setGames] = useState<Game[]>([]);
  const [gameId, setGameId] = useState<number | null>(null);

  // Step 3 — menu + cart
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<Record<number, number>>({});

  // Step 4 — guest + payment
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [paymentToken, setPaymentToken] = useState('tok_demo');
  const [submitting, setSubmitting] = useState(false);

  const TABLE_FEE_CENTS = 500; // display only; server is the source of truth

  // Load availability whenever the date changes.
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

  // Load games + menu once.
  useEffect(() => {
    api.get<{ games: Game[] }>('/games').then((r) => setGames(r.games)).catch(() => {});
    api.get<{ items: MenuItem[] }>('/menu').then((r) => setMenu(r.items)).catch(() => {});
  }, []);

  const selectedTable = availability.find((t) => t.tableId === tableId) || null;

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
      const msg = e instanceof ApiError ? e.message : 'Something went wrong.';
      setError(msg);
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
          <h2>1. Pick a date &amp; table</h2>
          <label className="field">
            Date
            <input
              type="date"
              min={todayIso()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <div className="table-grid">
            {availability.map((t) => (
              <div key={t.tableId} className={`table-card ${tableId === t.tableId ? 'sel' : ''}`}>
                <div className="table-head">
                  <strong>{t.label}</strong>
                  <span className="pill">{t.capacity} seats</span>
                </div>
                <div className="slots">
                  {slots.map((s) => {
                    const free = t.freeSlots.includes(s);
                    const active = tableId === t.tableId && timeSlot === s;
                    return (
                      <button
                        key={s}
                        disabled={!free}
                        className={`slot ${active ? 'active' : ''}`}
                        onClick={() => {
                          setTableId(t.tableId);
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
            <button
              className="primary"
              disabled={!tableId || !timeSlot}
              onClick={() => setStep(2)}
            >
              Next: choose a game
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h2>2. Pick a game (optional)</h2>
          <div className="game-grid">
            <button
              className={`game-card ${gameId === null ? 'sel' : ''}`}
              onClick={() => setGameId(null)}
            >
              <strong>No game</strong>
              <span>Just the table</span>
            </button>
            {games.map((g) => (
              <button
                key={g.id}
                className={`game-card ${gameId === g.id ? 'sel' : ''}`}
                onClick={() => setGameId(g.id)}
              >
                <strong>{g.title}</strong>
                <span>
                  {g.min_players}–{g.max_players} players · {g.category}
                </span>
              </button>
            ))}
          </div>
          <div className="actions">
            <button onClick={() => setStep(1)}>Back</button>
            <button className="primary" onClick={() => setStep(3)}>
              Next: food &amp; drink
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h2>3. Pre-order food &amp; drink (optional)</h2>
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
            <button onClick={() => setStep(2)}>Back</button>
            <button className="primary" onClick={() => setStep(4)}>
              Next: your details
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section>
          <h2>4. Your details &amp; payment</h2>

          <div className="summary">
            <h3>Booking summary</h3>
            <p>
              {selectedTable?.label} · {date} · {timeSlot} (2-hour seating)
              <br />
              Game: {games.find((g) => g.id === gameId)?.title ?? 'None'}
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
              <li>Table reservation fee — {money(TABLE_FEE_CENTS)}</li>
            </ul>
            <p className="total">Total: {money(grandTotal)}</p>
          </div>

          <label className="field">
            Name
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          </label>
          <label className="field">
            Email
            <input
              type="email"
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
            />
          </label>

          <label className="field">
            Payment token (mock)
            <input value={paymentToken} onChange={(e) => setPaymentToken(e.target.value)} />
          </label>
          <p className="muted">
            Payment is stubbed. Use <code>tok_demo</code> to approve, or{' '}
            <code>tok_decline</code> to simulate a declined card.
          </p>

          <div className="actions">
            <button onClick={() => setStep(3)}>Back</button>
            <button
              className="primary"
              disabled={submitting || !guestName || !guestEmail}
              onClick={submit}
            >
              {submitting ? 'Processing…' : `Pay ${money(grandTotal)} & book`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const labels = ['Table', 'Game', 'Menu', 'Checkout'];
  return (
    <ol className="stepper">
      {labels.map((l, i) => (
        <li key={l} className={step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}>
          {i + 1}. {l}
        </li>
      ))}
    </ol>
  );
}
