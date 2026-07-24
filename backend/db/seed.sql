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

-- Game Library extras (idempotent: only fills rows that are still blank).
UPDATE games SET
  description = COALESCE(NULLIF(description,''), d.descr),
  image_url   = COALESCE(image_url, d.img),
  purchase_url= COALESCE(purchase_url, d.buy)
FROM (VALUES
  ('Catan',          'Trade, build and settle the island. A gateway classic.', NULL, 'https://boardgamespanda.com/products/catan'),
  ('Ticket to Ride', 'Claim railway routes across the map. Easy to learn.',    NULL, 'https://boardgamespanda.com/products/ticket-to-ride'),
  ('Codenames',      'Two teams, one grid of words, clever one-word clues.',   NULL, 'https://boardgamespanda.com/products/codenames'),
  ('Carcassonne',    'Tile-laying city building with cunning placement.',      NULL, NULL),
  ('Pandemic',       'Co-operative race to cure four global diseases.',        NULL, 'https://boardgamespanda.com/products/pandemic'),
  ('Azul',           'Beautiful abstract tile drafting. Quick and tense.',     NULL, NULL)
) AS d(title, descr, img, buy)
WHERE games.title = d.title;

-- Sample events (idempotent by title+date).
INSERT INTO events (title, description, event_date, event_time, location, type, is_featured)
SELECT * FROM (VALUES
  ('Friday Night Tournament', 'Weekly knockout across three tables. Prizes for the top two.', CURRENT_DATE + 3, '19:00', 'Cozy Den', 'internal', TRUE),
  ('Beginners Board Game Night', 'New to tabletop? We teach you three games in one evening.', CURRENT_DATE + 7, '18:00', 'Cozy Den', 'internal', TRUE),
  ('Kuwait Comic Con Booth', 'Come find our booth and play a demo round with us.', CURRENT_DATE + 21, '12:00', 'Kuwait International Fairground', 'external', FALSE)
) AS e(title, description, event_date, event_time, location, type, is_featured)
WHERE NOT EXISTS (SELECT 1 FROM events x WHERE x.title = e.title);

-- One active promo for the entry popup.
INSERT INTO promos (text, link_url, link_label, is_active)
SELECT 'Friday Night Tournament this week — book your table early!', '/events', 'See what''s on', TRUE
WHERE NOT EXISTS (SELECT 1 FROM promos);
