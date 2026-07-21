// Fixed 2-hour seatings. Changing the cafe's hours = edit this one list.
export const TIME_SLOTS = ['12:00', '14:00', '16:00', '18:00', '20:00'] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

export function isValidSlot(value: string): value is TimeSlot {
  return (TIME_SLOTS as ReadonlyArray<string>).includes(value);
}
