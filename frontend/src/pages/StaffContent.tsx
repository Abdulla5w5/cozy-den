import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { EventItem, Promo } from '../types';

const blank = {
  title: '',
  description: '',
  date: new Date().toISOString().slice(0, 10),
  time: '',
  location: '',
  type: 'internal' as 'internal' | 'external',
  imageUrl: '',
  isFeatured: false,
};

/** Staff: full CRUD over events (create / edit / delete / feature). */
export function EventsTab() {
  const { t } = useI18n();
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api
      .get<{ events: EventItem[] }>('/events?scope=all')
      .then((r) => setEvents(r.events))
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function startEdit(e: EventItem) {
    setEditingId(e.id);
    setForm({
      title: e.title,
      description: e.description,
      date: e.event_date,
      time: e.event_time ?? '',
      location: e.location,
      type: e.type,
      imageUrl: e.image_url ?? '',
      isFeatured: e.is_featured,
    });
  }

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, time: form.time || null, imageUrl: form.imageUrl || null };
      if (editingId) await api.put(`/events/${editingId}`, body);
      else await api.post('/events', body);
      setForm(null);
      setEditingId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm(t('staff.confirmDelete'))) return;
    await api.del(`/events/${id}`).catch((e) => setError(e.message));
    load();
  }

  return (
    <section>
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            setEditingId(null);
            setForm(form ? null : { ...blank });
          }}
        >
          {form ? t('staff.cancel') : t('staff.newEvent')}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {form && (
        <form className="summary manual-form" onSubmit={save}>
          <div className="row">
            <label className="field inline">
              {t('staff.evTitle')}
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="field inline">
              {t('bk.date')}
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <label className="field inline">
              {t('staff.start')}
              <input
                placeholder="19:00"
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
              />
            </label>
          </div>
          <div className="row">
            <label className="field inline">
              {t('staff.evLocation')}
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </label>
            <label className="field inline">
              {t('staff.evType')}
              <select
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as 'internal' | 'external' })
                }
              >
                <option value="internal">{t('ev.internal')}</option>
                <option value="external">{t('ev.external')}</option>
              </select>
            </label>
            <label className="field inline">
              {t('staff.evImage')}
              <input
                placeholder="https://…"
                value={form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            {t('staff.evDesc')}
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <div className="row">
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.isFeatured}
                onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })}
              />
              {t('staff.evFeatured')}
            </label>
            <button className="primary" disabled={busy}>
              {t('staff.save')}
            </button>
          </div>
        </form>
      )}

      <table className="data">
        <thead>
          <tr>
            <th>{t('bk.date')}</th>
            <th>{t('staff.evTitle')}</th>
            <th>{t('staff.evType')}</th>
            <th>{t('staff.evLocation')}</th>
            <th>{t('staff.evFeatured')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {events === null && (
            <tr>
              <td colSpan={6}>{t('loading')}</td>
            </tr>
          )}
          {events?.length === 0 && (
            <tr>
              <td colSpan={6} className="muted center">
                {t('ev.none')}
              </td>
            </tr>
          )}
          {events?.map((e) => (
            <tr key={e.id}>
              <td>
                {e.event_date}
                {e.event_time ? ` ${e.event_time}` : ''}
              </td>
              <td>{e.title}</td>
              <td>
                <span className={`pill ${e.type === 'external' ? 'ext' : ''}`}>
                  {e.type === 'internal' ? t('ev.internal') : t('ev.external')}
                </span>
              </td>
              <td>{e.location}</td>
              <td>{e.is_featured ? '★' : '—'}</td>
              <td>
                <button className="link" onClick={() => startEdit(e)}>
                  {t('staff.edit')}
                </button>
                <button className="link" onClick={() => remove(e.id)}>
                  {t('staff.delete')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Staff: edit the single entry-popup promo without a deploy. */
export function PromoTab() {
  const { t } = useI18n();
  const [form, setForm] = useState({
    imageUrl: '',
    text: '',
    linkUrl: '',
    linkLabel: '',
    isActive: false,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ promos: Promo[] }>('/promo/all')
      .then((r) => {
        const p = r.promos[0];
        if (p)
          setForm({
            imageUrl: p.image_url ?? '',
            text: p.text,
            linkUrl: p.link_url ?? '',
            linkLabel: p.link_label ?? '',
            isActive: p.is_active,
          });
      })
      .catch((e) => setError(e.message));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.put('/promo', {
        ...form,
        imageUrl: form.imageUrl || null,
        linkUrl: form.linkUrl || null,
        linkLabel: form.linkLabel || null,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <p className="muted">{t('staff.promoHint')}</p>
      {error && <div className="alert error">{error}</div>}
      <form className="summary manual-form" onSubmit={save}>
        <label className="field">
          {t('staff.promoText')}
          <input value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
        </label>
        <div className="row">
          <label className="field inline">
            {t('staff.evImage')}
            <input
              placeholder="https://…"
              value={form.imageUrl}
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
            />
          </label>
          <label className="field inline">
            {t('staff.promoLink')}
            <input
              placeholder="/events"
              value={form.linkUrl}
              onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
            />
          </label>
          <label className="field inline">
            {t('staff.promoLabel')}
            <input
              value={form.linkLabel}
              onChange={(e) => setForm({ ...form, linkLabel: e.target.value })}
            />
          </label>
        </div>
        <div className="row">
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            {t('staff.promoActive')}
          </label>
          <button className="primary" disabled={busy}>
            {t('staff.save')}
          </button>
          {saved && <span className="muted">✓</span>}
        </div>
      </form>
    </section>
  );
}
