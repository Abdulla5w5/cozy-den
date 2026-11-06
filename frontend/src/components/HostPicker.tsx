import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { checkoutToken } from '../checkoutToken';

/**
 * "Add a private game host" on the booking page (migrations 049, 051). The
 * customer picks an option, not a person: a normal host or a Blood on the
 * Clocktower host, each one price per hour for the whole table. Only options
 * with a host free for the whole sitting are offered. Hosts need 24 hours'
 * notice and do not do late seatings, so inside that the picker just says so.
 * The server checks all of it again at checkout; this is the preview.
 */
export type HostKind = 'normal' | 'clocktower';

export interface HostChoice {
  kind: HostKind;
  hourlyCents: number;
}

const NOTICE_MS = 24 * 60 * 60 * 1000;

/** When a slot starts, in Kuwait time: before 14:00 is the next morning. */
function startsAt(date: string, slot: string): number {
  const [h, m] = slot.split(':').map(Number);
  const minutes = h * 60 + m + (h < 14 ? 24 * 60 : 0);
  return Date.parse(`${date}T00:00:00+03:00`) + minutes * 60_000;
}

export function hostFee(hourlyCents: number, durationMin: number): number {
  return Math.round((hourlyCents * durationMin) / 60);
}

export function HostPicker({
  date,
  timeSlot,
  durationMin,
  late,
  selected,
  onSelect,
}: {
  date: string;
  timeSlot: string;
  durationMin: number;
  late: boolean;
  selected: HostChoice | null;
  onSelect: (h: HostChoice | null) => void;
}) {
  const { t, money } = useI18n();
  const [options, setOptions] = useState<HostChoice[] | null>(null);
  const tooSoon = startsAt(date, timeSlot) - Date.now() < NOTICE_MS;

  useEffect(() => {
    if (late || tooSoon) {
      setOptions([]);
      return;
    }
    let active = true;
    setOptions(null);
    api
      .get<{ options: HostChoice[] }>(
        `/hosts/available?date=${date}&timeSlot=${encodeURIComponent(timeSlot)}` +
          `&durationMin=${durationMin}&retry=${checkoutToken()}`,
      )
      .then((r) => active && setOptions(r.options))
      .catch(() => active && setOptions([]));
    return () => {
      active = false;
    };
  }, [date, timeSlot, durationMin, late, tooSoon]);

  // An option chosen for another time may have no host free at this one.
  useEffect(() => {
    if (selected && options && !options.some((o) => o.kind === selected.kind)) onSelect(null);
  }, [options, selected, onSelect]);

  if (late) return null;

  return (
    <div className="host-picker">
      <div className="host-picker-head">
        <strong>{t('host.add')}</strong>
        <span>{t('host.addSub')}</span>
      </div>
      {tooSoon ? (
        <p className="sitting-note">{t('host.notice')}</p>
      ) : options === null ? (
        <p className="sitting-note">{t('loading')}</p>
      ) : options.length === 0 ? (
        <p className="sitting-note">{t('host.noneFree')}</p>
      ) : (
        <div className="host-cards" role="radiogroup" aria-label={t('host.add')}>
          <button
            type="button"
            role="radio"
            aria-checked={selected === null}
            className={`host-card none ${selected === null ? 'active' : ''}`}
            onClick={() => onSelect(null)}
          >
            <strong>{t('host.noHost')}</strong>
          </button>
          {options.map((o) => (
            <button
              type="button"
              role="radio"
              aria-checked={selected?.kind === o.kind}
              key={o.kind}
              className={`host-card ${selected?.kind === o.kind ? 'active' : ''}`}
              onClick={() => onSelect(o)}
            >
              <span className={`host-initial ${o.kind}`} aria-hidden="true">
                {o.kind === 'clocktower' ? '🕰️' : '🎲'}
              </span>
              <span className="host-card-text">
                <strong>{t(`host.kind.${o.kind}`)}</strong>
                <small>
                  {t('host.rate', { amount: money(o.hourlyCents) })} ·{' '}
                  {t('host.forSession', { amount: money(hostFee(o.hourlyCents, durationMin)) })}
                </small>
                <span className="host-bio">{t('host.wholeTable')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
