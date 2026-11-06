import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { QrPass } from './QrPass';

/**
 * What happened to a payment, shown once when Tap sends the customer back
 * (?seat=paid on Our Calendar, ?reserve=paid on the Wanted Board). The server
 * has already settled the charge before redirecting, so this only reads the
 * answer from the address — no polling, no extra request. Closing it drops
 * the marker so a refresh does not show it again.
 */
type Outcome = 'paid' | 'pending' | 'review' | 'failed' | 'error';

const TONE: Record<Outcome, 'ok' | 'wait' | 'bad'> = {
  paid: 'ok',
  pending: 'wait',
  review: 'wait',
  failed: 'bad',
  error: 'bad',
};

export function PaymentReturnNotice({
  param,
  paidKey,
}: {
  /** The query parameter the return route sets. */
  param: 'seat' | 'reserve';
  /** The text for a successful payment on this page. */
  paidKey: string;
}) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const raw = params.get(param);
  if (!raw || !(raw in TONE)) return null;
  const outcome = raw as Outcome;
  // Only an uppercase reference code is shown; anything else in the address
  // is ignored rather than echoed onto the page.
  const ref = (params.get('ref') ?? '').toUpperCase();
  const safeRef = /^[A-Z0-9-]{4,32}$/.test(ref) ? ref : '';

  const text =
    outcome === 'paid' ? t(paidKey) : t(`ev.pay${outcome[0].toUpperCase()}${outcome.slice(1)}`);

  // The QR pass for a paid seat, if the return route sent one.
  const pass = params.get('pass') ?? '';
  const safePass = outcome === 'paid' && /^[A-Za-z0-9_-]{20,40}$/.test(pass) ? pass : '';

  function dismiss() {
    params.delete(param);
    params.delete('ref');
    params.delete('pass');
    setParams(params, { replace: true });
  }

  return (
    <>
    <div className={`pay-return ${TONE[outcome]}`} role="status">
      <p>
        {text}
        {safeRef && outcome !== 'failed' && (
          <>
            {' '}
            <strong>{t('ev.payRef', { ref: safeRef })}</strong>
          </>
        )}
      </p>
      <button type="button" className="pay-return-x" onClick={dismiss} aria-label={t('promo.close')}>
        ✕
      </button>
    </div>
    {safePass && <QrPass token={safePass} lines={[safeRef || 'Cozy Den']} />}
    </>
  );
}
