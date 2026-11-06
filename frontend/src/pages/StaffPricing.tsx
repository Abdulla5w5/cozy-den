import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { kd, kdToCents } from '../types';

/**
 * Staff price editor.
 *
 * Two base rates, the late-seating rates, a flat six-hour weekday price, plus
 * a list of dated overrides. An override is simply "on
 * this date, charge this instead" — a national holiday, a quiet-Tuesday
 * discount and an event upcharge are all the same operation, so staff never
 * need a deploy to change a price.
 *
 * Prices are entered in KD to two decimals and stored in hundredths, since the
 * whole system keeps money as integers to avoid rounding drift.
 */

interface Rates {
  peakCents: number;
  offPeakCents: number;
  latePeakCents: number;
  lateOffPeakCents: number;
  sixHourOffPeakCents: number | null;
  extraHourPeakCents: number | null;
  extraHourOffPeakCents: number | null;
}
/** Null until set; blank in the form. */
interface GroupRates {
  offPeakCents: number | null;
  extraOffPeakCents: number | null;
  saturdayCents: number | null;
  extraSaturdayCents: number | null;
}
interface PromoCode {
  id: number;
  code: string;
  kind: 'group' | 'newcomer';
  minParty: number;
  percentOff: number | null;
  isActive: boolean;
}
interface Override {
  date: string;
  label: string;
  feeCents: number;
}

const toKd = kd;
const toCents = kdToCents;
const kdOrBlank = (c: number | null) => (c === null ? '' : toKd(c));
const centsOrNull = (v: string) => (v.trim() === '' ? null : toCents(v));
// A typo must not save: "5,9" would read as 5 and "x" as switched off.
const isKd = (v: string) => /^\d+(\.\d{1,3})?$/.test(v.trim());
const isKdOrBlank = (v: string) => v.trim() === '' || isKd(v);

export function StaffPricing() {
  const { t } = useI18n();
  const [rates, setRates] = useState<Rates | null>(null);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [peak, setPeak] = useState('');
  const [offPeak, setOffPeak] = useState('');
  const [latePeak, setLatePeak] = useState('');
  const [lateOffPeak, setLateOffPeak] = useState('');
  // Blank means no flat six-hour price.
  const [sixHour, setSixHour] = useState('');
  // Blank means the odd hour of a 3- or 5-hour booking is half a block.
  const [extraPeak, setExtraPeak] = useState('');
  const [extraOffPeak, setExtraOffPeak] = useState('');
  const [note, setNote] = useState<string | null>(null);
  // Group promo code prices and the codes themselves.
  const [codes, setCodes] = useState<PromoCode[]>([]);
  // The two private-host options, per hour for the whole table. Blank takes
  // an option off sale.
  const [hostNormal, setHostNormal] = useState('');
  const [hostClocktower, setHostClocktower] = useState('');
  const [groupOff, setGroupOff] = useState('');
  const [groupExtraOff, setGroupExtraOff] = useState('');
  const [groupSat, setGroupSat] = useState('');
  const [groupExtraSat, setGroupExtraSat] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newMinParty, setNewMinParty] = useState('6');

  const [date, setDate] = useState('');
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState('');

  function load() {
    api
      .get<{
        rates: Rates;
        overrides: Override[];
        groupRates: GroupRates;
        codes: PromoCode[];
        hostRates: { normalHourlyCents: number | null; clocktowerHourlyCents: number | null };
      }>(
        '/staff/pricing',
      )
      .then((r) => {
        setRates(r.rates);
        setOverrides(r.overrides);
        setCodes(r.codes);
        setHostNormal(kdOrBlank(r.hostRates.normalHourlyCents));
        setHostClocktower(kdOrBlank(r.hostRates.clocktowerHourlyCents));
        setGroupOff(kdOrBlank(r.groupRates.offPeakCents));
        setGroupExtraOff(kdOrBlank(r.groupRates.extraOffPeakCents));
        setGroupSat(kdOrBlank(r.groupRates.saturdayCents));
        setGroupExtraSat(kdOrBlank(r.groupRates.extraSaturdayCents));
        setPeak(toKd(r.rates.peakCents));
        setOffPeak(toKd(r.rates.offPeakCents));
        setLatePeak(toKd(r.rates.latePeakCents));
        setLateOffPeak(toKd(r.rates.lateOffPeakCents));
        setSixHour(r.rates.sixHourOffPeakCents === null ? '' : toKd(r.rates.sixHourOffPeakCents));
        setExtraPeak(r.rates.extraHourPeakCents === null ? '' : toKd(r.rates.extraHourPeakCents));
        setExtraOffPeak(
          r.rates.extraHourOffPeakCents === null ? '' : toKd(r.rates.extraHourOffPeakCents),
        );
      })
      .catch(() => setRates(null));
  }

  useEffect(load, []);

  async function saveRates(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    if (
      ![peak, offPeak, latePeak, lateOffPeak].every(isKd) ||
      ![sixHour, extraPeak, extraOffPeak].every(isKdOrBlank)
    ) {
      return setNote(t('pr.badNumber'));
    }
    try {
      await api.put('/staff/pricing/rates', {
        peakCents: toCents(peak),
        offPeakCents: toCents(offPeak),
        latePeakCents: toCents(latePeak),
        lateOffPeakCents: toCents(lateOffPeak),
        sixHourOffPeakCents: sixHour.trim() === '' ? null : toCents(sixHour),
        extraHourPeakCents: extraPeak.trim() === '' ? null : toCents(extraPeak),
        extraHourOffPeakCents: extraOffPeak.trim() === '' ? null : toCents(extraOffPeak),
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
    if (!isKd(price)) return setNote(t('pr.badNumber'));
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

  async function saveHostRates(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    if (![hostNormal, hostClocktower].every(isKdOrBlank)) return setNote(t('pr.badNumber'));
    try {
      await api.put('/staff/pricing/hosts', {
        normalHourlyCents: centsOrNull(hostNormal),
        clocktowerHourlyCents: centsOrNull(hostClocktower),
      });
      setNote(t('pr.saved'));
      load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : t('pr.failed'));
    }
  }

  async function saveGroupRates(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    if (![groupOff, groupExtraOff, groupSat, groupExtraSat].every(isKdOrBlank)) {
      return setNote(t('pr.badNumber'));
    }
    try {
      await api.put('/staff/pricing/group', {
        offPeakCents: centsOrNull(groupOff),
        extraOffPeakCents: centsOrNull(groupExtraOff),
        saturdayCents: centsOrNull(groupSat),
        extraSaturdayCents: centsOrNull(groupExtraSat),
      });
      setNote(t('pr.saved'));
      load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : t('pr.failed'));
    }
  }

  async function addCode(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    try {
      const r = await api.post<{ codes: PromoCode[] }>('/staff/pricing/codes', {
        code: newCode.trim(),
        minParty: Number(newMinParty) || 6,
      });
      setCodes(r.codes);
      setNewCode('');
      setNote(t('pr.saved'));
    } catch (err) {
      setNote(err instanceof Error ? err.message : t('pr.failed'));
    }
  }

  async function toggleCode(c: PromoCode) {
    const r = await api
      .put<{ codes: PromoCode[] }>(`/staff/pricing/codes/${c.id}`, { isActive: !c.isActive })
      .catch(() => null);
    if (r) setCodes(r.codes);
  }

  async function removeCode(c: PromoCode) {
    const r = await api.del<{ codes: PromoCode[] }>(`/staff/pricing/codes/${c.id}`).catch(() => null);
    if (r) setCodes(r.codes);
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
          <label className="field inline">
            {t('pr.sixHour')}
            <input
              value={sixHour}
              onChange={(e) => setSixHour(e.target.value)}
              inputMode="decimal"
              placeholder={t('pr.sixHourOff')}
            />
          </label>
          <label className="field inline">
            {t('pr.extraPeak')}
            <input
              value={extraPeak}
              onChange={(e) => setExtraPeak(e.target.value)}
              inputMode="decimal"
              placeholder={t('pr.extraHalf')}
            />
          </label>
          <label className="field inline">
            {t('pr.extraOffPeak')}
            <input
              value={extraOffPeak}
              onChange={(e) => setExtraOffPeak(e.target.value)}
              inputMode="decimal"
              placeholder={t('pr.extraHalf')}
            />
          </label>
          <button className="primary">{t('pr.save')}</button>
        </div>
      </form>

      <form className="summary manual-form" onSubmit={saveHostRates}>
        <h3>{t('pr.hostTitle')}</h3>
        <p className="muted">{t('pr.hostHelp')}</p>
        <div className="row">
          <label className="field inline">
            {t('host.kind.normal')}
            <input
              value={hostNormal}
              onChange={(e) => setHostNormal(e.target.value)}
              inputMode="decimal"
              placeholder={t('pr.hostOff')}
            />
          </label>
          <label className="field inline">
            {t('host.kind.clocktower')}
            <input
              value={hostClocktower}
              onChange={(e) => setHostClocktower(e.target.value)}
              inputMode="decimal"
              placeholder={t('pr.hostOff')}
            />
          </label>
          <button className="primary">{t('pr.save')}</button>
        </div>
      </form>

      <form className="summary manual-form" onSubmit={saveGroupRates}>
        <h3>{t('pr.groupTitle')}</h3>
        <p className="muted">{t('pr.groupHelp')}</p>
        <div className="row">
          <label className="field inline">
            {t('pr.groupOff')}
            <input value={groupOff}
              onChange={(e) => setGroupOff(e.target.value)}
              inputMode="decimal"
              placeholder={t('pr.groupUnset')}
            />
          </label>
          <label className="field inline">
            {t('pr.groupExtraOff')}
            <input
              value={groupExtraOff}
              onChange={(e) => setGroupExtraOff(e.target.value)}
              inputMode="decimal"
              placeholder={t('pr.groupUnset')}
            />
          </label>
          <label className="field inline">
            {t('pr.groupSat')}
            <input value={groupSat}
              onChange={(e) => setGroupSat(e.target.value)}
              inputMode="decimal"
              placeholder={t('pr.groupUnset')}
            />
          </label>
          <label className="field inline">
            {t('pr.groupExtraSat')}
            <input
              value={groupExtraSat}
              onChange={(e) => setGroupExtraSat(e.target.value)}
              inputMode="decimal"
              placeholder={t('pr.groupUnset')}
            />
          </label>
          <button className="primary">{t('pr.save')}</button>
        </div>
      </form>

      <form className="summary manual-form" onSubmit={addCode}>
        <h3>{t('pr.codesTitle')}</h3>
        <p className="muted">{t('pr.codesHelp')}</p>
        <div className="row">
          <label className="field inline">
            {t('pr.code')}
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              maxLength={40}
              autoCapitalize="characters"
              dir="ltr"
            />
          </label>
          <label className="field inline">
            {t('pr.codeMinParty')}
            <input
              value={newMinParty}
              onChange={(e) => setNewMinParty(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <button className="primary" disabled={newCode.trim().length < 6}>
            {t('pr.addCode')}
          </button>
        </div>
        {codes.length === 0 ? (
          <p className="muted">{t('pr.noCodes')}</p>
        ) : (
          <ul className="promo-code-list">
            {codes.map((c) => (
              <li key={c.id}>
                <code dir="ltr">{c.code}</code>
                <span className="muted">
                  {c.kind === 'newcomer'
                    ? t('pr.codeNewcomer', { n: String(c.percentOff ?? 0) })
                    : t('pr.codeFor', { n: String(c.minParty) })}
                </span>
                <span className="tag">{c.isActive ? t('pr.codeOn') : t('pr.codeOff')}</span>
                <button type="button" className="link" onClick={() => toggleCode(c)}>
                  {c.isActive ? t('pr.codeDisable') : t('pr.codeEnable')}
                </button>
                <button type="button" className="link" onClick={() => removeCode(c)}>
                  {t('pr.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
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
