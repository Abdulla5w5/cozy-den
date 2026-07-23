import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { Booking } from '../types';

export function MyBookings() {
  const navigate = useNavigate();
  const { t, money } = useI18n();
  const [bookings, setBookings] = useState<Booking[] | null>(null);

  useEffect(() => {
    api
      .get<{ bookings: Booking[] }>('/auth/bookings')
      .then((r) => setBookings(r.bookings))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) navigate('/register');
        else setBookings([]);
      });
  }, [navigate]);

  return (
    <div>
      <header className="page-header left">
        <span className="eyebrow">{t('nav.mybookings')}</span>
        <h1>{t('acct.title')}</h1>
        <p className="muted">{t('acct.sub')}</p>
      </header>

      {bookings === null ? (
        <p>{t('loading')}</p>
      ) : bookings.length === 0 ? (
        <div className="card">
          <p className="muted">{t('acct.empty')}</p>
          <Link to="/book" className="cta button" style={{ marginTop: '1rem' }}>
            {t('home.book')}
          </Link>
        </div>
      ) : (
        <div className="feature-grid">
          {bookings.map((b) => (
            <div className="feature-card" key={b.id}>
              <div className="mcard-top">
                <span className={`status ${b.status}`}>{t(`status.${b.status}`)}</span>
                <span className="price">{money(b.totalCents)}</span>
              </div>
              <h3>{b.tableLabel}</h3>
              <p className="muted">
                {b.date} · {b.timeSlot} {t('bk.seating')}
              </p>
              {b.items.length > 0 && (
                <p className="muted">
                  {b.items.map((i) => `${i.quantity}×${i.name}`).join(', ')}
                </p>
              )}
              <span className="tag">{b.verificationCode}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
