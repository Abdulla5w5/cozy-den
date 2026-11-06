import { query } from '../../db/pool';
import { ApiError } from '../../middleware/error';
import type { DayPrices } from '../../utils/pricing';

/**
 * Promo codes and their prices (migration 052). Admins build named price sets,
 * and each code picks one. Codes are matched case-insensitively and stored
 * upper-case, and a booking takes one code at most.
 *
 * A code's kind says who may use it:
 *  - group: a party of at least `minParty`.
 *  - newcomer: a signed-in, verified member's first booking. Not for guests,
 *    who cannot be told apart from returning customers. Always on a percentage
 *    price, since the site banner advertises the percentage.
 */
export type CodeKind = 'group' | 'newcomer';

export interface PriceSet extends DayPrices {
  id: number;
  name: string;
  kind: 'hourly' | 'percent';
  percentOff: number | null;
}

export interface PromoCode {
  id: number;
  code: string;
  kind: CodeKind;
  minParty: number;
  isActive: boolean;
  priceSetId: number;
  priceSetName: string;
  percentOff: number | null;
  /** The set's hourly prices; null for a percentage set. */
  hourly: DayPrices | null;
}

interface SetRow {
  price_set_id: number;
  set_name: string;
  set_kind: 'hourly' | 'percent';
  percent_off: number | null;
  sunwed_cents: number | null;
  sunwed_extra_cents: number | null;
  thufri_cents: number | null;
  thufri_extra_cents: number | null;
  sat_cents: number | null;
  sat_extra_cents: number | null;
}

interface Row extends SetRow {
  id: number;
  code: string;
  kind: CodeKind;
  min_party: number;
  is_active: boolean;
}

const SET_COLUMNS = `s.id AS price_set_id, s.name AS set_name, s.kind AS set_kind, s.percent_off,
  s.sunwed_cents, s.sunwed_extra_cents, s.thufri_cents, s.thufri_extra_cents,
  s.sat_cents, s.sat_extra_cents`;

const CODE_SELECT = `SELECT c.id, c.code, c.kind, c.min_party, c.is_active, ${SET_COLUMNS}
  FROM promo_codes c JOIN promo_price_sets s ON s.id = c.price_set_id`;

const toDayPrices = (r: SetRow): DayPrices => ({
  sunWedCents: r.sunwed_cents,
  sunWedExtraCents: r.sunwed_extra_cents,
  thuFriCents: r.thufri_cents,
  thuFriExtraCents: r.thufri_extra_cents,
  satCents: r.sat_cents,
  satExtraCents: r.sat_extra_cents,
});

const toCode = (r: Row): PromoCode => ({
  id: r.id,
  code: r.code,
  kind: r.kind,
  minParty: r.min_party,
  isActive: r.is_active,
  priceSetId: r.price_set_id,
  priceSetName: r.set_name,
  percentOff: r.percent_off,
  hourly: r.set_kind === 'hourly' ? toDayPrices(r) : null,
});

export const normalizeCode = (code: string) => code.trim().toUpperCase();

export async function findActiveCode(code: string): Promise<PromoCode | null> {
  const { rows } = await query<Row>(
    `${CODE_SELECT} WHERE c.code = $1 AND c.is_active`,
    [normalizeCode(code)],
  );
  return rows[0] ? toCode(rows[0]) : null;
}

/** The newest active newcomer code, for the site banner; null when off. */
export async function activeNewcomerCode(): Promise<PromoCode | null> {
  const { rows } = await query<Row>(
    `${CODE_SELECT}
      WHERE c.kind = 'newcomer' AND c.is_active AND s.kind = 'percent'
      ORDER BY c.created_at DESC LIMIT 1`,
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
    `${CODE_SELECT} ORDER BY c.created_at DESC`,
  );
  return rows.map(toCode);
}

const NEWCOMER_NEEDS_PERCENT =
  'A new member code needs a percentage price, because the site banner advertises it.';

export async function createCode(
  code: string,
  kind: CodeKind,
  minParty: number,
  priceSetId: number,
): Promise<void> {
  if (kind === 'newcomer') {
    const { rows } = await query(
      `SELECT 1 FROM promo_price_sets WHERE id = $1 AND kind <> 'percent'`,
      [priceSetId],
    );
    if (rows.length > 0) throw new ApiError(409, NEWCOMER_NEEDS_PERCENT);
  }
  try {
    await query(
      'INSERT INTO promo_codes (code, kind, min_party, price_set_id) VALUES ($1, $2, $3, $4)',
      [normalizeCode(code), kind, kind === 'newcomer' ? 1 : minParty, priceSetId],
    );
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === '23505') throw new ApiError(409, 'That code already exists.');
    if (e.code === '23503') throw new ApiError(400, 'Pick a code price for this code.');
    throw err;
  }
}

/** Switch a code on or off, or move it to another price set. */
export async function updateCode(
  id: number,
  changes: { isActive?: boolean; priceSetId?: number },
): Promise<boolean> {
  if (changes.priceSetId !== undefined) {
    const { rows } = await query(
      `SELECT 1 FROM promo_codes c, promo_price_sets s
        WHERE c.id = $1 AND s.id = $2 AND c.kind = 'newcomer' AND s.kind <> 'percent'`,
      [id, changes.priceSetId],
    );
    if (rows.length > 0) throw new ApiError(409, NEWCOMER_NEEDS_PERCENT);
  }
  try {
    const { rowCount } = await query(
      `UPDATE promo_codes
          SET is_active = COALESCE($2, is_active),
              price_set_id = COALESCE($3, price_set_id),
              updated_at = now()
        WHERE id = $1`,
      [id, changes.isActive ?? null, changes.priceSetId ?? null],
    );
    return (rowCount ?? 0) > 0;
  } catch (err) {
    if ((err as { code?: string }).code === '23503') {
      throw new ApiError(400, 'That code price no longer exists.');
    }
    throw err;
  }
}

export async function deleteCode(id: number): Promise<boolean> {
  const { rowCount } = await query('DELETE FROM promo_codes WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

// ---------- Code prices ----------

export async function listPriceSets(): Promise<PriceSet[]> {
  const { rows } = await query<SetRow>(
    `SELECT ${SET_COLUMNS} FROM promo_price_sets s ORDER BY s.name`,
  );
  return rows.map((r) => ({
    id: r.price_set_id,
    name: r.set_name,
    kind: r.set_kind,
    percentOff: r.percent_off,
    ...toDayPrices(r),
  }));
}

export type PriceSetInput = Omit<PriceSet, 'id'>;

const setValues = (s: PriceSetInput) => [
  s.name,
  s.kind,
  s.kind === 'percent' ? s.percentOff : null,
  s.kind === 'hourly' ? s.sunWedCents : null,
  s.kind === 'hourly' ? s.sunWedExtraCents : null,
  s.kind === 'hourly' ? s.thuFriCents : null,
  s.kind === 'hourly' ? s.thuFriExtraCents : null,
  s.kind === 'hourly' ? s.satCents : null,
  s.kind === 'hourly' ? s.satExtraCents : null,
];

function nameTaken(err: unknown): never {
  if ((err as { code?: string }).code === '23505') {
    throw new ApiError(409, 'A code price with that name already exists.');
  }
  throw err;
}

export async function createPriceSet(s: PriceSetInput): Promise<void> {
  try {
    await query(
      `INSERT INTO promo_price_sets
         (name, kind, percent_off, sunwed_cents, sunwed_extra_cents,
          thufri_cents, thufri_extra_cents, sat_cents, sat_extra_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      setValues(s),
    );
  } catch (err) {
    nameTaken(err);
  }
}

export async function updatePriceSet(id: number, s: PriceSetInput): Promise<boolean> {
  if (s.kind !== 'percent') {
    const { rows } = await query(
      `SELECT 1 FROM promo_codes WHERE price_set_id = $1 AND kind = 'newcomer' LIMIT 1`,
      [id],
    );
    if (rows.length > 0) throw new ApiError(409, NEWCOMER_NEEDS_PERCENT);
  }
  try {
    const { rowCount } = await query(
      `UPDATE promo_price_sets
          SET name = $2, kind = $3, percent_off = $4,
              sunwed_cents = $5, sunwed_extra_cents = $6,
              thufri_cents = $7, thufri_extra_cents = $8,
              sat_cents = $9, sat_extra_cents = $10, updated_at = now()
        WHERE id = $1`,
      [id, ...setValues(s)],
    );
    return (rowCount ?? 0) > 0;
  } catch (err) {
    nameTaken(err);
  }
}

/** Delete a set, unless a code still uses it. */
export async function deletePriceSet(id: number): Promise<boolean> {
  try {
    const { rowCount } = await query('DELETE FROM promo_price_sets WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  } catch (err) {
    if ((err as { code?: string }).code === '23503') {
      throw new ApiError(409, 'A promo code still uses this price. Move or delete that code first.');
    }
    throw err;
  }
}
