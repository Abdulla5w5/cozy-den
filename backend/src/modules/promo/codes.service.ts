import { query } from '../../db/pool';
import { ApiError } from '../../middleware/error';

/**
 * Promo codes, two kinds. Codes are matched case-insensitively and stored
 * upper-case, and a booking takes one code at most.
 *  - group (the café's list, item 30): a party of at least `minParty` pays the
 *    group prices — see getGroupFee in utils/pricing.
 *  - newcomer (item 31): `percentOff` off a signed-in member's first booking.
 *    Not for guests, who cannot be told apart from returning customers.
 */
export type CodeKind = 'group' | 'newcomer';

export interface PromoCode {
  id: number;
  code: string;
  kind: CodeKind;
  minParty: number;
  percentOff: number | null;
  isActive: boolean;
}

interface Row {
  id: number;
  code: string;
  kind: CodeKind;
  min_party: number;
  percent_off: number | null;
  is_active: boolean;
}

const COLUMNS = 'id, code, kind, min_party, percent_off, is_active';

const toCode = (r: Row): PromoCode => ({
  id: r.id,
  code: r.code,
  kind: r.kind,
  minParty: r.min_party,
  percentOff: r.percent_off,
  isActive: r.is_active,
});

export const normalizeCode = (code: string) => code.trim().toUpperCase();

export async function findActiveCode(code: string): Promise<PromoCode | null> {
  const { rows } = await query<Row>(
    `SELECT ${COLUMNS} FROM promo_codes WHERE code = $1 AND is_active`,
    [normalizeCode(code)],
  );
  return rows[0] ? toCode(rows[0]) : null;
}

/** The newest active newcomer code, for the site banner; null when off. */
export async function activeNewcomerCode(): Promise<PromoCode | null> {
  const { rows } = await query<Row>(
    `SELECT ${COLUMNS} FROM promo_codes
      WHERE kind = 'newcomer' AND is_active
      ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0] ? toCode(rows[0]) : null;
}

/**
 * Has this customer a paid booking already, under the account's email or the
 * phone they are booking with (a guest booking has only the phone)? A hold
 * still being paid for does not count — two newcomer checkouts at once are
 * stopped by the database instead (migration 045).
 */
export async function hasBookedBefore(email: string, phone?: string | null): Promise<boolean> {
  const { rows } = await query(
    `SELECT 1 FROM bookings
      WHERE (lower(guest_email) = lower($1) OR ($2::text IS NOT NULL AND guest_phone = $2))
        AND status NOT IN ('pending_payment', 'cancelled')
      LIMIT 1`,
    [email, phone ?? null],
  );
  return rows.length > 0;
}

/** Why a code was refused: the page shows its own message for each. */
export type RefusalCode = 'sign_in' | 'verify_email' | 'first_only' | 'party_size';

export interface Refusal {
  code: RefusalCode;
  message: string;
}

/** Why a code cannot be used for this booking, or null when it can. */
export async function codeRefusal(
  found: PromoCode,
  partySize: number,
  account: { sub: number; email: string } | undefined,
  phone?: string | null,
): Promise<Refusal | null> {
  if (found.kind === 'newcomer') {
    if (!account) {
      return { code: 'sign_in', message: 'Sign in to use this code. It is for new members.' };
    }
    // An unverified address costs nothing to make up, and would hand the
    // discount to anyone willing to sign up again.
    const { rows } = await query<{ email_verified: boolean }>(
      'SELECT email_verified FROM users WHERE id = $1',
      [account.sub],
    );
    if (!rows[0]?.email_verified) {
      return { code: 'verify_email', message: 'Verify your email to use this code.' };
    }
    if (await hasBookedBefore(account.email, phone)) {
      return { code: 'first_only', message: 'This code is for your first booking only.' };
    }
    return null;
  }
  if (partySize < found.minParty) {
    return {
      code: 'party_size',
      message: `That promo code is for groups of ${found.minParty} or more.`,
    };
  }
  return null;
}

/**
 * The code a booking may use, or null when none was given. A bad code is
 * refused rather than ignored: the customer was shown the lower price, and
 * charging the normal one without saying so would be worse than an error.
 */
export async function resolvePromoCode(
  code: string | undefined,
  partySize: number,
  account: { sub: number; email: string } | undefined,
  phone: string,
): Promise<PromoCode | null> {
  if (!code || !code.trim()) return null;
  const found = await findActiveCode(code);
  if (!found) throw new ApiError(400, 'That promo code is not valid.');
  const refusal = await codeRefusal(found, partySize, account, phone);
  if (refusal) throw new ApiError(400, refusal.message);
  return found;
}

export async function listCodes(): Promise<PromoCode[]> {
  const { rows } = await query<Row>(
    `SELECT ${COLUMNS} FROM promo_codes ORDER BY created_at DESC`,
  );
  return rows.map(toCode);
}

export async function createCode(code: string, minParty: number): Promise<void> {
  try {
    await query('INSERT INTO promo_codes (code, min_party) VALUES ($1, $2)', [
      normalizeCode(code),
      minParty,
    ]);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ApiError(409, 'That code already exists.');
    }
    throw err;
  }
}

export async function setCodeActive(id: number, isActive: boolean): Promise<boolean> {
  const { rowCount } = await query(
    'UPDATE promo_codes SET is_active = $2, updated_at = now() WHERE id = $1',
    [id, isActive],
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteCode(id: number): Promise<boolean> {
  const { rowCount } = await query('DELETE FROM promo_codes WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}
