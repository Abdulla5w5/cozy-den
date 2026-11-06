import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';

/**
 * Pop-up card advertising the newcomer code (the café's list, item 31): a
 * percentage off a new member's first booking. Slides up from the bottom a
 * moment after the page loads, so it never fights the welcome pop-up for
 * attention, and stays closed once dismissed on this browser. The server
 * leaves it out when staff switch the code off, and for a member who has
 * booked before.
 */
const DISMISS_KEY = 'cd_newcomer_dismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function NewcomerBanner({ loggedIn, authKey }: { loggedIn: boolean; authKey: number }) {
  const { t } = useI18n();
  const { pathname, search } = useLocation();
  const [offer, setOffer] = useState<{ code: string; percentOff: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(wasDismissed);

  useEffect(() => {
    if (dismissed) return;
    let active = true;
    api
      .get<{ offer: { code: string; percentOff: number } | null }>('/bookings/newcomer-offer')
      .then((r) => active && setOffer(r.offer))
      .catch(() => active && setOffer(null));
    return () => {
      active = false;
    };
  }, [dismissed, authKey]);

  useEffect(() => {
    if (!offer) return;
    const timer = window.setTimeout(() => setOpen(true), 2500);
    return () => window.clearTimeout(timer);
  }, [offer]);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  // Not on staff pages, over the checkout it points to, or over a QR pass.
  if (
    dismissed ||
    !offer ||
    !open ||
    pathname.startsWith('/staff') ||
    pathname.startsWith('/c/') ||
    pathname.startsWith('/confirmation/') ||
    /[?&](seat|reserve|pass|next)=/.test(search) ||
    pathname === '/book'
  ) {
    return null;
  }

  return (
    <aside className="newcomer-banner" role="dialog" aria-label={t('nc.title')}>
      <button className="newcomer-x" onClick={dismiss} aria-label={t('promo.close')}>
        ✕
      </button>
      <strong>{t('nc.title')}</strong>
      <p>
        {t('nc.text', { code: offer.code, n: String(offer.percentOff) })}
      </p>
      <div className="newcomer-actions">
        <Link className="cta button" to={loggedIn ? '/book' : '/register'} onClick={dismiss}>
          {loggedIn ? t('nc.book') : t('nc.signUp')}
        </Link>
        <code dir="ltr">{offer.code}</code>
      </div>
    </aside>
  );
}
