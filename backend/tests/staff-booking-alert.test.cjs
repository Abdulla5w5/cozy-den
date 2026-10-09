// The email staff get when a customer books and pays.
//
// What this pins: staff can plan the counter from the subject line alone, the
// body states the session the customer actually paid for, and the verification
// code — the customer's claim to the table — never leaves the dashboard.
const test = require('node:test');
const assert = require('node:assert');

// mailer.js pulls in config/env, which refuses to load without a JWT secret.
process.env.JWT_SECRET ||= 'test-secret-that-is-long-enough-for-config';
const { formatStaffBookingAlert } = require('../dist/src/notifications/mailer.js');

const booking = {
  guestName: 'Fatma Ali',
  guestEmail: 'fatma@example.com',
  verificationCode: 'CD-7Q4K9',
  date: '2026-10-09',
  timeSlot: '23:00',
  tableLabel: 'Big Table 2',
  totalCents: 1350,
  durationMin: 240,
  partySize: 6,
};

test('the subject says which table, when, and how many', () => {
  const { subject } = formatStaffBookingAlert(booking);
  assert.equal(subject, '[Cozy Den] New booking: Big Table 2, 2026-10-09 23:00 (6 guests)');
});

test('the body states the paid session, wrapping past midnight', () => {
  const { text } = formatStaffBookingAlert(booking);
  assert.match(text, /Time: {2}23:00–03:00 \(4-hour session\)/);
  assert.match(text, /Guest: Fatma Ali <fatma@example\.com>/);
  assert.match(text, /Paid: {2}KD 13\.50/);
});

test('the verification code is never included', () => {
  const { subject, text } = formatStaffBookingAlert(booking);
  assert.ok(!subject.includes('CD-7Q4K9'));
  assert.ok(!text.includes('CD-7Q4K9'));
});

test('a single guest reads as "1 guest"', () => {
  const { subject } = formatStaffBookingAlert({ ...booking, partySize: 1 });
  assert.match(subject, /\(1 guest\)$/);
});

test('the dashboard link appears only when the site URL is known', () => {
  assert.ok(!formatStaffBookingAlert(booking).text.includes('dashboard'));
  const withLink = formatStaffBookingAlert(booking, 'https://cozyden.com.kw/staff/dashboard');
  assert.match(withLink.text, /Open the dashboard: https:\/\/cozyden\.com\.kw\/staff\/dashboard$/);
});
