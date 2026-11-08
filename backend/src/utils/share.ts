/**
 * Shared tables (the café's list, Nov 2026). A table of this many seats or more
 * can be booked by halves, each half by a small group at the normal price per
 * person, with no table minimum. The two halves are booked independently.
 */
export const SHARE_MIN_CAPACITY = 6;
export const SHARE_PARTY_MIN = 2;
export const SHARE_PARTY_MAX = 3;

export const isShareable = (capacity: number) => capacity >= SHARE_MIN_CAPACITY;
