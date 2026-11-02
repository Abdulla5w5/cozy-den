import { query } from '../../db/pool';
import { ApiError } from '../../middleware/error';

/**
 * Group promo codes (the café's list, item 30): a party of at least
 * `minParty` with an active code pays the group prices — see getGroupFee in
 * utils/pricing. Codes are matched case-insensitively and stored upper-case.
 */
export interface PromoCode {
  id: number;
  code: string;
  minParty: number;
  isActive: boolean;
}

interface Row {
  id: number;
  code: string;
  min_party: number;
  is_active: boolean;
}

const toCode = (r: Row): PromoCode => ({
  id: r.id,
  code: r.code,
  minParty: r.min_party,
  isActive: r.is_active,
});

export const normalizeCode = (code: string) => code.trim().toUpperCase();

export async function findActiveCode(code: string): Promise<PromoCode | null> {
  const { rows } = await query<Row>(
    'SELECT id, code, min_party, is_active FROM promo_codes WHERE code = $1 AND is_active',
    [normalizeCode(code)],
  );
  return rows[0] ? toCode(rows[0]) : null;
}

/**
 * The code a booking may use, or null when none was given. A bad code is
 * refused rather than ignored: the customer was shown the group price, and
 * charging the normal one without saying so would be worse than an error.
 */
export async function resolvePromoCode(
  code: string | undefined,
  partySize: number,
): Promise<string | null> {
  if (!code || !code.trim()) return null;
  const found = await findActiveCode(code);
  if (!found) throw new ApiError(400, 'That promo code is not valid.');
  if (partySize < found.minParty) {
    throw new ApiError(400, `That promo code is for groups of ${found.minParty} or more.`);
  }
  return found.code;
}

export async function listCodes(): Promise<PromoCode[]> {
  const { rows } = await query<Row>(
    'SELECT id, code, min_party, is_active FROM promo_codes ORDER BY created_at DESC',
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
