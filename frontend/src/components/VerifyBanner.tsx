import { useState } from 'react';
import { api } from '../api/client';
import { useI18n } from '../i18n';

/**
 * Non-blocking "please verify your email" prompt shown to signed-in customers
 * whose email isn't confirmed yet. Nothing is gated — this only nudges and
 * offers a resend.
 */
export function VerifyBanner({ email }: { email: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  async function resend() {
    setState('sending');
    try {
      await api.post('/auth/resend-verification');
      setState('sent');
    } catch {
      setState('idle');
    }
  }

  return (
    <div className="verify-banner" role="status">
      <span className="verify-banner-text">
        {t('verify.prompt', { email })}
      </span>
      <span className="verify-banner-actions">
        {state === 'sent' ? (
          <span className="verify-banner-sent">{t('verify.sent')}</span>
        ) : (
          <button className="link" onClick={resend} disabled={state === 'sending'}>
            {state === 'sending' ? t('verify.sending') : t('verify.resend')}
          </button>
        )}
        <button
          className="verify-banner-x"
          onClick={() => setDismissed(true)}
          aria-label={t('promo.close')}
        >
          ✕
        </button>
      </span>
    </div>
  );
}
