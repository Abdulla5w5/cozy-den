import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

/**
 * About Us — static by design. Structure and layout only; the copy is
 * placeholder until the real text is supplied, and every string goes through
 * i18n so replacing it is an edit in one file rather than a rebuild of this
 * page. No editor or CMS at this stage.
 */
export function AboutPage() {
  const { t } = useI18n();

  return (
    <div>
      <header className="page-header left">
        <span className="eyebrow">{t('about.eyebrow')}</span>
        <h1>{t('about.title')}</h1>
        <p className="muted">{t('about.sub')}</p>
      </header>

      <section className="section">
        <div className="section-head">
          <h2 className="sec-primary">{t('about.storyTitle')}</h2>
          <div className="rule" />
        </div>
        <p>{t('about.storyBody')}</p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="sec-primary">{t('about.conceptTitle')}</h2>
          <div className="rule" />
        </div>
        <p>{t('about.conceptBody')}</p>
      </section>

      <section className="section">
        <div className="feature-grid">
          {['games', 'food', 'people'].map((k) => (
            <div className="feature-card" key={k}>
              <h3>{t(`about.pillar.${k}`)}</h3>
              <p className="muted">{t(`about.pillar.${k}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="sec-primary">{t('about.visitTitle')}</h2>
          <div className="rule" />
        </div>
        <p className="muted">{t('about.visitBody')}</p>
        <Link to="/book" className="cta button" style={{ marginTop: '1rem' }}>
          {t('home.book')}
        </Link>
      </section>
    </div>
  );
}
