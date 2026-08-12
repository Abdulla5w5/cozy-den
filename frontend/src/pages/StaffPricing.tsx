import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';

/**
 * Staff price editor.
 *
 * Two base rates, plus a list of dated overrides. An override is simply "on
 * this date, charge this instead" — a national holiday, a quiet-Tuesday
 * discount and an event upcharge are all the same operation, so staff never
 * need a deploy to change a price.
 *
 * Prices are entered in KD and stored in hundredths, since the whole system
 * keeps money as integers to avoid rounding drift.
 */

interface Rates {
  peakCents: number;
  offPeakCents: number;
  latePeakCents: number;
  lateOffPeakCents: number;
}
interface Override {
  date: string;
  label: string;
  feeCents: number;
}

const toKd = (cents: number) => (cents / 100).toFixed(3);
const toCents = (kd: string) => Math.round(parseFloat(kd || '0') * 100);

export function StaffPricing() {
  const { t } = useI18n();
  const [rates, setRates] = useState<Rates | null>(null);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [peak, setPeak] = useState('');
  const [offPeak, setOffPeak] = useState('');
  const [latePeak, setLatePeak] = useState('');
  const [lateOffPeak, setLateOffPeak] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const [date, setDate] = useState('');
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState('');

  function load() {
    api
      .get<{ rates: Rates; overrides: Override[] }>('/staff/pricing')
      .then((r) => {
        setRates(r.rates);
        setOverrides(r.overrides);
        setPeak(toKd(r.rates.peakCents));
        setOffPeak(toKd(r.rates.offPeakCents));
        setLatePeak(toKd(r.rates.latePeakCents));
        setLateOffPeak(toKd(r.rates.lateOffPeakCents));
      })
      .catch(() => setRates(null));
  }

  useEffect(load, []);

  async function saveRates(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    try {
      await api.put('/staff/pricing/rates', {
        peakCents: toCents(peak),
        offPeakCents: toCents(offPeak),
        latePeakCents: toCents(latePeak),
        lateOffPeakCents: toCents(lateOffPeak),
      });
      setNote(t('pr.saved'));
      load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : t('pr.failed'));
    }
  }

  async function saveOverride(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    if (!date || !label.trim()) return setNote(t('pr.needDateLabel'));
    try {
      await api.put('/staff/pricing/overrides', {
        date,
        label: label.trim(),
        feeCents: toCents(price),
      });
      setDate('');
      setLabel('');
      setPrice('');
      setNote(t('pr.saved'));
      load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : t('pr.failed'));
    }
  }

  async function removeOverride(d: string) {
    await api.del(`/staff/pricing/overrides/${d}`).catch(() => {});
    load();
  }

  if (!rates) return <p>{t('loading')}</p>;

  return (
    <div>
      {note && <p className="muted">{note}</p>}

      <form className="summary manual-form" onSubmit={saveRates}>
        <h3>{t('pr.baseTitle')}</h3>
        <p className="muted">{t('pr.baseHelp')}</p>
        <div className="row">
          <label className="field inline">
            {t('pr.peak')}
            <input value={peak} onChange={(e) => setPeak(e.target.value)} inputMode="decimal" />
          </label>
          <label className="field inline">
            {t('pr.offPeak')}
            <input
              value={offPeak}
              onChange={(e) => setOffPeak(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field inline">
            {t('pr.latePeak')}
            <input
              value={latePeak}
              onChange={(e) => setLatePeak(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field inline">
            {t('pr.lateOffPeak')}
            <input
              value={lateOffPeak}
              onChange={(e) => setLateOffPeak(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <button className="primary">{t('pr.save')}</button>
        </div>
      </form>

      <form className="summary manual-form" onSubmit={saveOverride}>
        <h3>{t('pr.overrideTitle')}</h3>
        <p className="muted">{t('pr.overrideHelp')}</p>
        <div className="row">
          <label className="field inline">
            {t('pr.date')}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field inline">
            {t('pr.label')}
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              placeholder={t('pr.labelHint')}
            />
          </label>
          <label className="field inline">
            {t('pr.price')}
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
          </label>
          <button className="primary">{t('pr.add')}</button>
        </div>
      </form>

      <h3>{t('pr.upcoming')}</h3>
      {overrides.length === 0 ? (
        <p className="muted">{t('pr.none')}</p>
      ) : (
        <div className="feature-grid">
          {overrides.map((o) => (
            <div className="feature-card" key={o.date}>
              <div className="mcard-top">
                <span className="tag">{o.date}</span>
                <span className="price">KD {toKd(o.feeCents)}</span>
              </div>
              <h3>{o.label}</h3>
              <button className="link" onClick={() => removeOverride(o.date)}>
                {t('pr.remove')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
