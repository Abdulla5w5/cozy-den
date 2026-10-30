/** Mirrors normalizeKuwaitiPhone in backend/src/utils/phone.ts: an 8-digit
 *  Kuwait number, with or without +965 / 00965, in Western or Arabic digits.
 *  The server is the judge; this lets a form say so before it submits. */
export function isKuwaitPhone(value: string) {
  const western = value.replace(/[٠-٩۰-۹]/g, (digit) =>
    String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) % 10),
  );
  const digits = western.replace(/\D/g, '').replace(/^(?:00965|965)/, '');
  return /^(?:[2569]\d{7}|41\d{6})$/.test(digits);
}
