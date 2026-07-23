# Cozy Den — Board Game Café Booking (Prototype, Phase 1)

A guest-checkout booking platform for a board game café: pick a table + time slot,
choose a game, pre-order food/drink, pay (mocked), and get a verification code.
Staff get a dashboard for the day's bookings, check-in, and monthly analytics.

**Stack:** React + TypeScript (Vite) · Node.js + TypeScript (Express) · PostgreSQL.

---

## DigitalOcean App Platform

The repository includes a complete App Platform specification at
`.do/app.yaml`. It declares the frontend, API, routing, and VPC attachment, so
DigitalOcean does not need to infer components from the monorepo root.

When creating the app from the control panel, select this repository and branch
`main`. The platform will read `.do/app.yaml`. Before the first deployment, add
`JWT_SECRET` and `DATABASE_URL` to the `api` service as **Secret** runtime
environment variables. Use a unique `JWT_SECRET` of at least 32 characters.

Production PostgreSQL runs on a separate Droplet in the same VPC, rather than
an App Platform development database. Set `DATABASE_URL` to that database's
private VPC address with the appropriate credentials and `sslmode=disable`.
Keep the database port bound to the Droplet's private address and allow port
5432 only from the VPC CIDR. Do not commit the connection URL or credentials.

---

## Repository layout

```
cozy-den/
├── backend/                # Express API + PostgreSQL
│   ├── db/
│   │   ├── migrations/     # raw .sql schema migrations (001_init.sql)
│   │   └── seed.sql        # sample tables/games/menu
│   ├── scripts/            # migrate.ts, seed.ts (run via npm)
│   └── src/
│       ├── config/env.ts   # typed, validated environment loading
│       ├── db/pool.ts      # single pg pool + parameterized query() helper
│       ├── middleware/     # validate (zod), auth (JWT cookie), rate limit, errors
│       ├── payment/        # PaymentProvider interface + MockPaymentProvider
│       ├── notifications/  # stubbed mailer (receipt email)
│       ├── utils/          # verification codes, time slots
│       ├── modules/        # tables, games, menu, bookings, staff (routes + services)
│       └── app.ts / index.ts
└── frontend/               # React app
    └── src/
        ├── api/client.ts   # fetch wrapper (credentials: include)
        ├── pages/          # BookingFlow, Confirmation, StaffLogin, StaffDashboard
        └── types.ts, App.tsx, main.tsx, styles.css
```

Concerns are separated: **routes** validate + shape HTTP; **services** hold business
logic and own all SQL; **payment/notifications** hide external integrations behind
interfaces so they can be swapped without touching booking logic.

---

## Running locally

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ running locally

### 1. Database
```bash
createdb cozyden
# (or) psql -c "CREATE DATABASE cozyden;"
```

### 2. Backend
```bash
cd backend
cp .env.example .env          # then edit DATABASE_URL + set a real JWT_SECRET
npm install
npm run migrate               # applies db/migrations/*.sql
npm run seed                  # sample data + staff login
npm run dev                   # http://localhost:4000
```
Seed prints the staff login (default `staff@cozyden.local` / `cozyden123`).

### 3. Frontend
```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173  (proxies /api -> :4000)
```

Open http://localhost:5173 to book. Staff dashboard: http://localhost:5173/staff.

### Try the flow
- Book a table → the mock payment approves `tok_demo` and declines `tok_decline`.
- On success you land on a confirmation page with a verification code; the "email"
  receipt prints to the **backend console** (stubbed mailer).
- Log in as staff → today's list, check a code in, and view monthly analytics.

---

## Why raw SQL migrations (not an ORM)

For a schema this small, hand-written SQL keeps things transparent and reviewable:
the exact tables, constraints, and indexes are visible in `db/migrations/001_init.sql`
with no ORM abstraction to reverse-engineer. All queries go through a single
`query()` helper that **only** accepts parameterized statements (`$1, $2, …`), so
we get injection safety without an ORM's weight. A tiny `migrate.ts` runner applies
files in order and records them in `schema_migrations`. If later phases grow the
schema a lot, this can be swapped for a migration library without changing the
query layer.

Money is stored as **integer cents** everywhere to avoid floating-point rounding.

---

## What's stubbed vs. real

| Area | Status | Notes |
|------|--------|-------|
| Booking / availability / check-in / analytics | **Real** | Full logic against PostgreSQL. |
| Auth (staff) | **Real** | bcrypt hashing + JWT in an httpOnly cookie. |
| Input validation | **Real** | zod schemas on every endpoint. |
| Rate limiting | **Real** | Global + per-route (booking, login). |
| **Payment** | **Stubbed** | `MockPaymentProvider` approves/declines by token. Swap in a real provider by implementing `PaymentProvider` and setting `PAYMENT_PROVIDER`. |
| **Email receipt** | **Stubbed** | `ConsoleMailer` logs the receipt. Swap for SES/SendGrid/etc. |

### Swapping in the real payment gateway (phase 2)
1. Add `src/payment/StripePaymentProvider.ts` implementing `PaymentProvider`.
2. Register it in `src/payment/index.ts`.
3. Set `PAYMENT_PROVIDER=stripe` and `PAYMENT_API_KEY=…` in `.env`.

No booking/business code changes — everything depends on the `PaymentProvider`
interface, not a concrete gateway.

---

## Security notes (and what's placeholder until you provide prod config)

Implemented now:
- **Parameterized queries only** — no string-concatenated SQL anywhere.
- **Validation/sanitization** on every endpoint via zod; parsed output replaces raw input.
- **Rate limiting** on public endpoints (tighter on booking creation and login).
- **Explicit CORS allow-list** (`CORS_ORIGINS`) — no `*`.
- **Staff auth**: bcrypt password hashes; JWT stored in an **httpOnly, SameSite=Lax
  cookie** (not localStorage) to reduce XSS token theft.
- **Secrets via env** (`JWT_SECRET`, DB creds, future `PAYMENT_API_KEY`) — nothing hardcoded.
- **Unguessable verification codes** — CSPRNG (`crypto.randomInt`), not sequential ids.
- **HTTPS-ready**: `trust proxy` is on and the cookie `Secure` flag is controlled by
  `COOKIE_SECURE`; assumes TLS is terminated at a reverse proxy / load balancer.
- Generic login errors + constant-ish comparison to avoid leaking which emails exist.

Placeholder / your responsibility before production:
- Set a strong `JWT_SECRET` (≥32 chars; the app refuses to start in prod otherwise).
- Set `COOKIE_SECURE=true` and serve over HTTPS.
- Replace the seeded staff password; add real staff accounts.
- Provide the real payment provider + API key.
- Configure a real email transport.
- Rate limits are in-memory (fine for one instance ~100 visitors/day); use a shared
  store (e.g. Redis) if you scale to multiple instances.

---

## Data model

- `tables` (id, label, capacity)
- `games` (id, title, min_players, max_players, category)
- `menu_items` (id, name, category food/drink, price_cents, description, available)
- `bookings` (id, table_id, game_id, booking_date, time_slot, guest_name, guest_email,
  verification_code, status, table_fee_cents, items_total_cents, total_cents, payment_ref, created_at)
- `booking_items` (id, booking_id, menu_item_id, quantity, unit_price_cents)
- `staff_users` (id, email, password_hash, name, created_at)

A **partial unique index** on `(table_id, booking_date, time_slot) WHERE status <> 'cancelled'`
prevents double-booking a slot while freeing it if a booking is cancelled.

**Booking business rules (confirmed for phase 1):** fixed **2-hour seatings**
(12:00 / 14:00 / 16:00 / 18:00 / 20:00), and checkout charges **pre-ordered
food/drink + a flat table reservation fee** (`TABLE_FEE_CENTS`, default £5.00).

---

## API summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/tables` | – | List tables |
| GET | `/api/tables/availability?date=` | – | Free/taken slots per table |
| GET | `/api/games` | – | Game library |
| GET | `/api/menu` | – | Available menu items |
| POST | `/api/bookings` | – | Guest checkout (create + pay + confirm) |
| GET | `/api/bookings/:code` | – | Confirmation lookup by code |
| POST | `/api/staff/login` | – | Sets httpOnly session cookie |
| POST | `/api/staff/logout` | staff | Clears session |
| GET | `/api/staff/me` | staff | Current staff session |
| GET | `/api/staff/bookings?date=` | staff | Bookings for a date (default today) |
| POST | `/api/staff/check-in` | staff | Mark a code as arrived |
| GET | `/api/staff/analytics?month=` | staff | Monthly aggregates |

---

## Not built yet (left room for, per scope)
Real payment integration, advanced BI beyond monthly aggregates, infra-level DDoS
mitigation (CDN/WAF), multi-location / multi-tenant, optional customer accounts.
