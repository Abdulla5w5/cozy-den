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
  gameId: number | null;
  gameTitle: string | null;
  date: string;
  timeSlot: string;
  guestName: string;
  guestEmail: string;
  verificationCode: string;
  status: string;
  tableFeeCents: number;
  itemsTotalCents: number;
  totalCents: number;
  items: BookingItemView[];
  createdAt: string;
}

export interface StaffBooking {
  id: number;
  verificationCode: string;
  timeSlot: string;
  guestName: string;
  tableLabel: string;
  gameTitle: string | null;
  status: string;
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

export const money = (cents: number) => `£${(cents / 100).toFixed(2)}`;
