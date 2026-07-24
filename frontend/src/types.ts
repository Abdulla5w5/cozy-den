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

export const money = (cents: number) => `KD ${(cents / 100).toFixed(2)}`;

export interface TeamMember {
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
