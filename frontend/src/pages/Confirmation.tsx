import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { Booking } from '../types';

export function Confirmation() {
  const { code } = useParams<{ code: string }>();
  const { t, money } = useI18n();
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
  if (!booking) return <p>{t('loading')}</p>;

  return (
    <div className="card confirmation">
      <div className="check">✅</div>
      <h2>{t('conf.title')}</h2>
      <p>{t('conf.emailed', { email: booking.guestEmail })}</p>

      <div className="code-box">
        <span>{t('conf.show')}</span>
        <strong>{booking.verificationCode}</strong>
      </div>

      <div className="summary">
        <p>
          <strong>{booking.tableLabel}</strong> · {booking.date} · {booking.timeSlot}{' '}
          {t('bk.seating')}
        </p>
        <p>
          {t('conf.game')} {booking.gameTitle ?? t('conf.noneSel')}
        </p>
        <ul>
          {booking.items.map((i) => (
            <li key={i.menuItemId}>
              {i.quantity} × {i.name} — {money(i.lineTotalCents)}
            </li>
          ))}
          <li>
            {t('bk.tableFee')} — {money(booking.tableFeeCents)}
          </li>
        </ul>
        <p className="total">
          {t('conf.totalPaid')} {money(booking.totalCents)}
        </p>
      </div>

      <Link to="/" className="cta button">
        {t('conf.another')}
      </Link>
    </div>
  );
}
