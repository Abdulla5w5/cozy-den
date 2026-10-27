#!/usr/bin/env node
/**
 * Find box photos, via Google Images, for the games the Q8 archive could not.
 *
 * Uses SerpAPI's official Google Images endpoint (Google Images itself blocks
 * scripts). Three steps, so nothing reaches the site unreviewed:
 *
 *   1. Search — one query per game still without a photo; keeps the top three
 *      usable images for each. Resumable, and --limit caps how many searches a
 *      run spends, since the SerpAPI allowance is per month.
 *
 *        read -s SERPAPI_KEY && export SERPAPI_KEY
 *        node backend/db/tools/search-game-images.mjs --limit 100
 *
 *   2. Review — open q8-archive/web/review.html in a browser: every game with
 *      its three candidates, numbered 1–3.
 *
 *   3. Apply — candidate 1 is used unless told otherwise. Name the exceptions:
 *      a different number to swap, 0 to keep the brand tile.
 *
 *        node backend/db/tools/search-game-images.mjs --apply "Catan=2|Uno=0"
 *
 *      Writes frontend/public/games/web/*.webp and a migration. A migration
 *      that is already committed is never rewritten (it may already have run
 *      in production); games beyond it go to a new one, e.g. 034_….
 *
 * The key is read from the environment and never written anywhere. Requires
 * cwebp (brew install webp), as the other image imports do.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const WORK = path.resolve('q8-archive/web');
const IMG_DIR = path.join(WORK, 'candidates');
const STATE = path.join(WORK, 'candidates.json');
const REVIEW = path.join(WORK, 'review.html');
const OUT_DIR = path.resolve('frontend/public/games/web');
const Q8_MIGRATION = path.resolve('backend/db/migrations/032_game_images.sql');
const MIGRATIONS_DIR = path.resolve('backend/db/migrations');
const WEB_MIGRATION = /^(\d+)_game_images_web.*\.sql$/;
const GAMES_URL = 'https://cozyden.com.kw/api/games';

const KEEP = 3; // candidates per game
const WIDTH = 480; // same as the Q8 photos
const QUALITY = 70;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sqlStr = (v) => `'${String(v).replace(/'/g, "''")}'`;
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tag = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8);
const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'g';

const isArabic = (s) => /[؀-ۿ]/.test(s);
const decode = (s) => s.replace(/&amp;/g, '&');

/** Titles the Q8 import already covers. */
function coveredByQ8() {
  if (!existsSync(Q8_MIGRATION)) return new Set();
  const sql = readFileSync(Q8_MIGRATION, 'utf8');
  return new Set(
    [...sql.matchAll(/\(\s*'((?:[^']|'')*)'\s*,\s*'(?:[^']|'')*'\s*\)/g)].map((m) => m[1].replace(/''/g, "'")),
  );
}

/** What to type into Google for one game. */
function queryFor(title) {
  const t = decode(title).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return isArabic(t) ? `لعبة ${t}` : `${t} board game box`;
}

/** Download one image; null if it is not really an image. */
async function fetchImage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (cozy-den image review)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/') || /svg/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Under 4 KB is an icon or a tracking pixel, not a box shot.
    if (buf.length < 4096) return null;
    const ext = (type.match(/image\/(jpeg|jpg|png|webp|gif)/) || [, 'jpg'])[1].replace('jpeg', 'jpg');
    return { buf, ext };
  } catch {
    return null;
  }
}

async function search() {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error('Set SERPAPI_KEY first:  read -s SERPAPI_KEY && export SERPAPI_KEY');
  const li = process.argv.indexOf('--limit');
  const limit = li === -1 ? Infinity : Number(process.argv[li + 1]);

  mkdirSync(IMG_DIR, { recursive: true });
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};

  const games = (await (await fetch(GAMES_URL)).json()).games;
  const covered = coveredByQ8();
  const todo = games
    .filter((g) => !g.image_url && !covered.has(g.title) && !state[g.title])
    .map((g) => g.title);
  console.log(`${todo.length} game(s) still need a search` + (limit < todo.length ? `; doing ${limit} this run` : ''));

  let spent = 0;
  for (const title of todo) {
    if (spent >= limit) break;
    const q = queryFor(title);
    const url =
      'https://serpapi.com/search.json?engine=google_images&ijn=0&safe=active' +
      `&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(key)}`;
    spent += 1;

    let results = [];
    try {
      const res = await fetch(url);
      const body = await res.json();
      if (body.error) throw new Error(body.error);
      results = body.images_results || [];
    } catch (err) {
      // Out of allowance, or a bad key: stop rather than burn through the list.
      console.error(`\n! search failed for "${title}": ${err.message}`);
      break;
    }

    const candidates = [];
    for (const r of results.slice(0, 10)) {
      if (candidates.length >= KEEP) break;
      const img = (await fetchImage(r.original)) || (r.thumbnail && (await fetchImage(r.thumbnail)));
      if (!img) continue;
      const file = `${slug(title)}-${tag(title)}-${candidates.length + 1}.${img.ext}`;
      writeFileSync(path.join(IMG_DIR, file), img.buf);
      candidates.push({ file, source: r.source || '', link: r.link || '' });
    }
    state[title] = { query: q, candidates };
    writeFileSync(STATE, JSON.stringify(state, null, 2));
    console.log(`[${String(spent).padStart(3)}] ${title}  —  ${candidates.length} candidate(s)`);
    await sleep(300);
  }

  writeReview(state);
  const left = games.filter((g) => !g.image_url && !covered.has(g.title) && !state[g.title]).length;
  console.log(`\nreview sheet: ${REVIEW}`);
  if (left) console.log(`${left} game(s) not searched yet — run again when the allowance allows.`);
}

function writeReview(state) {
  const rows = Object.entries(state)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, s]) => {
      const cells = [1, 2, 3]
        .map((n) => {
          const c = s.candidates[n - 1];
          return c
            ? `<figure><img src="candidates/${encodeURIComponent(c.file)}" loading="lazy"><figcaption>${n} · ${esc(c.source)}</figcaption></figure>`
            : `<figure class="none"><figcaption>${n} · —</figcaption></figure>`;
        })
        .join('');
      return `<section${s.candidates.length ? '' : ' class="empty"'}><h2 dir="auto">${esc(decode(title))}</h2><p>searched: ${esc(s.query)}</p><div>${cells}</div></section>`;
    })
    .join('\n');
  writeFileSync(
    REVIEW,
    `<!doctype html><meta charset="utf-8"><title>Game photo review</title>
<style>
body{font:14px system-ui,sans-serif;margin:24px;background:#fffaf1;color:#242424}
h1{margin:0 0 4px}section{border-top:1px solid #d8c8ae;padding:14px 0}
h2{margin:0;font-size:16px}p{margin:2px 0 8px;color:#655d52;font-size:12px}
section>div{display:flex;gap:12px;flex-wrap:wrap}
figure{margin:0;width:180px}figure img{width:180px;height:180px;object-fit:contain;background:#fff;border:2px solid #242424;border-radius:10px}
figcaption{font-size:12px;margin-top:4px;color:#655d52;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.none{height:200px;border:2px dashed #d8c8ae;border-radius:10px;display:grid;place-items:center}
.empty h2::after{content:"  — nothing usable found, keeps the brand tile";color:#d93018;font-weight:400}
</style>
<h1>Game photo review</h1>
<p>Candidate 1 is used for every game unless you say otherwise. Note the games where 1 is wrong: the number to use instead, or 0 for none.</p>
${rows}`,
  );
}

function apply() {
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  const ai = process.argv.indexOf('--apply');
  const overrides = new Map();
  const arg = process.argv[ai + 1];
  if (arg && !arg.startsWith('--')) {
    for (const pair of arg.split('|')) {
      const at = pair.lastIndexOf('=');
      if (at > 0) overrides.set(pair.slice(0, at).trim(), Number(pair.slice(at + 1)));
    }
  }
  for (const name of overrides.keys()) {
    if (!state[name]) console.warn(`  ! "${name}" is not in the review — check the spelling`);
  }

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const rows = [];
  for (const [title, s] of Object.entries(state)) {
    const pick = overrides.has(title) ? overrides.get(title) : 1;
    const c = pick > 0 ? s.candidates[pick - 1] : null;
    if (!c) continue;
    const name = `${slug(title)}-${tag(title)}.webp`;
    try {
      execFileSync(
        'cwebp',
        ['-quiet', '-q', String(QUALITY), '-resize', String(WIDTH), '0', path.join(IMG_DIR, c.file), '-o', path.join(OUT_DIR, name)],
        { stdio: 'pipe' },
      );
      rows.push(`  (${sqlStr(title)}, ${sqlStr(`/games/web/${name}`)})`);
    } catch (err) {
      console.warn(`  ! could not encode ${c.file}: ${String(err.stderr || err.message).trim()}`);
    }
  }

  // A migration runs once per database, so one that is already committed (and
  // so possibly already deployed) is never rewritten — a change to it would
  // silently never reach production. Games it covers are left to it; anything
  // new goes to a fresh migration, which is rewritten freely until committed.
  const committed = new Set(
    execFileSync('git', ['ls-files', MIGRATIONS_DIR], { encoding: 'utf8' })
      .split('\n')
      .map((f) => path.basename(f)),
  );
  const all = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const covered = new Set();
  for (const f of all.filter((f) => WEB_MIGRATION.test(f) && committed.has(f))) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    for (const m of sql.matchAll(/\(\s*'((?:[^']|'')*)'\s*,/g)) covered.add(m[1].replace(/''/g, "'"));
  }
  const pending = all.find((f) => WEB_MIGRATION.test(f) && !committed.has(f));
  const next = String(Math.max(...all.map((f) => parseInt(f, 10) || 0)) + 1).padStart(3, '0');
  const fileName = pending || (covered.size ? `${next}_game_images_web_more.sql` : `${next}_game_images_web.sql`);
  const MIGRATION = path.join(MIGRATIONS_DIR, fileName);
  const fresh = rows.filter((r) => {
    const t = r.match(/^\s*\('((?:[^']|'')*)'/)[1].replace(/''/g, "'");
    return !covered.has(t);
  });
  if (!fresh.length) {
    console.log(`${rows.length} photo(s) encoded to ${OUT_DIR}`);
    console.log('no games beyond those already in committed migrations — nothing to write');
    return;
  }
  rows.length = 0;
  rows.push(...fresh);

  writeFileSync(
    MIGRATION,
    `-- Box photographs for the games the Q8 archive did not carry, found through
-- Google Images (SerpAPI), re-encoded to ${WIDTH}px WebP and shipped under
-- /games/web/. Each pick was reviewed by a person against two alternatives.
--
-- GENERATED by backend/db/tools/search-game-images.mjs --apply — do not hand-edit.
-- Only fills a game that still has no picture: staff choices are never
-- overwritten, and a game left without one keeps its brand tile.
BEGIN;

UPDATE games g
   SET image_url = v.image_url
  FROM (VALUES
${rows.join(',\n')}
  ) AS v(title, image_url)
 WHERE g.title = v.title
   AND (g.image_url IS NULL OR g.image_url = '');

COMMIT;
`,
  );
  console.log(`photos encoded to ${OUT_DIR}`);
  console.log(`${rows.length} game(s) written to ${MIGRATION}`);
}

if (process.argv.includes('--apply')) apply();
else await search();
