import { Fragment, FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { EventItem, EventReservation, Game, MenuItem, Promo } from '../types';


/**
 * Live proof that a pasted link is actually an image.
 *
 * Staff were pasting Google Drive share links, which serve an HTML page rather
 * than image bytes — the field accepted them happily and the picture silently
 * came out broken on the live site. Letting the browser try to load it is the
 * only honest check: if it renders here, it renders for customers.
 */
function ImagePreview({ url }: { url: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'ok' | 'bad'>('idle');
  const trimmed = url.trim();

  useEffect(() => {
    setState('idle');
  }, [trimmed]);

  if (!trimmed) return null;

  // The mistake worth naming explicitly, because the URL looks perfectly valid.
  const isSharePage = /drive\.google\.com|docs\.google\.com|dropbox\.com\/s\/|onedrive\.live\.com/i.test(
    trimmed,
  );

  return (
    <div className="img-preview">
      {isSharePage ? (
        <p className="muted">{t('staff.imgSharePage')}</p>
      ) : (
        <>
          <img
            src={trimmed}
            alt=""
            onLoad={() => setState('ok')}
            onError={() => setState('bad')}
            style={{
              maxHeight: '120px',
              maxWidth: '100%',
              borderRadius: '8px',
              display: state === 'bad' ? 'none' : 'block',
            }}
          />
          {state === 'bad' && <p className="muted">{t('staff.imgBad')}</p>}
        </>
      )}
    </div>
  );
}

const blank = {
  title: '',
  description: '',
  date: new Date().toISOString().slice(0, 10),
  time: '',
  location: '',
  type: 'internal' as 'internal' | 'external',
  imageUrl: '',
  isFeatured: false,
  // An event may hold a table for a window. Blank table = holds nothing.
  tableId: '' as string,
  startTime: '',
  durationMin: '' as string,
  capacity: '' as string,
  seatPriceKd: '0.000',
};

/** Staff: full CRUD over events (create / edit / delete / feature). */
export function EventsTab() {
  const { t } = useI18n();
  const [events, setEvents] = useState<EventItem[] | null>(null);
  // For the table dropdown. Availability is the only endpoint that lists
  // tables publicly; the date is irrelevant here, only the labels are used.
  const [tables, setTables] = useState<{ tableId: number; label: string }[]>([]);
  const [showing, setShowing] = useState<number | null>(null);
  useEffect(() => {
    api
      .get<{ availability: { tableId: number; label: string }[] }>(
        `/tables/availability?date=${new Date().toISOString().slice(0, 10)}`,
      )
      .then((r) => setTables(r.availability.map((a) => ({ tableId: a.tableId, label: a.label }))))
      .catch(() => setTables([]));
  }, []);
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
      tableId: e.table_id ? String(e.table_id) : '',
      startTime: e.start_time ?? '',
      durationMin: e.duration_min ? String(e.duration_min) : '',
      capacity: e.capacity ? String(e.capacity) : '',
      seatPriceKd: ((e.seat_price_cents ?? 0) / 100).toFixed(3),
    });
  }

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      // Blank means "not set", which the API expects as null rather than ''.
      const body = {
        ...form,
        time: form.time || null,
        imageUrl: form.imageUrl || null,
        tableId: form.tableId ? Number(form.tableId) : null,
        startTime: form.startTime || null,
        durationMin: form.durationMin ? Number(form.durationMin) : null,
        capacity: form.capacity ? Number(form.capacity) : null,
        seatPriceCents: Math.round(parseFloat(form.seatPriceKd || '0') * 100),
      };
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
              <ImagePreview url={form.imageUrl} />
            </label>
          </div>
          {/* Assigning a table blocks it from regular bookings for this window.
              The API rejects a table without a start time and length. */}
          <div className="row">
            <label className="field inline">
              {t('cat.evTable')}
              <select
                value={form.tableId}
                onChange={(e) => setForm({ ...form, tableId: e.target.value })}
              >
                <option value="">{t('cat.evNoTable')}</option>
                {tables.map((tb) => (
                  <option key={tb.tableId} value={tb.tableId}>
                    {tb.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field inline">
              {t('cat.evStart')}
              <input
                placeholder="18:00"
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              />
            </label>
            <label className="field inline">
              {t('cat.evLength')}
              <select
                value={form.durationMin}
                onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
              >
                <option value="">—</option>
                {[60, 120, 180, 240, 300, 360].map((m) => (
                  <option key={m} value={m}>
                    {m / 60}h
                  </option>
                ))}
              </select>
            </label>
            <label className="field inline">
              {t('cat.evCapacity')}
              <input
                inputMode="numeric"
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: e.target.value.replace(/\D/g, '') })}
              />
            </label>
            <label className="field inline">
              {t('cat.evSeatPrice')}
              <input
                inputMode="decimal"
                value={form.seatPriceKd}
                onChange={(e) => setForm({ ...form, seatPriceKd: e.target.value })}
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

      <div className="table-scroll">
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
            <Fragment key={e.id}>
            <tr>
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
                <button
                  className="link"
                  onClick={() => setShowing(showing === e.id ? null : e.id)}
                >
                  {t('cat.evWho')} ({e.seats_taken ?? 0})
                </button>
              </td>
            </tr>
            {showing === e.id && (
              <tr key={`${e.id}-who`}>
                <td colSpan={6}>
                  <EventReservations eventId={e.id} />
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>
        </div>
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
            <ImagePreview url={form.imageUrl} />
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


// ---------------------------------------------------------------------------
// Games and menu items: the same add / edit / remove shape as events above.
//
// One deliberate difference. An event has no dependents, so deleting one is
// just a delete. A game can be attached to past bookings and to customers'
// play history, and a menu item to past orders — so the API deletes only when
// nothing references the row, and otherwise RETIRES it: gone from the customer
// lists, every historical record intact. The response says which happened and
// the UI repeats it, so "remove" is never silently something else.
// ---------------------------------------------------------------------------

const blankGame = {
  title: '',
  minPlayers: 2,
  maxPlayers: 4,
  category: '',
  description: '',
  imageUrl: '',
  purchaseUrl: '',
  isActive: true,
};

export function GamesTab() {
  const { t } = useI18n();
  const [games, setGames] = useState<Game[] | null>(null);
  const [form, setForm] = useState<typeof blankGame | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api
      .get<{ games: Game[] }>('/games/all')
      .then((r) => setGames(r.games))
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function startEdit(g: Game) {
    setEditingId(g.id);
    setNote(null);
    setForm({
      title: g.title,
      minPlayers: g.min_players,
      maxPlayers: g.max_players,
      category: g.category,
      description: g.description,
      imageUrl: g.image_url ?? '',
      purchaseUrl: g.purchase_url ?? '',
      isActive: g.is_active !== false,
    });
  }

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...form,
        imageUrl: form.imageUrl || null,
        purchaseUrl: form.purchaseUrl || null,
      };
      if (editingId) await api.put(`/games/${editingId}`, body);
      else await api.post('/games', body);
      setForm(null);
      setEditingId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(g: Game) {
    if (!window.confirm(t('cat.confirmRemove', { name: g.title }))) return;
    setError(null);
    try {
      const r = await api.del<{ outcome: 'deleted' | 'retired' }>(`/games/${g.id}`);
      setNote(t(r.outcome === 'retired' ? 'cat.retired' : 'cat.deleted', { name: g.title }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed.');
    }
  }

  return (
    <section>
      <p className="muted">{t('cat.gamesHint')}</p>
      {error && <div className="alert error">{error}</div>}
      {note && <p className="muted">{note}</p>}

      {form ? (
        <form className="summary manual-form" onSubmit={save}>
          <div className="row">
            <label className="field inline">
              {t('cat.title')}
              <input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="field inline">
              {t('cat.category')}
              <input
                required
                maxLength={60}
                placeholder="Strategy"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </label>
            <label className="field inline">
              {t('wb.min')}
              <input
                type="number"
                min={1}
                max={100}
                value={form.minPlayers}
                onChange={(e) => setForm({ ...form, minPlayers: Number(e.target.value) })}
              />
            </label>
            <label className="field inline">
              {t('wb.max')}
              <input
                type="number"
                min={1}
                max={100}
                value={form.maxPlayers}
                onChange={(e) => setForm({ ...form, maxPlayers: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="field">
            {t('cat.description')}
            <textarea
              maxLength={2000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <div className="row">
            <label className="field inline">
              {t('staff.evImage')}
              <input
                placeholder="https://…"
                value={form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              />
              <ImagePreview url={form.imageUrl} />
            </label>
            <label className="field inline">
              {t('cat.purchaseUrl')}
              <input
                placeholder="https://…"
                value={form.purchaseUrl}
                onChange={(e) => setForm({ ...form, purchaseUrl: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />{' '}
              {t('cat.shownToCustomers')}
            </span>
          </label>
          <div className="row">
            <button className="primary" disabled={busy}>
              {busy ? t('cat.saving') : t('cat.save')}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setForm(null);
                setEditingId(null);
              }}
            >
              {t('cat.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button className="primary" onClick={() => setForm({ ...blankGame })}>
          {t('cat.addGame')}
        </button>
      )}

      {games === null ? (
        <p>{t('loading')}</p>
      ) : games.length === 0 ? (
        <p className="muted">{t('cat.noGames')}</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>{t('cat.title')}</th>
                <th>{t('cat.category')}</th>
                <th>{t('cat.players')}</th>
                <th>{t('cat.visible')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={g.id}>
                  <td>{g.title}</td>
                  <td>{g.category}</td>
                  <td>
                    {g.min_players}–{g.max_players}
                  </td>
                  <td>
                    <span className="pill">
                      {g.is_active === false ? t('cat.retiredTag') : t('cat.liveTag')}
                    </span>
                  </td>
                  <td>
                    <button className="link" onClick={() => startEdit(g)}>
                      {t('cat.edit')}
                    </button>{' '}
                    <button className="link" onClick={() => remove(g)}>
                      {t('cat.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const blankItem = {
  name: '',
  category: 'food' as 'food' | 'drink',
  priceCents: 0,
  description: '',
  available: true,
  // Arabic copy and the menu heading come from the Foodics import. They are
  // edited here too, so an item saved from this form keeps them rather than
  // losing what the import set.
  nameAr: '',
  descriptionAr: '',
  section: '',
  sectionAr: '',
  displayOrder: 0,
};

export function MenuTab() {
  const { t, money } = useI18n();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [form, setForm] = useState<typeof blankItem | null>(null);
  const [priceKd, setPriceKd] = useState('0.000');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api
      .get<{ items: MenuItem[] }>('/menu/all')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function startEdit(m: MenuItem) {
    setEditingId(m.id);
    setNote(null);
    setPriceKd((m.price_cents / 100).toFixed(3));
    setForm({
      name: m.name,
      category: m.category,
      priceCents: m.price_cents,
      description: m.description,
      available: m.available !== false,
      nameAr: m.name_ar ?? '',
      descriptionAr: m.description_ar ?? '',
      section: m.section ?? '',
      sectionAr: m.section_ar ?? '',
      displayOrder: m.display_order ?? 0,
    });
  }

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      // Staff type KD; the API only ever deals in integer fils.
      const body = { ...form, priceCents: Math.round(parseFloat(priceKd || '0') * 100) };
      if (editingId) await api.put(`/menu/${editingId}`, body);
      else await api.post('/menu', body);
      setForm(null);
      setEditingId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: MenuItem) {
    if (!window.confirm(t('cat.confirmRemove', { name: m.name }))) return;
    setError(null);
    try {
      const r = await api.del<{ outcome: 'deleted' | 'retired' }>(`/menu/${m.id}`);
      setNote(t(r.outcome === 'retired' ? 'cat.retired' : 'cat.deleted', { name: m.name }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed.');
    }
  }

  return (
    <section>
      <p className="muted">{t('cat.menuHint')}</p>
      {error && <div className="alert error">{error}</div>}
      {note && <p className="muted">{note}</p>}

      {form ? (
        <form className="summary manual-form" onSubmit={save}>
          <div className="row">
            <label className="field inline">
              {t('cat.name')}
              <input
                required
                maxLength={200}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="field inline">
              {t('cat.category')}
              <select
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as 'food' | 'drink' })
                }
              >
                <option value="food">{t('menu.food')}</option>
                <option value="drink">{t('menu.drink')}</option>
              </select>
            </label>
            <label className="field inline">
              {t('pr.price')}
              <input
                inputMode="decimal"
                value={priceKd}
                onChange={(e) => setPriceKd(e.target.value)}
              />
              <span className="muted">{t('cat.priceHint')}</span>
            </label>
          </div>
          <div className="row">
            <label className="field inline">
              {t('cat.nameAr')}
              <input
                dir="rtl"
                maxLength={200}
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              />
            </label>
            <label className="field inline">
              {t('cat.section')}
              <input
                maxLength={120}
                value={form.section}
                onChange={(e) => setForm({ ...form, section: e.target.value })}
              />
              <span className="muted">{t('cat.sectionHint')}</span>
            </label>
            <label className="field inline">
              {t('cat.sectionAr')}
              <input
                dir="rtl"
                maxLength={120}
                value={form.sectionAr}
                onChange={(e) => setForm({ ...form, sectionAr: e.target.value })}
              />
            </label>
            <label className="field inline">
              {t('cat.displayOrder')}
              <input
                inputMode="numeric"
                value={String(form.displayOrder)}
                onChange={(e) =>
                  setForm({ ...form, displayOrder: Number(e.target.value.replace(/\D/g, '')) || 0 })
                }
              />
              <span className="muted">{t('cat.displayOrderHint')}</span>
            </label>
          </div>
          <label className="field">
            {t('cat.description')}
            <textarea
              maxLength={2000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label className="field">
            {t('cat.descriptionAr')}
            <textarea
              dir="rtl"
              maxLength={2000}
              value={form.descriptionAr}
              onChange={(e) => setForm({ ...form, descriptionAr: e.target.value })}
            />
          </label>
          <label className="field">
            <span>
              <input
                type="checkbox"
                checked={form.available}
                onChange={(e) => setForm({ ...form, available: e.target.checked })}
              />{' '}
              {t('cat.shownToCustomers')}
            </span>
          </label>
          <div className="row">
            <button className="primary" disabled={busy}>
              {busy ? t('cat.saving') : t('cat.save')}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setForm(null);
                setEditingId(null);
              }}
            >
              {t('cat.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button
          className="primary"
          onClick={() => {
            setForm({ ...blankItem });
            setPriceKd('0.000');
          }}
        >
          {t('cat.addItem')}
        </button>
      )}

      {items === null ? (
        <p>{t('loading')}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t('cat.noItems')}</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>{t('cat.name')}</th>
                <th>{t('cat.category')}</th>
                <th>{t('pr.price')}</th>
                <th>{t('cat.visible')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{t(m.category === 'food' ? 'menu.food' : 'menu.drink')}</td>
                  <td>
                    {m.price_cents > 0 ? (
                      money(m.price_cents)
                    ) : (
                      <span className="muted">{t('cat.priceHidden')}</span>
                    )}
                  </td>
                  <td>
                    <span className="pill">
                      {m.available === false ? t('cat.retiredTag') : t('cat.liveTag')}
                    </span>
                  </td>
                  <td>
                    <button className="link" onClick={() => startEdit(m)}>
                      {t('cat.edit')}
                    </button>{' '}
                    <button className="link" onClick={() => remove(m)}>
                      {t('cat.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}


/**
 * Who has booked into an event. Loaded on demand rather than with the list:
 * staff open one event at a time, and the list would otherwise fetch a
 * reservation set per row on every page view.
 */
function EventReservations({ eventId }: { eventId: number }) {
  const { t, money } = useI18n();
  const [rows, setRows] = useState<EventReservation[] | null>(null);

  useEffect(() => {
    api
      .get<{ reservations: EventReservation[] }>(`/events/${eventId}/reservations`)
      .then((r) => setRows(r.reservations))
      .catch(() => setRows([]));
  }, [eventId]);

  if (rows === null) return <p className="muted">{t('loading')}</p>;
  if (rows.length === 0) return <p className="muted">{t('cat.evNobody')}</p>;

  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>{t('bk.name')}</th>
          <th>{t('ev.phone')}</th>
          <th>{t('bk.email')}</th>
          <th>{t('ev.seats')}</th>
          <th>{t('pr.price')}</th>
          <th>{t('staff.status')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.guestName}</td>
            <td>{r.guestPhone || '—'}</td>
            <td>{r.guestEmail}</td>
            <td>{r.seats}</td>
            <td>{r.amountCents > 0 ? money(r.amountCents) : '—'}</td>
            <td>{r.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
