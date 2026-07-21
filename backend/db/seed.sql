-- Sample data for local development. Safe to re-run (idempotent-ish via ON CONFLICT / guards).

INSERT INTO tables (label, capacity) VALUES
  ('Nook 1', 2),
  ('Nook 2', 2),
  ('Window Table', 4),
  ('Family Table', 6),
  ('The Long Table', 8)
ON CONFLICT DO NOTHING;

INSERT INTO games (title, min_players, max_players, category) VALUES
  ('Catan',           3, 4, 'Strategy'),
  ('Ticket to Ride',  2, 5, 'Family'),
  ('Codenames',       4, 8, 'Party'),
  ('Carcassonne',     2, 5, 'Strategy'),
  ('Pandemic',        2, 4, 'Cooperative'),
  ('Azul',            2, 4, 'Abstract')
ON CONFLICT DO NOTHING;

INSERT INTO menu_items (name, category, price_cents, description) VALUES
  ('Flat White',        'drink', 380, 'Double shot, silky microfoam'),
  ('Hot Chocolate',     'drink', 420, 'Belgian chocolate, whipped cream'),
  ('Craft Lemonade',    'drink', 350, 'House-made, lightly sparkling'),
  ('Loaded Nachos',     'food',  850, 'Cheese, jalapenos, salsa, guac'),
  ('Soft Pretzel',      'food',  550, 'Warm, sea salt, mustard dip'),
  ('Brownie Stack',     'food',  600, 'Fudgy, vanilla ice cream')
ON CONFLICT DO NOTHING;

-- NOTE: the staff dashboard login is created by scripts/seed.ts, which hashes
-- the password with bcrypt at seed time (never store a plaintext password here).
