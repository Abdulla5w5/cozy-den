-- Photographs for the menu items Foodics has none for (it shows one shared
-- "no photo" graphic for them). These are NOT pictures of the café's own
-- dishes: freely licensed photos of the same kind of dish, from Wikimedia
-- Commons, every one public domain or CC0, so no credit is required. Swap any
-- of them for the café's own photo whenever one exists. Sources, for the record:
--
--   Vanilla Milkshake: Vanilla Frappe - Blossom Cafe Bar 2024-08-13.jpg (CC0) https://commons.wikimedia.org/wiki/File:Vanilla_Frappe_-_Blossom_Cafe_Bar_2024-08-13.jpg
--   Cappucino Milkshake: Cafe-frape-glas-holztisch-unscharf.jpg (CC0) https://commons.wikimedia.org/wiki/File:Cafe-frape-glas-holztisch-unscharf.jpg
--   Kinder Bueno Milkshake: Chocolate milk shake - The Bystander Cafe.jpg (CC0) https://commons.wikimedia.org/wiki/File:Chocolate_milk_shake_-_The_Bystander_Cafe.jpg
--   Chicken Ceasar Salad: Chicken Caesar salad - Auckland, New Zealand.jpg (CC0) https://commons.wikimedia.org/wiki/File:Chicken_Caesar_salad_-_Auckland,_New_Zealand.jpg
--   Chicken Ceasar Wrap: Crispy Chick'n Caesar Wrap.jpg (CC0) https://commons.wikimedia.org/wiki/File:Crispy_Chick%27n_Caesar_Wrap.jpg
--   Chicken Popcorn: Pine and Crane DTLA - taiwanese (jidori) popcorn chicken.jpg (CC0) https://commons.wikimedia.org/wiki/File:Pine_and_Crane_DTLA_-_taiwanese_(jidori)_popcorn_chicken.jpg
--   Chicken Nuggets 6pcs: Impossible chicken nuggets 2.jpg (CC0) https://commons.wikimedia.org/wiki/File:Impossible_chicken_nuggets_2.jpg
--   4x Chicken Strips: Crispy chicken tenders, Ship and Shovell Pub (September 2023).JPG (CC0) https://commons.wikimedia.org/wiki/File:Crispy_chicken_tenders,_Ship_and_Shovell_Pub_(September_2023).JPG
--   Double Chocolate Croissant: Pain au chocolat - Milfey Patisserie 2026-09-30.jpg (CC0) https://commons.wikimedia.org/wiki/File:Pain_au_chocolat_-_Milfey_Patisserie_2026-09-30.jpg
--   Mini Red Velvet Cake: Delicious Red Velvet Cupcake.jpg (CC0) https://commons.wikimedia.org/wiki/File:Delicious_Red_Velvet_Cupcake.jpg
--   Fruits Jelly: Bassetts winegums.jpg (Public domain) https://commons.wikimedia.org/wiki/File:Bassetts_winegums.jpg
--   PinaLemo: Fruit drink.jpg (Public domain) https://commons.wikimedia.org/wiki/File:Fruit_drink.jpg
--   Nutella Donut: Chocolate Donut With Sprinkles on it.jpg (CC0) https://commons.wikimedia.org/wiki/File:Chocolate_Donut_With_Sprinkles_on_it.jpg

UPDATE menu_items m
   SET image_url = v.image_url
  FROM (VALUES
  ('Vanilla Milkshake', '/menu/vanilla-milkshake.webp'),
  ('Cappucino Milkshake', '/menu/cappucino-milkshake.webp'),
  ('Kinder Bueno Milkshake', '/menu/kinder-bueno-milkshake.webp'),
  ('Chicken Ceasar Salad', '/menu/chicken-ceasar-salad.webp'),
  ('Chicken Ceasar Wrap', '/menu/chicken-ceasar-wrap.webp'),
  ('Chicken Popcorn', '/menu/chicken-popcorn.webp'),
  ('Chicken Nuggets 6pcs', '/menu/chicken-nuggets-6pcs.webp'),
  ('4x Chicken Strips', '/menu/4x-chicken-strips.webp'),
  ('Double Chocolate Croissant', '/menu/double-chocolate-croissant.webp'),
  ('Mini Red Velvet Cake', '/menu/mini-red-velvet-cake.webp'),
  ('Fruits Jelly', '/menu/fruits-jelly.webp'),
  ('PinaLemo', '/menu/pinalemo.webp'),
  ('Nutella Donut', '/menu/nutella-donut.webp')
  ) AS v(name, image_url)
 WHERE m.name = v.name AND m.image_url IS NULL;
