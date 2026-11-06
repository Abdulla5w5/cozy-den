import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n';

/**
 * Home page: "Private Board Game Host" (the café's own wording, Nov 2026).
 * The rules as game tokens, the two host options as cards, and the way in.
 * Customers choose an option, not a person, so no names here. Only shown once
 * an option can actually be booked — advertising a service nobody can book
 * would just send people to a picker with nothing in it.
 */
interface HostOption {
  kind: 'normal' | 'clocktower';
  hourlyCents: number;
}

const TILTS: Record<HostOption['kind'], number> = { normal: -4, clocktower: 4 };

export function HostSection() {
  const { t, money } = useI18n();
  const [options, setOptions] = useState<HostOption[]>([]);

  useEffect(() => {
    api
      .getCached<{ options: HostOption[] }>('/hosts')
      .then((r) => setOptions(r.options))
      .catch(() => setOptions([]));
  }, []);

  if (options.length === 0) return null;
  const from = Math.min(...options.map((o) => o.hourlyCents));

  return (
    <section className="section host-section">
      <div className="host-section-copy">
        <span className="section-kicker">{t('hp.kicker')}</span>
        <h2>{t('hp.title')}</h2>
        <p className="host-section-sub">{t('hp.sub')}</p>
        <ul className="host-tokens">
          <li>
            <span aria-hidden="true">🧑‍🤝‍🧑</span>
            {t('hp.fromOne')}
          </li>
          <li>
            <span aria-hidden="true">⏳</span>
            {t('hp.minTwo')}
          </li>
          <li>
            <span aria-hidden="true">📅</span>
            {t('hp.notice')}
          </li>
          <li className="price">
            <span aria-hidden="true">🪙</span>
            {t('hp.from', { amount: money(from) })}
          </li>
        </ul>
        <Link to="/book" className="cta button">
          {t('hp.cta')} <span aria-hidden="true">→</span>
        </Link>
        <p className="host-section-how">{t('hp.how')}</p>
      </div>

      <div className="host-hand" aria-label={t('hp.options')}>
        {options.map((o) => (
          <article
            className="host-tcg"
            key={o.kind}
            style={{ ['--tilt' as string]: `${TILTS[o.kind]}deg` }}
          >
            <div className={`host-tcg-art ${o.kind}`}>
              <span aria-hidden="true">{o.kind === 'clocktower' ? '🕰️' : '🎲'}</span>
            </div>
            <strong>{t(`host.kind.${o.kind}`)}</strong>
            <p>{t('host.wholeTable')}</p>
            <span className="host-tcg-rate">{t('host.rate', { amount: money(o.hourlyCents) })}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
