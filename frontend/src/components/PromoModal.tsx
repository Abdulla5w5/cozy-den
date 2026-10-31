import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';
import { Promo } from '../types';

const SEEN_KEY = 'cd_promo_seen';

// sessionStorage can throw (private mode / sandboxed iframes) — never let the
// popup break the page.
function seenThisSession(id: number): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === String(id);
  } catch {
    return false;
  }
}
function markSeen(id: number) {
  try {
    sessionStorage.setItem(SEEN_KEY, String(id));
  } catch {
    /* ignore */
  }
}

/** Entry popup: the active promo, shown once per browser session. */
export function PromoModal() {
  const { t } = useI18n();
  const [promo, setPromo] = useState<Promo | null>(null);

  useEffect(() => {
    api
      .get<{ promo: Promo | null }>('/promo')
      .then((r) => {
        if (r.promo && !seenThisSession(r.promo.id)) setPromo(r.promo);
      })
      .catch(() => {});
  }, []);

  if (!promo) return null;

  const close = () => {
    markSeen(promo.id);
    setPromo(null);
  };

  const isInternal = promo.link_url?.startsWith('/');

  // Portalled to <body>: a position:fixed element is positioned against its
  // nearest ancestor with a transform/filter/backdrop-filter, and the app shell
  // has several. Rendering at the body root removes that whole class of bug —
  // which matters most on iOS Safari, where it bites hardest.
  return createPortal(
    <div className="promo-backdrop" role="dialog" aria-modal="true" onClick={close}>
      {/* A landscape rectangle: the artwork whole on one side (it is usually a
          square poster with its own text, so it is never cropped or written
          over), the headline and the button on the other. Stacks on a phone. */}
      <div
        className={`promo-card ${promo.image_url ? 'has-media' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="promo-x" onClick={close} aria-label={t('promo.close')}>
          ✕
        </button>
        {promo.image_url && (
          <div className="promo-media">
            <img src={promo.image_url} alt="" />
          </div>
        )}
        <div className="promo-content">
          <span className="promo-label">{t('promo.kicker')}</span>
          {promo.text && <h2 className="promo-heading">{promo.text}</h2>}
          {promo.link_url &&
            (isInternal ? (
              <Link to={promo.link_url} className="cta button promo-go" onClick={close}>
                {promo.link_label || t('ev.seeAll')}
              </Link>
            ) : (
              <a
                href={promo.link_url}
                target="_blank"
                rel="noopener noreferrer"
                className="cta button promo-go"
                onClick={close}
              >
                {promo.link_label || t('ev.seeAll')}
              </a>
            ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
