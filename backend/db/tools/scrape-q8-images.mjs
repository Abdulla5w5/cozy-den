#!/usr/bin/env node
/**
 * Archive the Board Games Q8 catalogue: every product's name and its photo.
 *
 * The shop is the café's own (same ownership), and it is being decommissioned —
 * once it is gone the photographs are gone with it, so this is a one-off rescue
 * rather than part of any build. It talks to nothing but that shop, writes
 * nothing but a folder of images and a manifest, and is safe to run twice: a
 * product whose image is already on disk is skipped, so an interrupted run
 * continues where it stopped rather than starting over.
 *
 *   node backend/db/tools/scrape-q8-images.mjs
 *
 * Output (both under ./q8-archive/):
 *   images/<slug>.<ext>   the photographs
 *   manifest.json         [{ title, productUrl, imageUrl, file }]
 *
 * Hand the folder to the importer, which matches these titles against the game
 * library and writes the migration.
 */

import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ORIGIN = 'https://boardgamesq8.com';
const OUT_DIR = path.resolve('q8-archive');
const IMG_DIR = path.join(OUT_DIR, 'images');

// Gentle on a shop that is still serving customers: a handful of requests at a
// time, and a pause between them. The whole catalogue still takes minutes, not
// hours, and a dying server is less likely to fall over mid-run.
const CONCURRENCY = 4;
const DELAY_MS = 250;
const RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch with retries — a shop on its last legs drops connections. */
async function get(url, asBuffer = false) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'cozy-den-archive/1.0 (catalogue backup)' },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return asBuffer ? res : await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) await sleep(500 * attempt);
    }
  }
  throw lastErr;
}

// Sitemap plugins often wrap each address in CDATA (<loc><![CDATA[...]]></loc>),
// and entity-encode the ampersands in query strings; read both forms.
const locs = (xml) =>
  [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, '&'),
  );

/** Every product URL the shop advertises, via its sitemap index. */
async function productUrls() {
  const index = await get(`${ORIGIN}/sitemap.xml`);
  // A plain sitemap lists pages directly instead of pointing at sub-sitemaps;
  // treat it as its own single section.
  const sections = /<sitemapindex/i.test(index) ? locs(index) : [`${ORIGIN}/sitemap.xml`];
  console.log(`sitemap index: ${sections.length} section(s)`);
  if (sections.length === 0) {
    console.log('\n--- what the shop sent back (first 600 characters) ---');
    console.log(index.slice(0, 600));
    console.log('--- end ---\n');
  }

  // Read every section (following nested indexes), remembering which section
  // each address came from. The shop uses readable addresses (/catan), so a
  // product page cannot be told apart by its address — only by the section
  // the sitemap filed it under.
  const bySection = new Map();
  const queue = [...sections];
  const seen = new Set();
  while (queue.length) {
    const section = queue.shift();
    if (seen.has(section)) continue;
    seen.add(section);
    try {
      const xml = await get(section);
      if (/<sitemapindex/i.test(xml)) {
        queue.push(...locs(xml));
      } else {
        bySection.set(section, locs(xml));
      }
      await sleep(DELAY_MS);
    } catch (err) {
      console.warn(`  ! could not read ${section}: ${err.message}`);
    }
  }

  for (const [section, list] of bySection) {
    console.log(`  ${String(list.length).padStart(5)}  ${section}`);
  }

  const productSections = [...bySection.keys()].filter((s) => /product/i.test(s));
  const urls = new Set();
  if (productSections.length) {
    for (const s of productSections) for (const u of bySection.get(s)) urls.add(u);
  } else {
    // No section is labelled as products: take everything except the obvious
    // non-product pages. A page with no product photo is dropped later anyway.
    console.log('  (no section is labelled "product"; scanning every page)');
    for (const list of bySection.values()) {
      for (const u of list) {
        if (!/(category|manufacturer|information|blog|path=|route=common)/i.test(u)) urls.add(u);
      }
    }
  }
  return [...urls];
}

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();

function meta(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
    'i',
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`,
    'i',
  );
  return (html.match(re) || html.match(alt) || [])[1];
}

/** Title and main photo for one product page. */
function parseProduct(html) {
  const title =
    meta(html, 'og:title') ||
    (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, '') ||
    (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];

  // og:image is the product shot on every OpenCart theme worth the name; the
  // gallery link is the fallback, and it points at the full-size original
  // rather than the thumbnail the page displays.
  let image =
    meta(html, 'og:image') ||
    (html.match(/<a[^>]+class=["'][^"']*thumbnail[^"']*["'][^>]+href=["']([^"']+)["']/i) || [])[1] ||
    (html.match(/<img[^>]+src=["']([^"']*image\/cache\/catalog[^"']+)["']/i) || [])[1];

  if (image && !/^https?:/i.test(image)) {
    image = new URL(image, ORIGIN).href;
  }
  return { title: title ? decode(title) : null, imageUrl: image || null };
}

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'p';

/** Run `worker` over `items`, a few at a time. */
async function pool(items, size, worker) {
  let cursor = 0;
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
      await sleep(DELAY_MS);
    }
  });
  await Promise.all(runners);
}

async function main() {
  await mkdir(IMG_DIR, { recursive: true });
  const already = new Set(await readdir(IMG_DIR).catch(() => []));

  console.log('reading the shop sitemap…');
  const urls = await productUrls();
  console.log(`${urls.length} product page(s) to archive\n`);
  if (urls.length === 0) {
    console.error('No product URLs found. The shop may already be down.');
    process.exitCode = 1;
    return;
  }

  const manifest = [];
  const failures = [];
  let done = 0;

  await pool(urls, CONCURRENCY, async (url) => {
    done += 1;
    const progress = `[${String(done).padStart(4)}/${urls.length}]`;
    try {
      const { title, imageUrl } = parseProduct(await get(url));
      if (!title || !imageUrl) throw new Error('no title or image on the page');

      const ext = (imageUrl.match(/\.(jpe?g|png|webp|gif)(?:\?|$)/i) || [, 'jpg'])[1].toLowerCase();
      // The name alone is not unique: Arabic titles have no Latin letters to
      // slug, and "Rubiks 3x3" and "Rubiks 3x3 ميدالية" slug identically. A
      // fingerprint of the product's own address keeps every file distinct.
      const tag = createHash('sha1').update(url).digest('hex').slice(0, 8);
      const file = `${slugify(title)}-${tag}.${ext}`;

      if (!already.has(file)) {
        const res = await get(imageUrl, true);
        await pipeline(Readable.fromWeb(res.body), createWriteStream(path.join(IMG_DIR, file)));
        already.add(file);
      }
      manifest.push({ title, productUrl: url, imageUrl, file });
      console.log(`${progress} ${title}`);
    } catch (err) {
      failures.push({ url, error: err.message });
      console.warn(`${progress} ! ${url} — ${err.message}`);
    }

    // Written as we go: if the shop dies halfway, what was archived is saved.
    if (done % 25 === 0 || done === urls.length) {
      await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    }
  });

  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (failures.length) {
    await writeFile(path.join(OUT_DIR, 'failures.json'), JSON.stringify(failures, null, 2));
  }

  console.log(`\narchived ${manifest.length} product(s) into ${OUT_DIR}`);
  if (failures.length) console.log(`${failures.length} failed — see failures.json (re-run to retry)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
