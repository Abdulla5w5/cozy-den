import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Booking, money } from '../types';

export function Confirmation() {
  const { code } = useParams<{ code: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    api
      .get<{ booking: Booking }>(`/bookings/${code}`)
      .then((r) => setBooking(r.booking))
      .catch((e) => setError(e.message));
  }, [code]);

  if (error) return <div className="alert error">{error}</div>;
  if (!booking) return <p>Loading…</p>;

  return (
    <div className="card confirmation">
      <div className="check">✅</div>
      <h2>Booking confirmed!</h2>
      <p>A receipt has been emailed to {booking.guestEmail} (stubbed in this prototype).</p>

      <div className="code-box">
        <span>Show this code at the counter</span>
        <strong>{booking.verificationCode}</strong>
      </div>

      <div className="summary">
        <p>
          <strong>{booking.tableLabel}</strong> · {booking.date} · {booking.timeSlot} (2-hour
          seating)
        </p>
        <p>Game: {booking.gameTitle ?? 'None selected'}</p>
        <ul>
          {booking.items.map((i) => (
            <li key={i.menuItemId}>
              {i.quantity} × {i.name} — {money(i.lineTotalCents)}
            </li>
          ))}
          <li>Table reservation fee — {money(booking.tableFeeCents)}</li>
        </ul>
        <p className="total">Total paid: {money(booking.totalCents)}</p>
      </div>

      <Link to="/" className="primary button">
        Make another booking
      </Link>
    </div>
  );
}
