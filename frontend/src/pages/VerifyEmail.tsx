import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';

/** Result page the verification link redirects to (?status=ok|invalid). */
export function VerifyEmail() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const ok = params.get('status') === 'ok';

  return (
    <div className="card narrow confirmation">
      <div className="check">{ok ? '✅' : '⚠️'}</div>
      <h2>{ok ? t('verify.okTitle') : t('verify.badTitle')}</h2>
      <p className="muted">{ok ? t('verify.okBody') : t('verify.badBody')}</p>
      <Link to="/" className="cta button">
        {t('verify.home')}
      </Link>
    </div>
  );
}
