import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { QrPass } from '../components/QrPass';
import { formatHours } from '../types';

/**
 * What a scanned QR pass opens (/c/<key>, migration 050).
 *
 * Staff signed in on this phone see the whole booking and a big Check in
 * button. Anyone else — the customer, or whoever finds a screenshot — sees
 * only the basics and the pass itself, with no name, phone or price, and can
 * change nothing. Staff who are not signed in are pointed to sign in, and come
 * straight back here afterwards.
 */
interface Pass {
  kind: 'table' | 'event' | 'wanted';
  title: string;
  date: string;
  timeSlot: string | null;
  durationMin: number | null;
  people: number;
  paid: boolean;
  checkedIn: boolean;
  // Staff only:
  isTonight?: boolean;
  payAtCounter?: boolean;
  counterCents?: number;
  guestName?: string;
  guestPhone?: string | null;
  guestEmail?: string | null;
  code?: string | null;
  totalCents?: number;
  hostName?: string | null;
  checkedInAt?: string | null;
}

export function CheckIn() {
  const { token = '' } = useParams();
  const { t, money, lang } = useI18n();
  const [pass, setPass] = useState<Pass | null>(null);
  const [staff, setStaff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justChecked, setJustChecked] = useState(false);

  useEffect(() => {
    api
      .get<{ pass: Pass; staff: boolean }>(`/checkin/${encodeURIComponent(token)}`)
      .then((r) => {
        setPass(r.pass);
        setStaff(r.staff);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t('ci.invalid')));
  }, [token, t]);

  async function checkIn() {
    // There is no undo, and a pass for another night would then read as
    // already used on the real one.
    const otherNight = pass?.isTonight === false;
    if (otherNight && !window.confirm(t('ci.otherNightConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ pass: Pass }>(`/checkin/${encodeURIComponent(token)}`, {
        confirmOtherNight: otherNight,
      });
      setPass(r.pass);
      setJustChecked(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('bk.wrong'));
      // The page may be stale (left open past closing, say): refresh the pass
      // so the warning and button match what the server now says.
      if (e instanceof ApiError && e.status === 409) {
        api
          .get<{ pass: Pass; staff: boolean }>(`/checkin/${encodeURIComponent(token)}`)
          .then((r) => setPass(r.pass))
          .catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }

  const day = (iso: string) =>
    iso
      ? new Date(`${iso}T00:00:00`).toLocaleDateString(lang === 'ar' ? 'ar' : 'en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })
      : '';
  const time = (p: Pass) => {
    if (!p.timeSlot) return p.durationMin ? `${formatHours(p.durationMin)} h` : '';
    // An event's time can be free text ("7 PM"), with no end to work out.
    if (!p.durationMin || !/^\d{2}:\d{2}$/.test(p.timeSlot)) return p.timeSlot;
    const [h, m] = p.timeSlot.split(':').map(Number);
    const end = (h * 60 + m + p.durationMin) % (24 * 60);
    return `${p.timeSlot}–${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  };
  const checkedAt = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleTimeString(lang === 'ar' ? 'ar' : 'en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Kuwait',
        })
      : '';

  if (error && !pass) {
    return (
      <div className="checkin-page">
        <div className="checkin-card bad">
          <strong>{t('ci.invalidTitle')}</strong>
          <p>{error}</p>
        </div>
      </div>
    );
  }
  if (!pass) return <p>{t('loading')}</p>;

  const kindLabel = t(`ci.kind.${pass.kind}`);

  return (
    <div className="checkin-page">
      <div className={`checkin-card ${pass.checkedIn ? 'done' : 'ready'}`}>
        <span className="checkin-kind">{kindLabel}</span>
        <h1>{pass.title}</h1>
        <p className="checkin-when">
          {day(pass.date)}
          {time(pass) && <> · <span dir="ltr">{time(pass)}</span></>}
        </p>
        <ul className="checkin-facts">
          <li>{t('bk.people', { n: pass.people })}</li>
          {pass.paid && <li>{t('ci.paid')}</li>}
          {staff && pass.payAtCounter && <li className="warn">{t('ci.payAtCounter')}</li>}
          {staff && pass.hostName && <li>{t('host.onBooking', { name: pass.hostName })}</li>}
        </ul>

        {staff && !pass.checkedIn && pass.isTonight === false && (
          <p className="checkin-warning" role="alert">
            {t('ci.otherNight', { date: day(pass.date) })}
          </p>
        )}

        {pass.checkedIn ? (
          <div className="checkin-status done" role="status">
            <span aria-hidden="true">✓</span>
            {justChecked
              ? t('ci.nowIn')
              : staff && pass.checkedInAt
                ? t('ci.alreadyAt', { time: checkedAt(pass.checkedInAt) })
                : t('ci.already')}
          </div>
        ) : staff ? (
          <button
            type="button"
            className={`checkin-button ${pass.isTonight === false ? 'other-night' : ''}`}
            onClick={checkIn}
            disabled={busy}
          >
            {busy
              ? t('bk.processing')
              : pass.isTonight === false
                ? t('ci.checkInAnyway')
                : t('ci.checkIn')}
          </button>
        ) : null}

        {staff && (
          <dl className="checkin-details">
            <dt>{t('ci.name')}</dt>
            <dd>{pass.guestName}</dd>
            {pass.guestPhone && (
              <>
                <dt>{t('bk.phone')}</dt>
                <dd>
                  <a href={`tel:${pass.guestPhone}`} dir="ltr">
                    {pass.guestPhone}
                  </a>
                </dd>
              </>
            )}
            {pass.code && (
              <>
                <dt>{t('ci.code')}</dt>
                <dd dir="ltr">{pass.code}</dd>
              </>
            )}
            {!pass.payAtCounter && (
              <>
                <dt>{t('ci.amount')}</dt>
                <dd>{money((pass.totalCents ?? 0) + (pass.counterCents ?? 0))}</dd>
              </>
            )}
            {!!pass.counterCents && (
              <>
                <dt>{t('ci.byHand')}</dt>
                <dd>{money(pass.counterCents)}</dd>
              </>
            )}
          </dl>
        )}
        {error && <p className="checkin-error">{error}</p>}
      </div>

      {!staff && (
        <>
          <QrPass token={token} lines={[pass.title, `${pass.date} ${pass.timeSlot ?? ''}`.trim()]} />
          <p className="checkin-staff-note">
            {t('ci.staffNote')}{' '}
            <Link to={`/register?next=${encodeURIComponent(`/c/${token}`)}`}>{t('ci.staffSignIn')}</Link>
          </p>
        </>
      )}
    </div>
  );
}
