import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { COMMUNITY_URL } from '../community';
import { useI18n } from '../i18n';
import { Booking, formatHours } from '../types';
import { QrPass } from '../components/QrPass';

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
      <p>
        {booking.guestEmail
          ? t('conf.emailed', { email: booking.guestEmail })
          : t('conf.phone', { phone: booking.guestPhone ?? '' })}
      </p>

      {booking.checkinToken && ['pending', 'arrived'].includes(booking.status) && (
        <QrPass
          token={booking.checkinToken}
          lines={[
            `${booking.tableLabel} · ${booking.date}`,
            `${booking.timeSlot} · ${booking.partySize} ${booking.partySize === 1 ? 'person' : 'people'}`,
          ]}
        />
      )}

      {/* The typed code stays as the backup for a camera that cannot read a
          screen. */}
      <div className="code-box">
        <span>{t('conf.show')}</span>
        <strong>{booking.verificationCode}</strong>
      </div>

      <div className="summary">
        <p>
          <strong>{booking.tableLabel}</strong> · {booking.date} · {booking.timeSlot}{' '}
          ({t('bk.sessionHours', { n: formatHours(booking.durationMin) })})
        </p>
        <ul>
          {/* The stored fee includes a host's; shown apart so each line is
              what it says. */}
          <li>
            {t('bk.tableFee')} — {money(booking.tableFeeCents - (booking.hostFeeCents ?? 0))}
          </li>
          {booking.hostKind && (
            <li>
              {t(`host.kind.${booking.hostKind}`)} —{' '}
              {money(booking.hostFeeCents ?? 0)}
            </li>
          )}
        </ul>
        <p className="total">
          {t('conf.totalPaid')} {money(booking.totalCents)}
        </p>
      </div>

      <div className="conf-actions">
        <Link to="/" className="cta button">
          {t('conf.another')}
        </Link>
        <a className="ghost button" href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer">
          {t('home.community')} <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  );
}
