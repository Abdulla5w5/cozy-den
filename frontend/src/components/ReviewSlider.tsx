import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { GUEST_REVIEWS } from './reviews';

// The landing page's guest reviews: a row of compact cards — three across on a
// desktop, two on a tablet, one on a phone — that scrolls sideways. A swipe or
// trackpad scrolls it natively (snapping to a card); the arrows move it one
// card at a time. Long reviews are cut to a few lines with "Read more", so
// every card stays about the same size.

const ACCENTS = ['yellow', 'orange', 'blue', 'red'] as const;
// Past this length the card shows a "Read more" (the text is clamped by CSS).
const LONG_REVIEW = 230;
// The café on Google Maps (the same link as the footer's), where the rest of
// the reviews are.
const MAPS_URL = 'https://maps.app.goo.gl/trvMLY888ZiGpdpQ7';

export function ReviewSlider() {
  const { t, lang } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const rtl = lang === 'ar';

  // Enable or disable the arrows at either end of the row.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () => {
      // In RTL, scrollLeft runs from 0 down to negative values.
      const pos = Math.abs(track.scrollLeft);
      const max = track.scrollWidth - track.clientWidth;
      setEdges({ start: pos < 4, end: pos > max - 4 });
    };
    update();
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      track.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [lang]);

  if (GUEST_REVIEWS.length === 0) return null;

  const scrollByCard = (dir: 1 | -1) => {
    const track = trackRef.current;
    const card = track?.querySelector<HTMLElement>('.review-card');
    if (!track || !card) return;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    // "Forward" is leftward in Arabic.
    const step = (card.offsetWidth + gap) * dir * (rtl ? -1 : 1);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollBy({ left: step, behavior: smooth ? 'smooth' : 'auto' });
  };

  return (
    <section className="section reviews-section">
      <div className="section-head">
        <div>
          <span className="section-kicker">{t('rv.kicker')}</span>
          <h2>{t('rv.title')}</h2>
        </div>
        <div className="review-nav">
          <a className="ghost button review-all" href={MAPS_URL} target="_blank" rel="noopener noreferrer">
            {t('rv.all')} <span aria-hidden="true">↗</span>
          </a>
          <button
            type="button"
            className="review-arrow"
            onClick={() => scrollByCard(-1)}
            disabled={edges.start}
            aria-label={t('rv.prev')}
          >
            <span aria-hidden="true">{rtl ? '→' : '←'}</span>
          </button>
          <button
            type="button"
            className="review-arrow"
            onClick={() => scrollByCard(1)}
            disabled={edges.end}
            aria-label={t('rv.next')}
          >
            <span aria-hidden="true">{rtl ? '←' : '→'}</span>
          </button>
        </div>
      </div>

      <div className="review-track" ref={trackRef} role="list" aria-label={t('rv.title')}>
        {GUEST_REVIEWS.map((r, i) => {
          const long = r.text.length > LONG_REVIEW;
          const expanded = open === r.author;
          return (
            <figure
              key={r.author}
              role="listitem"
              className={`review-card review-${ACCENTS[i % ACCENTS.length]}`}
            >
              <div className="review-top">
                <span className="review-badge" aria-hidden="true">“</span>
                <figcaption>
                  <span className="review-author" dir="auto">
                    {r.author}
                  </span>
                  <span className="review-source">
                    {r.localGuide ? `${t('rv.localGuide')} · ` : ''}
                    {t('rv.onGoogle')}
                  </span>
                </figcaption>
              </div>
              <blockquote dir="ltr" lang="en" className={long && !expanded ? 'is-clamped' : ''}>
                {r.text}
              </blockquote>
              {long && (
                <button type="button" className="review-more" onClick={() => setOpen(expanded ? null : r.author)}>
                  {expanded ? t('rv.less') : t('rv.more')}
                </button>
              )}
              {r.scores && (
                <div className="review-scores">
                  <span>{t('rv.food')} {r.scores.food}/5</span>
                  <span>{t('rv.service')} {r.scores.service}/5</span>
                  <span>{t('rv.atmosphere')} {r.scores.atmosphere}/5</span>
                </div>
              )}
            </figure>
          );
        })}
      </div>
    </section>
  );
}
