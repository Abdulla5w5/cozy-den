import type { Lang } from './i18n';

/** A YYYY-MM-DD day in the site's language (not the device's), with Western
 *  digits like the prices, e.g. "Sat, 28 Nov 2026". */
export function formatDay(iso: string, lang: Lang): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(lang === 'ar' ? 'ar-KW-u-ca-gregory-nu-latn' : 'en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}
