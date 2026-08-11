import { z } from 'zod';

const ARABIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/**
 * Accept common Kuwait telephone formats and store one compact E.164 value.
 * CITRA's current plan assigns eight-digit fixed numbers under 2 and mobile
 * numbers under 41, 5, 6 and 9.
 */
export function normalizeKuwaitiPhone(input: string): string | null {
  let value = input
    .replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGITS[digit])
    .replace(/[\s().-]/g, '');

  if (value.startsWith('00965')) value = value.slice(5);
  else if (value.startsWith('+965')) value = value.slice(4);
  else if (value.startsWith('965') && value.length === 11) value = value.slice(3);

  return /^(?:[2569]\d{7}|41\d{6})$/.test(value) ? `+965${value}` : null;
}

export const kuwaitPhoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .transform((value, ctx) => {
    const normalized = normalizeKuwaitiPhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid 8-digit Kuwait phone number.',
      });
      return z.NEVER;
    }
    return normalized;
  });
