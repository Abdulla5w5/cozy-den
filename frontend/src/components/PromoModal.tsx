import { useEffect, useState } from 'react';
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

  return (
    <div className="promo-backdrop" role="dialog" aria-modal="true" onClick={close}>
      <div className="promo-card" onClick={(e) => e.stopPropagation()}>
        <button className="promo-x" onClick={close} aria-label={t('promo.close')}>
          ✕
        </button>
        {promo.image_url && <img className="promo-img" src={promo.image_url} alt={promo.text} />}
        {promo.link_url && (
          <div className="promo-body">
            {isInternal ? (
              <Link to={promo.link_url} className="cta button promo-cta" onClick={close}>
                {promo.link_label || t('ev.seeAll')}
              </Link>
            ) : (
              <a
                href={promo.link_url}
                target="_blank"
                rel="noopener noreferrer"
                className="cta button promo-cta"
                onClick={close}
              >
                {promo.link_label || t('ev.seeAll')}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
