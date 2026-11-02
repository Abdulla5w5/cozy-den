import { useI18n } from '../i18n';
import { EventItem } from '../types';

/**
 * Pieces shared by the home page's events and Our Calendar, so both read as
 * the same game ticket: a tilted date tile like a game piece, chunky card,
 * and a perforated stub with the seats meter and price.
 */

/** The date as a tilted game tile — orange for ours, blue for off-site. */
export function DateTile({ e }: { e: EventItem }) {
  const { lang } = useI18n();
  const d = new Date(e.event_date + 'T00:00:00');
  const locale = lang === 'ar' ? 'ar' : 'en-GB';
  return (
    <div className={`ev-tile ${e.type}`} aria-hidden="true">
      <span className="ev-tile-day">{d.toLocaleDateString(locale, { weekday: 'short' })}</span>
      <strong>{d.getDate()}</strong>
      <span className="ev-tile-month">{d.toLocaleDateString(locale, { month: 'short' })}</span>
    </div>
  );
}

/** Where and when, as small tokens. */
export function EventTokens({ e }: { e: EventItem }) {
  const time = e.start_time ?? e.event_time;
  return (
    <div className="ev-tokens">
      {time && <span className="ev-token">🕒 {time}</span>}
      {e.table_label && <span className="ev-token">🎲 {e.table_label}</span>}
      {e.location && <span className="ev-token">📍 {e.location}</span>}
    </div>
  );
}

/** Seats left as a fill meter, plus the price sticker. */
export function SeatsMeter({ e }: { e: EventItem }) {
  const { t, money } = useI18n();
  const left = e.capacity === null ? null : Math.max(0, e.capacity - (e.seats_taken ?? 0));
  const full = left === 0;
  const filled = e.capacity ? Math.min(100, ((e.seats_taken ?? 0) / e.capacity) * 100) : 0;
  return (
    <div className="ev-seatbox">
      <div className="ev-seat-label">
        <span className={full ? 'ev-full' : 'ev-open'}>
          {left === null ? t('ev.openSeating') : full ? t('ev.soldOut') : t('ev.seatsLeft', { n: left })}
        </span>
        {e.capacity !== null && (
          <span className="ev-meter" aria-hidden="true">
            <i style={{ width: `${filled}%` }} />
          </span>
        )}
      </div>
      <span className="ev-price-tag">
        {e.seat_price_cents > 0 ? money(e.seat_price_cents) : t('ev.freeSeat')}
      </span>
    </div>
  );
}

export function EventTag({ e }: { e: EventItem }) {
  const { t } = useI18n();
  return (
    <span className={`ev-tag ${e.type}`}>
      {e.type === 'internal' ? t('ev.internal') : t('ev.external')}
    </span>
  );
}
