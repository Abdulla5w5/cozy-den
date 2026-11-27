import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';

const NUDGE_KEY = 'cd_nav_nudged';

/**
 * The header's links. On a phone they are one row that scrolls sideways, so
 * when more links are off-screen the row fades out at that edge and shows an
 * arrow that scrolls it. The first visit in a tab also nudges the row once, so
 * people see that it moves.
 */
export function NavScroll({ className, children }: { className: string; children: ReactNode }) {
  const { t, dir } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const [more, setMore] = useState({ start: false, end: false });
  const { pathname } = useLocation();

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // The arrows give back the gap they would add, whatever it is at this width.
    const cs = getComputedStyle(el);
    el.style.setProperty('--nav-gap', cs.columnGap === 'normal' ? '0px' : cs.columnGap);
    el.style.setProperty('--nav-pad-start', cs.paddingInlineStart);
    el.style.setProperty('--nav-pad-end', cs.paddingInlineEnd);
    const max = el.scrollWidth - el.clientWidth;
    // In Arabic the row scrolls the other way, and scrollLeft runs negative.
    const pos = Math.abs(el.scrollLeft);
    const next = { start: max > 2 && pos > 2, end: max > 2 && pos < max - 2 };
    setMore((m) => (m.start === next.start && m.end === next.end ? m : next));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The row's own box stays the same width when links are added (signing
    // in) or fonts load, so the links themselves are watched too.
    const watch = () => Array.from(el.children).forEach((c) => ro.observe(c));
    watch();
    const mo = new MutationObserver(() => {
      watch();
      measure();
    });
    mo.observe(el, { childList: true });
    // Late web fonts change the links' widths.
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure, dir]);

  // The page's own link is scrolled into view, so the underline is never hidden.
  useEffect(() => {
    const el = ref.current;
    const active = el?.querySelector<HTMLElement>('a.active');
    if (!el || !active) return;
    const a = active.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (a.left < r.left || a.right > r.right) {
      el.scrollBy({ left: a.left - r.left - r.width / 2 + a.width / 2, behavior: 'auto' });
    }
    measure();
  }, [pathname, measure, dir]);

  // One nudge per tab, only when links really are hidden, never for people who
  // asked for less motion. Its timers are not tied to `more`, which the nudge
  // itself changes.
  const nudged = useRef(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
  useEffect(() => {
    const el = ref.current;
    if (!el || nudged.current || !more.end || more.start) return;
    nudged.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
      if (sessionStorage.getItem(NUDGE_KEY)) return;
      sessionStorage.setItem(NUDGE_KEY, '1');
    } catch {
      /* storage blocked: nudge anyway, it is harmless */
    }
    const toEnd = dir === 'rtl' ? -1 : 1;
    timers.current.push(
      window.setTimeout(() => el.scrollBy({ left: 56 * toEnd, behavior: 'smooth' }), 700),
      window.setTimeout(() => el.scrollBy({ left: -56 * toEnd, behavior: 'smooth' }), 1500),
    );
    // Someone already moving the row themselves needs no nudge.
    const stop = () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
    for (const ev of ['pointerdown', 'wheel', 'touchstart'] as const) {
      el.addEventListener(ev, stop, { once: true, passive: true });
    }
  }, [more.end, more.start, dir]);

  function scroll(toward: 'start' | 'end') {
    const el = ref.current;
    if (!el) return;
    const sign = (toward === 'end' ? 1 : -1) * (dir === 'rtl' ? -1 : 1);
    el.scrollBy({ left: sign * el.clientWidth * 0.7, behavior: 'smooth' });
  }

  return (
    <nav
      ref={ref}
      className={`${className}${more.start ? ' more-start' : ''}${more.end ? ' more-end' : ''}`}
    >
      {children}
      {/* Pointer shortcuts only: keyboard and screen-reader users reach every
          link in order already. */}
      <span className="nav-more nav-more-start" aria-hidden="true">
        <button type="button" tabIndex={-1} title={t('nav.more')} onClick={() => scroll('start')}>
          ‹
        </button>
      </span>
      <span className="nav-more nav-more-end" aria-hidden="true">
        <button type="button" tabIndex={-1} title={t('nav.more')} onClick={() => scroll('end')}>
          ›
        </button>
      </span>
    </nav>
  );
}
