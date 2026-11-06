import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';
import { kd, kdToCents } from '../types';

/**
 * Pricing tab: code prices and promo codes (migration 052). A code price is a
 * named set of prices: hourly per day group, or a percentage off. A promo code
 * is the word customers type: it picks one code price from a dropdown, and says
 * who may use it. Changing a code price changes every code using it.
 */
interface PriceSet {
  id: number;
  name: string;
  kind: 'hourly' | 'percent';
  percentOff: number | null;
  sunWedCents: number | null;
  sunWedExtraCents: number | null;
  thuFriCents: number | null;
  thuFriExtraCents: number | null;
  satCents: number | null;
  satExtraCents: number | null;
}
interface PromoCode {
  id: number;
  code: string;
  kind: 'group' | 'newcomer';
  minParty: number;
  isActive: boolean;
  priceSetId: number;
}
interface Lists {
  priceSets: PriceSet[];
  codes: PromoCode[];
}

const EMPTY_SET = {
  name: '',
  kind: 'hourly' as 'hourly' | 'percent',
  percent: '',
  sunWed: '',
  sunWedExtra: '',
  thuFri: '',
  thuFriExtra: '',
  sat: '',
  satExtra: '',
};
const orBlank = (c: number | null) => (c === null ? '' : kd(c));
const orNull = (v: string) => (v.trim() === '' ? null : kdToCents(v));
// A typo must not save: "5,9" would read as 5.
const isKdOrBlank = (v: string) => v.trim() === '' || /^\d+(\.\d{1,3})?$/.test(v.trim());
// A validation error says only "Validation failed"; the reason is in its details.
const firstDetail = (err: ApiError): string | null => {
  const first: unknown = Array.isArray(err.details) ? err.details[0] : null;
  const message = (first as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : null;
};

export function StaffPromoCodes() {
  const { t, money } = useI18n();
  const [sets, setSets] = useState<PriceSet[]>([]);
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_SET);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newCode, setNewCode] = useState('');
  const [newKind, setNewKind] = useState<'group' | 'newcomer'>('group');
  const [newMinParty, setNewMinParty] = useState('6');
  const [newSetId, setNewSetId] = useState('');

  function apply(r: Lists) {
    setSets(r.priceSets);
    setCodes(r.codes);
  }

  useEffect(() => {
    api
      .get<Lists>('/staff/pricing')
      .then(apply)
      .catch(() => {});
  }, []);

  /** Run a change, showing what went wrong in the server's own words. */
  async function run(action: () => Promise<Partial<Lists>>, saved = true): Promise<boolean> {
    setNote(null);
    try {
      const r = await action();
      if (r.priceSets) setSets(r.priceSets);
      if (r.codes) setCodes(r.codes);
      if (saved) setNote(t('pr.saved'));
      return true;
    } catch (err) {
      setNote(err instanceof ApiError ? firstDetail(err) ?? err.message : t('pr.failed'));
      return false;
    }
  }

  const set = <K extends keyof typeof EMPTY_SET>(k: K, v: (typeof EMPTY_SET)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function editSet(s: PriceSet) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      kind: s.kind,
      percent: s.percentOff === null ? '' : String(s.percentOff),
      sunWed: orBlank(s.sunWedCents),
      sunWedExtra: orBlank(s.sunWedExtraCents),
      thuFri: orBlank(s.thuFriCents),
      thuFriExtra: orBlank(s.thuFriExtraCents),
      sat: orBlank(s.satCents),
      satExtra: orBlank(s.satExtraCents),
    });
    setNote(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_SET);
  }

  async function saveSet(e: FormEvent) {
    e.preventDefault();
    const prices = [form.sunWed, form.sunWedExtra, form.thuFri, form.thuFriExtra, form.sat, form.satExtra];
    if (form.kind === 'hourly' && !prices.every(isKdOrBlank)) return setNote(t('pr.badNumber'));
    const percent = Number(form.percent);
    const hourly = form.kind === 'hourly';
    const body = {
      name: form.name.trim(),
      kind: form.kind,
      percentOff: hourly ? null : Number.isInteger(percent) && form.percent.trim() ? percent : null,
      sunWedCents: hourly ? orNull(form.sunWed) : null,
      sunWedExtraCents: hourly ? orNull(form.sunWedExtra) : null,
      thuFriCents: hourly ? orNull(form.thuFri) : null,
      thuFriExtraCents: hourly ? orNull(form.thuFriExtra) : null,
      satCents: hourly ? orNull(form.sat) : null,
      satExtraCents: hourly ? orNull(form.satExtra) : null,
    };
    const ok = await run(() =>
      editingId === null
        ? api.post<Lists>('/staff/pricing/sets', body)
        : api.put<Lists>(`/staff/pricing/sets/${editingId}`, body),
    );
    if (ok) cancelEdit();
  }

  async function removeSet(s: PriceSet) {
    if (!window.confirm(t('pr.setDeleteConfirm', { name: s.name }))) return;
    const ok = await run(() => api.del<Lists>(`/staff/pricing/sets/${s.id}`));
    if (!ok) return;
    if (editingId === s.id) cancelEdit();
    // The Add code dropdown no longer offers it.
    setNewSetId((id) => (id === String(s.id) ? '' : id));
  }

  async function addCode(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() =>
      api.post<Lists>('/staff/pricing/codes', {
        code: newCode.trim(),
        kind: newKind,
        minParty: Number(newMinParty) || 6,
        priceSetId: Number(newSetId),
      }),
    );
    if (ok) setNewCode('');
  }

  const dayLine = (label: string, first: number | null, extra: number | null) =>
    first === null || extra === null
      ? null
      : t('pr.setDay', { day: label, first: money(first), extra: money(extra) });

  const summary = (s: PriceSet) =>
    s.kind === 'percent'
      ? t('pr.setPercent', { n: String(s.percentOff ?? 0) })
      : [
          dayLine(t('pr.daySunWed'), s.sunWedCents, s.sunWedExtraCents),
          dayLine(t('pr.dayThuFri'), s.thuFriCents, s.thuFriExtraCents),
          dayLine(t('pr.daySat'), s.satCents, s.satExtraCents),
        ]
          .filter(Boolean)
          .join(' · ');

  const usedBy = (s: PriceSet) => codes.filter((c) => c.priceSetId === s.id).map((c) => c.code);

  const dayRow = (
    label: string,
    first: 'sunWed' | 'thuFri' | 'sat',
    extra: 'sunWedExtra' | 'thuFriExtra' | 'satExtra',
  ) => (
    <div className="row">
      <label className="field inline">
        {t('pr.setFirst', { day: label })}
        <input
          value={form[first]}
          onChange={(e) => set(first, e.target.value)}
          inputMode="decimal"
          placeholder={t('pr.setNormal')}
        />
      </label>
      <label className="field inline">
        {t('pr.setExtra', { day: label })}
        <input
          value={form[extra]}
          onChange={(e) => set(extra, e.target.value)}
          inputMode="decimal"
          placeholder={t('pr.setNormal')}
        />
      </label>
    </div>
  );

  return (
    <>
      {note && <p className="muted">{note}</p>}

      <form className="summary manual-form" onSubmit={saveSet}>
        <h3>{editingId === null ? t('pr.setsTitle') : t('pr.setEditing', { name: form.name })}</h3>
        <p className="muted">{t('pr.setsHelp')}</p>
        <div className="row">
          <label className="field inline">
            {t('pr.setName')}
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={60}
              required
            />
          </label>
          <label className="field inline">
            {t('pr.setKind')}
            <select
              value={form.kind}
              onChange={(e) => set('kind', e.target.value as 'hourly' | 'percent')}
            >
              <option value="hourly">{t('pr.setKindHourly')}</option>
              <option value="percent">{t('pr.setKindPercent')}</option>
            </select>
          </label>
          {form.kind === 'percent' && (
            <label className="field inline">
              {t('pr.setPercentField')}
              <input
                value={form.percent}
                onChange={(e) => set('percent', e.target.value)}
                inputMode="numeric"
              />
            </label>
          )}
        </div>
        {form.kind === 'hourly' && (
          <>
            {dayRow(t('pr.daySunWed'), 'sunWed', 'sunWedExtra')}
            {dayRow(t('pr.dayThuFri'), 'thuFri', 'thuFriExtra')}
            {dayRow(t('pr.daySat'), 'sat', 'satExtra')}
          </>
        )}
        <div className="row">
          <button className="primary">{editingId === null ? t('pr.setAdd') : t('pr.save')}</button>
          {editingId !== null && (
            <button type="button" onClick={cancelEdit}>
              {t('sh.cancel')}
            </button>
          )}
        </div>
        {sets.length > 0 && (
          <ul className="host-list price-set-list">
            {sets.map((s) => (
              <li key={s.id}>
                <span>
                  <strong>{s.name}</strong>
                  <small>{summary(s)}</small>
                  <small>
                    {usedBy(s).length > 0
                      ? t('pr.setUsedBy', { codes: usedBy(s).join(', ') })
                      : t('pr.setUnused')}
                  </small>
                </span>
                <span className="host-actions">
                  <button type="button" className="link" onClick={() => editSet(s)}>
                    {t('sh.edit')}
                  </button>
                  <button type="button" className="link danger" onClick={() => removeSet(s)}>
                    {t('sh.delete')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
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
            {t('pr.codePrice')}
            <select value={newSetId} onChange={(e) => setNewSetId(e.target.value)}>
              <option value="">—</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field inline">
            {t('pr.codeWho')}
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as 'group' | 'newcomer')}
            >
              <option value="group">{t('pr.codeWhoGroup')}</option>
              <option value="newcomer">{t('pr.codeWhoNew')}</option>
            </select>
          </label>
          {newKind === 'group' && (
            <label className="field inline">
              {t('pr.codeMinParty')}
              <input
                value={newMinParty}
                onChange={(e) => setNewMinParty(e.target.value)}
                inputMode="numeric"
              />
            </label>
          )}
          <button className="primary" disabled={newCode.trim().length < 6 || !newSetId}>
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
                    ? t('pr.codeWhoNew')
                    : t('pr.codeFor', { n: String(c.minParty) })}
                </span>
                <select
                  aria-label={t('pr.codePrice')}
                  value={c.priceSetId}
                  onChange={(e) =>
                    run(() =>
                      api.put<Lists>(`/staff/pricing/codes/${c.id}`, {
                        priceSetId: Number(e.target.value),
                      }),
                    )
                  }
                >
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <span className="tag">{c.isActive ? t('pr.codeOn') : t('pr.codeOff')}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    run(
                      () =>
                        api.put<Lists>(`/staff/pricing/codes/${c.id}`, { isActive: !c.isActive }),
                      false,
                    )
                  }
                >
                  {c.isActive ? t('pr.codeDisable') : t('pr.codeEnable')}
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() => run(() => api.del<Lists>(`/staff/pricing/codes/${c.id}`), false)}
                >
                  {t('pr.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </>
  );
}
