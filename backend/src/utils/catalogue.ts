import { z } from 'zod';
import { query } from '../db/pool';
import { ApiError } from '../middleware/error';

/**
 * Shared pieces for the staff-editable catalogues (games and menu items), so
 * the two behave identically rather than drifting apart.
 */

/**
 * Accept an absolute URL (https://…) or a root-relative path (/events). Also
 * refuses javascript: and data: by only allowing those two shapes — the same
 * validator the events and promo editors use.
 */
export const linkish = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (v) => v === '' || v.startsWith('/') || /^https?:\/\//i.test(v),
      'must be a URL or a /path',
    )
    .nullable()
    .optional();

export interface RemoveOptions {
  table: 'games' | 'menu_items';
  /** Column that hides the row from customers without destroying it. */
  retireColumn?: string;
  id: number;
  notFound: string;
  /** Queries that return a row if something still points at this record. */
  references: { sql: string }[];
}

export interface RemoveResult {
  ok: true;
  /** 'deleted' — nothing referenced it. 'retired' — hidden, history kept. */
  outcome: 'deleted' | 'retired';
}

/**
 * Remove a catalogue row as safely as the data allows.
 *
 * Events can simply be deleted: nothing points at them. Games and menu items
 * are different — a past booking, a past order or a customer's play history
 * can reference them, and a plain DELETE would either fail on a foreign key or,
 * worse, cascade and silently erase that history.
 *
 * So: delete only when genuinely unreferenced, which makes a mistyped entry
 * disappear properly; otherwise retire it, which takes it off the customer-
 * facing lists while every record pointing at it stays intact. The caller is
 * told which happened so the UI can say so plainly.
 */
export async function removeOrRetire(opts: RemoveOptions): Promise<RemoveResult> {
  const retireColumn = opts.retireColumn ?? (opts.table === 'games' ? 'is_active' : 'available');

  const { rows: exists } = await query('SELECT 1 FROM ' + opts.table + ' WHERE id = $1', [opts.id]);
  if (!exists[0]) throw new ApiError(404, opts.notFound);

  for (const ref of opts.references) {
    const { rows } = await query(ref.sql, [opts.id]);
    if (rows[0]) {
      await query(`UPDATE ${opts.table} SET ${retireColumn} = FALSE WHERE id = $1`, [opts.id]);
      return { ok: true, outcome: 'retired' };
    }
  }

  await query(`DELETE FROM ${opts.table} WHERE id = $1`, [opts.id]);
  return { ok: true, outcome: 'deleted' };
}
