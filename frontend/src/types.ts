export interface Table {
  id: number;
  label: string;
  capacity: number;
}

export interface TableAvailability {
  tableId: number;
  label: string;
  capacity: number;
  freeSlots: string[];
  takenSlots: string[];
  /** Start time -> longest bookable length in minutes, given this table's day. */
  maxDuration: Record<string, number>;
}

export interface Game {
  id: number;
  title: string;
  min_players: number;
  max_players: number;
  category: string;
  description: string;
  image_url: string | null;
  purchase_url: string | null;
  is_active?: boolean;
}

export interface EventItem {
  id: number;
  title: string;
  description: string;
  event_date: string;
  event_time: string | null;
  location: string;
  type: 'internal' | 'external';
  image_url: string | null;
  is_featured: boolean;
  /** Set when the event occupies a specific table for a window. */
  table_id: number | null;
  table_label: string | null;
  start_time: string | null;
  duration_min: number | null;
  /** null = no seat limit. */
  capacity: number | null;
  seat_price_cents: number;
  seats_taken: number;
}

export interface EventReservation {
  id: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  seats: number;
  status: string;
  amountCents: number;
  code: string;
}

export interface HistoryEntry {
  id: number;
  game_id: number;
  title: string;
  category: string;
  image_url: string | null;
  played_date: string;
  booking_id: number | null;
}

export interface Promo {
  id: number;
  image_url: string | null;
  text: string;
  link_url: string | null;
  link_label: string | null;
  is_active: boolean;
}

export interface MenuItem {
  id: number;
  name: string;
  category: 'food' | 'drink';
  price_cents: number;
  description: string;
  available?: boolean;
  /** Arabic copy; empty when staff have not supplied it, so fall back to `name`. */
  name_ar?: string;
  description_ar?: string;
  /** The menu heading this sits under, e.g. "Coffee". */
  section?: string;
  section_ar?: string;
  display_order?: number;
  /** Photo path (this site's own /menu assets) — absent for items without one. */
  image_url?: string | null;
}

export interface BookingItemView {
  menuItemId: number;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface Booking {
  id: number;
  tableId: number;
  tableLabel: string;
  date: string;
  timeSlot: string;
  guestName: string;
  guestEmail: string;
  verificationCode: string;
  status: string;
  source: string;
  tableFeeCents: number;
  durationMin: number;
  partySize: number;
  totalCents: number;
  items: BookingItemView[];
  createdAt: string;
}

export interface StaffBooking {
  id: number;
  verificationCode: string;
  timeSlot: string;
  guestName: string;
  guestContact: string;
  tableLabel: string;
  status: string;
  source: string;
  totalCents: number;
  durationMin?: number;
  partySize?: number;
  items: { name: string; quantity: number }[];
}

export interface MonthlyAnalytics {
  month: string;
  bookingsCount: number;
  revenueCents: number;
  popularGames: { title: string; bookings: number }[];
  peakSlots: { timeSlot: string; bookings: number }[];
  tableUtilization: { label: string; capacity: number; bookings: number }[];
}

/**
 * Money is stored as whole hundredths of a dinar, so two decimals is the whole
 * of it — a third would promise a precision the amounts cannot hold. Every
 * price the site shows or puts in an editable field goes through one of these.
 */
export const kd = (cents: number) => (cents / 100).toFixed(2);
export const money = (cents: number) => `KD ${kd(cents)}`;
/** The inverse, for a price typed into a form. */
export const kdToCents = (typed: string) => Math.round(parseFloat(typed || '0') * 100);

export interface TeamMember {
  isAdmin: boolean;
  id: number;
  email: string;
  name: string;
  provider: string;
  createdAt: string;
}

export type SupportKind = 'suggestion' | 'complaint' | 'question';
export type SupportSeverity = 'low' | 'normal' | 'urgent';
export type SupportStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface SupportRequest {
  id: number;
  kind: SupportKind;
  severity: SupportSeverity | null;
  subject: string;
  status: SupportStatus;
  createdAt: string;
  updatedAt: string;
  customerName?: string;
  customerEmail?: string;
  messageCount?: number;
}

export interface SupportMessage {
  id: number;
  authorName: string;
  authorRole: 'customer' | 'staff';
  isInternal: boolean;
  body: string;
  createdAt: string;
}

export interface SupportStatusEvent {
  actorName: string;
  from: string | null;
  to: string;
  createdAt: string;
}

export interface SupportThread {
  request: SupportRequest;
  messages: SupportMessage[];
  statusHistory: SupportStatusEvent[];
}
