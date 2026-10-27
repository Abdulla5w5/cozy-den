#!/usr/bin/env node
/**
 * Pair the archived Board Games Q8 photos with the café's game library.
 *
 * Two steps, so nothing reaches the site unreviewed:
 *
 *   node backend/db/tools/match-q8-images.mjs
 *     Reads q8-archive/manifest.json and the live game list, pairs titles, and
 *     writes q8-archive/matches.json plus a review list to the terminal.
 *     Exact title matches are approved; near matches are listed for
 *     a person to approve — the wrong box on a game is worse than no box.
 *
 *   node backend/db/tools/match-q8-images.mjs --apply
 *     Encodes every approved photo to a WebP under frontend/public/games/ and
 *     writes backend/db/migrations/032_game_images.sql.
 *
 * Requires cwebp (brew install webp), as the menu-photo import does.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ARCHIVE = path.resolve('q8-archive');
const MANIFEST = path.join(ARCHIVE, 'manifest.json');
const MATCHES = path.join(ARCHIVE, 'matches.json');
const OUT_DIR = path.resolve('frontend/public/games');
const MIGRATION = path.resolve('backend/db/migrations/032_game_images.sql');
const GAMES_URL = 'https://cozyden.com.kw/api/games';

// The art panel is a card's top half: ~280 CSS px wide on desktop, a full
// phone width (~340) on mobile, and the featured card about twice that. 480px
// covers a phone at 1.4x and the small cards at 2x without shipping bytes no
// screen shows; at q70 a box shot lands around 25–45 KB.
const WIDTH = 480;
const QUALITY = 70;

const sqlStr = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** Fold the ways one title gets spelled into one comparable form. */
function norm(s) {
  return s
    .replace(/&amp;/g, '&')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // Latin accents
    .replace(/[ً-ٰٟـ]/g, '') // Arabic harakat and tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/(^| )(the|game|لعبه)(?= |$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const isArabic = (s) => /[؀-ۿ]/.test(s) && !/[a-z]/i.test(s);
const isLatin = (s) => /[a-z]/i.test(s) && !/[؀-ۿ]/.test(s);

/**
 * Every name one shop product answers to. The shop often lists a title in both
 * languages ("Avalon - افالون"), so each side counts — but only when the split
 * really separates two languages. "Cash n Guns - Team Spirit" is an expansion,
 * and reading it as "Cash n Guns" would put the expansion's box on the base game.
 */
function shopAliases(title) {
  const names = [title];
  const parts = title.split(/\s+[-–]\s+/);
  if (parts.length === 2) {
    const [a, b] = parts;
    if ((isLatin(a) && isArabic(b)) || (isArabic(a) && isLatin(b))) names.push(a, b);
  }
  return [...new Set(names.map(norm).filter(Boolean))];
}

/**
 * The same names with edition and language labels taken off — "Codenames
 * (English) - 2nd Edition", "Splendor (2024 Refresh)", "تابو بالعربي". Only the
 * labels go: a real subtitle stays, so "Splendor: Marvel" never reads as
 * Splendor. A pairing made this way is always held for review.
 */
const EDITION_WORDS =
  /(^| )(\d+(st|nd|rd|th)|first|second|third|new|revised|deluxe edition|anniversary)?( )?(edition|ed)(?= |$)|(^| )(board|refresh|20\d\d|english|arabic|en|ar|بالعربي|عربي|انجليزي|نسخه عربيه|اصدار جديد)(?= |$)/g;
function editionAliases(title) {
  // Split on " - " only where it separates two languages, as shopAliases does:
  // elsewhere the second half is a product of its own ("Dixit" card sleeves,
  // "Splendor - Cities of Splendor"), not a label to drop.
  const parts = title.split(/\s+[-–]\s+/);
  const bilingual =
    parts.length === 2 &&
    ((isLatin(parts[0]) || /[a-z]/i.test(parts[0])) !== (isLatin(parts[1]) || /[a-z]/i.test(parts[1])));
  return [
    ...new Set(
      [title, ...(bilingual ? parts : [])]
        .map((t) => norm(t.replace(/\([^)]*\)/g, ' ')).replace(EDITION_WORDS, ' ').replace(/\s+/g, ' ').trim())
        .filter((t) => t.length > 1),
    ),
  ];
}

const tokens = (s) => new Set(s.split(' ').filter(Boolean));
function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  return shared / (A.size + B.size - shared || 1);
}

/** Best shop product for one game, and how sure the pairing is. */
function bestMatch(gameTitle, shop) {
  const full = norm(gameTitle);
  // "Agent Avenue (Arabic)" — the bracket names an edition the shop may not.
  const bare = norm(gameTitle.replace(/\([^)]*\)/g, ' '));

  let best = null;
  for (const p of shop) {
    for (const alias of p.aliases) {
      let tier = null;
      let score = 0;
      if (alias === full) {
        tier = 'exact';
        score = 1;
      } else if (alias === bare) {
        tier = 'near';
        score = 0.95;
      } else {
        const j = Math.max(jaccard(alias, full), jaccard(alias, bare));
        if (j >= 0.6) {
          tier = 'near';
          score = j;
        }
      }
      if (tier && (!best || score > best.score)) best = { ...p, alias, tier, score };
    }
    // Same game, newer or other-language box.
    for (const alias of p.editions) {
      if ((alias === full || alias === bare) && (!best || best.score < 0.9)) {
        best = { ...p, alias, tier: 'near', score: 0.9 };
      }
    }
  }
  return best;
}

async function review() {
  if (!existsSync(MANIFEST)) {
    throw new Error(`No ${MANIFEST}. Run scrape-q8-images.mjs first.`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const shop = manifest
    .filter((p) => existsSync(path.join(ARCHIVE, 'images', p.file)))
    .map((p) => ({
      title: p.title,
      file: p.file,
      aliases: shopAliases(p.title),
      editions: editionAliases(p.title),
    }));

  const res = await fetch(GAMES_URL);
  if (!res.ok) throw new Error(`Game list returned ${res.status}`);
  const games = (await res.json()).games;

  const matches = [];
  const unmatched = [];
  for (const g of games) {
    const m = bestMatch(g.title, shop);
    if (!m) {
      unmatched.push(g.title);
      continue;
    }
    matches.push({
      game: g.title,
      shopTitle: m.title,
      file: m.file,
      tier: m.tier,
      score: Number(m.score.toFixed(2)),
      approved: m.tier === 'exact',
    });
  }

  // Keep any decisions already made on an earlier run.
  if (existsSync(MATCHES)) {
    const previous = new Map(JSON.parse(readFileSync(MATCHES, 'utf8')).map((m) => [m.game, m]));
    for (const m of matches) {
      const p = previous.get(m.game);
      // Keyed on the pairing, not the file: a re-scrape renames files, and a
      // person's yes or no must survive it.
      if (p && p.shopTitle === m.shopTitle) m.approved = p.approved;
    }
  }
  const exact = matches.filter((m) => m.tier === 'exact');
  const near = matches.filter((m) => m.tier === 'near').sort((a, b) => b.score - a.score);

  // --approve "Game A|Game B" — by game title, never by list position: the list
  // reorders whenever the archive changes, and a number that pointed at a good
  // pairing yesterday points at a wrong one today. When given, it replaces every
  // earlier near-match decision: listed games are approved, all others are not.
  const ai = process.argv.indexOf('--approve');
  if (ai !== -1) {
    const approve = new Set(process.argv[ai + 1].split('|').map((s) => s.trim()));
    for (const m of near) m.approved = approve.has(m.game);
  }

  writeFileSync(MATCHES, JSON.stringify(matches, null, 2));

  console.log(`\n${games.length} games · ${shop.length} archived shop photos\n`);
  console.log(`EXACT (${exact.length}) — approved automatically`);
  console.log(`NEAR  (${near.length}) — need a yes or no:`);
  near.forEach((m, i) =>
    console.log(
      `  ${String(i + 1).padStart(3)}. ${m.game}  →  ${m.shopTitle}  ` +
        `(${m.score})${m.approved ? '  ✓' : ''}`,
    ),
  );
  console.log(`\nNO MATCH (${unmatched.length}) — keep their emoji:`);
  console.log('  ' + unmatched.join(' · '));
  console.log(`\nWritten to ${MATCHES}`);
}

function apply() {
  const matches = JSON.parse(readFileSync(MATCHES, 'utf8')).filter((m) => m.approved);
  // The pairings a person vouched for, on screen, so a wrong one is caught here
  // rather than on the live site.
  console.log('Approved near matches:');
  for (const m of matches.filter((x) => x.tier === 'near')) {
    console.log(`  ${m.game}  →  ${m.shopTitle}`);
  }
  // Clear only this import's own photos (the top-level WebPs). The web-search
  // import keeps its photos in a subfolder, and a re-run here must not wipe them.
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of readdirSync(OUT_DIR)) {
    if (f.endsWith('.webp')) rmSync(path.join(OUT_DIR, f));
  }

  const rows = [];
  for (const m of matches) {
    const src = path.join(ARCHIVE, 'images', m.file);
    const name = `${path.parse(m.file).name}.webp`;
    try {
      execFileSync(
        'cwebp',
        ['-quiet', '-q', String(QUALITY), '-resize', String(WIDTH), '0', src, '-o', path.join(OUT_DIR, name)],
        { stdio: 'pipe' },
      );
      rows.push(`  (${sqlStr(m.game)}, ${sqlStr(`/games/${name}`)})`);
    } catch (err) {
      console.warn(`  ! could not encode ${m.file}: ${String(err.stderr || err.message).trim()}`);
    }
  }

  const sql = `-- Box photographs for the game library, from the Board Games Q8 catalogue
-- (same ownership as the café). The shop is being retired, so the photos are
-- archived, re-encoded to ${WIDTH}px WebP, and shipped with the site under
-- /games/ rather than linked to a server that is going away.
--
-- GENERATED by backend/db/tools/match-q8-images.mjs --apply — do not hand-edit.
-- Matched by title; exact matches were taken as they were, near matches only
-- after a person approved each one. A game with no match keeps its emoji tile.
--
-- Only fills a game that has no picture yet: a photo staff have since set from
-- the games editor is never overwritten by this import.
BEGIN;

UPDATE games g
   SET image_url = v.image_url
  FROM (VALUES
${rows.join(',\n')}
  ) AS v(title, image_url)
 WHERE g.title = v.title
   AND (g.image_url IS NULL OR g.image_url = '');

COMMIT;
`;
  writeFileSync(MIGRATION, sql);
  console.log(`${rows.length} photo(s) encoded to ${OUT_DIR}`);
  console.log(`migration written to ${MIGRATION}`);
}

if (process.argv.includes('--apply')) apply();
else await review();
