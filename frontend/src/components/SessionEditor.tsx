import { FormEvent, useState } from 'react';
import { api } from '../api/client';
import { formatDay } from '../formatDay';
import { useI18n } from '../i18n';
import { SESSION_LENGTHS, startsFor } from '../sessionTimes';

/** The service night running now in Kuwait (it rolls over at 14:00). */
const tonight = () => new Date(Date.now() + (3 - 14) * 3600_000).toISOString().slice(0, 10);

export interface EditableSession {
  id: number;
  gameTitle: string;
  sessionDate: string | null;
  startTime: string | null;
  durationMin?: number;
  minPlayers: number;
  maxPlayers: number;
  seatsTaken?: number;
}

/** "Sat, 28 Nov 2026 00:30 (after midnight)": the night, as the date field
 *  and the card show it to staff. */
function useWhen() {
  const { t, lang } = useI18n();
  return (night: string | null, start: string | null) =>
    night
      ? `${formatDay(night, lang)}${start ? ` \u2066${start}\u2069` : ''}${
          start && Number(start.slice(0, 2)) < 14 ? ` (${t('wb.afterMidnight')})` : ''
        }`
      : t('wb.timeToArrange');
}

/**
 * Staff: move a Wanted Board session, or change its player counts. Moving it
 * tells everyone in it, so that is confirmed first. The server checks it all
 * again, and refuses if someone else changed the session meanwhile.
 */
export function EditSession({
  session,
  busy,
  setBusy,
  onClose,
  onDone,
}: {
  session: EditableSession;
  /** Held by the page, so nothing else can be started meanwhile. */
  busy: boolean;
  setBusy: (b: boolean) => void;
  onClose: () => void;
  /** Saved. The message is for the card. */
  onDone: (message: string) => void;
}) {
  const { t } = useI18n();
  const lengthText = (m: number) => (m === 120 ? t('wb.lengthTwo') : t('wb.length', { n: m / 60 }));
  const when = useWhen();
  // What staff were shown when they opened this, whatever the list does since.
  const [was] = useState({
    sessionDate: session.sessionDate ?? '',
    startTime: session.startTime,
    durationMin: session.durationMin ?? 120,
    minPlayers: session.minPlayers,
    maxPlayers: session.maxPlayers,
  });
  const [date, setDate] = useState(was.sessionDate);
  const [time, setTime] = useState(was.startTime ?? '');
  const [length, setLength] = useState(was.durationMin);
  const [min, setMin] = useState(was.minPlayers);
  const [max, setMax] = useState(was.maxPlayers);
  const [error, setError] = useState<string | null>(null);

  const taken = session.seatsTaken ?? 0;
  const starts = startsFor(date, length, 1);
  const start = starts.includes(time) ? time : '';
  const moved = date !== was.sessionDate || start !== was.startTime || length !== was.durationMin;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!date) return setError(t('wb.dateRequired'));
    if (!start) return setError(t('wb.startRequired'));
    if (max < min) return setError(t('wb.rangeBad'));
    // Only when lowered: a late payment can leave more seats taken than the maximum.
    if (max < taken && max < was.maxPlayers) return setError(t('staff.wbMaxTaken', { n: taken }));
    if (
      moved &&
      !window.confirm(
        t('staff.wbMoveConfirm', {
          game: session.gameTitle,
          from: `${when(was.sessionDate, was.startTime)} (${lengthText(was.durationMin)})`,
          to: `${when(date, start)} (${lengthText(length)})`,
        }),
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await api.put<{ moved: boolean }>(`/staff/wanted/${session.id}`, {
        sessionDate: date,
        startTime: start,
        durationMin: length,
        minPlayers: min,
        maxPlayers: max,
        expected: was,
      });
      onDone(t(r.moved ? 'staff.wbMoved' : 'staff.wbSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('staff.wbActionFailed'));
      setBusy(false);
    }
  }

  return (
    <form className="session-editor" onSubmit={save}>
      <label className="field">
        {t('wb.date')}
        <input type="date" min={tonight()} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        {t('wb.startTime')}
        <select value={start} onChange={(e) => setTime(e.target.value)}>
          <option value="">{t('wb.pickTime')}</option>
          {starts.map((s) => (
            <option key={s} value={s}>
              {Number(s.slice(0, 2)) < 14 ? `${s} (${t('wb.afterMidnight')})` : s}
            </option>
          ))}
        </select>
      </label>
      {date && starts.length === 0 && <p className="wb-error">{t('staff.wbNoTimes')}</p>}
      <label className="field">
        {t('wb.sessionLength')}
        <select value={length} disabled={taken > 0} onChange={(e) => setLength(Number(e.target.value))}>
          {SESSION_LENGTHS.map((m) => (
            <option key={m} value={m}>
              {lengthText(m)}
            </option>
          ))}
        </select>
      </label>
      <div className="session-editor-pair">
        <label className="field">
          {t('wb.min')}
          <input type="number" min={1} max={50} value={min} onChange={(e) => setMin(Number(e.target.value))} />
        </label>
        <label className="field">
          {t('wb.max')}
          <input
            type="number"
            min={Math.min(Math.max(1, taken), was.maxPlayers)}
            max={50}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
          />
        </label>
      </div>
      <p className="muted">{t(taken > 0 ? 'staff.wbEditPaid' : 'staff.wbEditHint')}</p>
      {error && (
        <p className="wb-error" role="alert">
          {error}
        </p>
      )}
      <div className="host-actions">
        <button className="primary" disabled={busy}>
          {busy ? t('staff.wbWorking') : t('staff.changeSave')}
        </button>
        <button type="button" className="link" disabled={busy} onClick={onClose}>
          {t('staff.wbBack')}
        </button>
      </div>
    </form>
  );
}

/** Staff: cancel a session, with an optional message to the players. */
export function CancelSession({
  session,
  owed,
  busy,
  setBusy,
  onClose,
  onDone,
}: {
  session: EditableSession;
  /** "2 payments, KD 14.00" to refund by hand, or null. */
  owed: string | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const when = useWhen();
  const [note, setNote] = useState('');
  // What staff were shown: a session moved meanwhile is not cancelled unseen.
  const [was] = useState({ sessionDate: session.sessionDate ?? '', startTime: session.startTime });
  const [error, setError] = useState<string | null>(null);

  async function go(e: FormEvent) {
    e.preventDefault();
    const ask = [
      t('staff.wbCancelConfirm', {
        game: session.gameTitle,
        when: when(was.sessionDate, was.startTime),
      }),
      ...(owed ? [t('staff.wbCancelOwed', { owed })] : []),
    ].join('\n\n');
    if (!window.confirm(ask)) return;
    setError(null);
    setBusy(true);
    try {
      await api.post(`/staff/wanted/${session.id}/cancel`, { note: note.trim(), expected: was });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('staff.wbActionFailed'));
      setBusy(false);
    }
  }

  return (
    <form className="session-editor" onSubmit={go}>
      <label className="field">
        {t('staff.wbCancelNote')}
        <textarea value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="muted">{t(owed ? 'staff.wbCancelHint' : 'staff.wbCancelHintFree')}</p>
      {error && (
        <p className="wb-error" role="alert">
          {error}
        </p>
      )}
      <div className="host-actions">
        <button className="primary" disabled={busy}>
          {busy ? t('staff.wbWorking') : t('staff.wbCancelGo')}
        </button>
        <button type="button" className="link" disabled={busy} onClick={onClose}>
          {t('staff.wbBack')}
        </button>
      </div>
    </form>
  );
}
