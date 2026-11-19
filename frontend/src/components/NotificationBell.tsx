import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';

interface Notice {
  id: number;
  kind: string;
  data: Record<string, string | number | boolean | null>;
  link: string | null;
  createdAt: string;
  read: boolean;
}

// The badge is a cheap count, checked every 5 minutes while the tab is visible
// (and when the tab comes back into view). Guests on the café Wi-Fi share one
// IP's request budget, so the bell must stay a small part of it.
const POLL_MS = 5 * 60_000;

function timeAgo(iso: string, lang: string): string {
  const diffSec = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang === 'ar' ? 'ar' : 'en', { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}

/**
 * The header bell: an unread badge and a list of the member's latest notices.
 * Opening the list marks everything read; notices that were unread at that
 * moment stay highlighted until it closes.
 */
export function NotificationBell({ authKey }: { authKey: number }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    api
      .get<{ unread: number }>('/notifications/unread')
      .then((r) => setUnread(r.unread))
      .catch(() => {
        /* the badge just stays as it was */
      });
  }, []);

  useEffect(() => {
    refreshCount();
    const id = window.setInterval(refreshCount, POLL_MS);
    document.addEventListener('visibilitychange', refreshCount);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refreshCount);
    };
  }, [refreshCount, authKey]);

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setFailed(false);
    try {
      const r = await api.get<{ notifications: Notice[]; unread: number }>('/notifications');
      setNotices(r.notifications);
      // Only what was shown: a notice that arrives meanwhile stays unread.
      const shown = r.notifications.filter((n) => !n.read).map((n) => n.id);
      if (shown.length > 0) {
        await api.post('/notifications/read', { ids: shown });
        setUnread(Math.max(0, r.unread - shown.length));
      }
    } catch {
      setFailed(true);
    }
  }

  function text(n: Notice, part: 'title' | 'body'): string {
    const key = `notif.${n.kind}.${part}`;
    const vars = Object.fromEntries(
      Object.entries(n.data).map(([k, v]) => [k, v === null ? '' : String(v)]),
    );
    const s = t(key, vars);
    if (s !== key) return s;
    return part === 'title' ? t('notif.generic') : '';
  }

  function openNotice(n: Notice) {
    setOpen(false);
    if (n.link && n.link.startsWith('/')) navigate(n.link);
  }

  const label = unread > 0 ? `${t('notif.title')} — ${t('notif.unread', { n: unread })}` : t('notif.title');

  return (
    <div className="notif" ref={wrapRef}>
      <button
        type="button"
        className="notif-button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M12 3a6 6 0 0 0-6 6v3.6L4.3 15.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Zm0 18a2.6 2.6 0 0 0 2.5-2h-5A2.6 2.6 0 0 0 12 21Z"
            fill="currentColor"
          />
        </svg>
        {unread > 0 && (
          <span className="notif-badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label={t('notif.title')}>
          <p className="notif-heading">{t('notif.title')}</p>
          {failed ? (
            <p className="notif-empty">{t('notif.failed')}</p>
          ) : notices === null ? (
            <p className="notif-empty">{t('loading')}</p>
          ) : notices.length === 0 ? (
            <p className="notif-empty">{t('notif.empty')}</p>
          ) : (
            <ul className="notif-list">
              {notices.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`notif-item${n.read ? '' : ' is-new'}`}
                    onClick={() => openNotice(n)}
                  >
                    <span className="notif-item-title">{text(n, 'title')}</span>
                    {text(n, 'body') && <span className="notif-item-body">{text(n, 'body')}</span>}
                    <span className="notif-item-time">{timeAgo(n.createdAt, lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
