// buildPopularBooks.mjs
//
// Reads the existing popularBooks.js to get the book list (title + author),
// then fetches cover AND metadata (description, genre, pages, published year)
// for any book missing the description field. Incremental: re-runs skip
// already-complete books.
//
// Usage:
//   PowerShell: $env:GOOGLE_BOOKS_API_KEY = "your_key_here"
//   node buildPopularBooks.mjs
//
// Force re-fetch all: node buildPopularBooks.mjs --force

import { writeFileSync } from "node:fs";

const API_KEY = process.env.GOOGLE_BOOKS_API_KEY || "";
const FORCE = process.argv.includes("--force");

if (!API_KEY) {
  console.error("\n  ERROR: No API key found. Set GOOGLE_BOOKS_API_KEY env var.\n");
  process.exit(1);
}

console.log(
  `Using API key: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)} (length ${API_KEY.length})`
);

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// A book is "complete" if `description` is defined (null is fine — it means
// we tried and Google Books had none).
const isComplete = (b) => b && b.description !== undefined;

// Load the existing popularBooks.js — this gives us BOTH the list of books
// to process AND any already-fetched data we can skip.
let existingBooks = [];
try {
  const mod = await import("./popularBooks.js");
  existingBooks = mod.default || [];
  const complete = existingBooks.filter(isComplete).length;
  console.log(
    `Loaded ${existingBooks.length} books from popularBooks.js ` +
      `(${complete} already complete, ${existingBooks.length - complete} need description fetch).`
  );
} catch (e) {
  console.error("ERROR: Could not load popularBooks.js — make sure you're running this from the same folder.");
  console.error(e.message);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const toHttps = (url) => (url ? url.replace(/^http:\/\//, "https://") : null);

function extractMeta(info, cover) {
  const rawDesc = info?.description || "";
  const description = rawDesc
    ? rawDesc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    : null;
  return {
    cover,
    description: description || null,
    genre: info?.categories?.[0] || null,
    pages: info?.pageCount || null,
    published: info?.publishedDate ? String(info.publishedDate).slice(0, 4) : null,
  };
}

function pickBestFromItems(items) {
  for (const it of items || []) {
    const info = it?.volumeInfo;
    const links = info?.imageLinks;
    const cover = links?.thumbnail || links?.smallThumbnail;
    if (cover) return extractMeta(info, toHttps(cover));
  }
  const first = items?.[0]?.volumeInfo;
  return extractMeta(first, null);
}

async function queryGoogleBooks(queryString, label, retries = 0) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(queryString)}&maxResults=5&key=${API_KEY}`;
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      if (retries < 3) {
        const backoffMs = 1500 + retries * 1000;
        console.warn(`\n  ! 429 rate limit for "${label}" — backing off ${backoffMs}ms, retry ${retries + 1}/3`);
        await sleep(backoffMs);
        return queryGoogleBooks(queryString, label, retries + 1);
      }
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    return data.items || [];
  } catch {
    return null;
  }
}

async function fetchBookData(title, author) {
  let items = await queryGoogleBooks(`intitle:${title} inauthor:${author}`, title);
  let result = pickBestFromItems(items);
  if (result.cover && result.description) return result;

  items = await queryGoogleBooks(`${title} ${author}`, title);
  let result2 = pickBestFromItems(items);

  // Prefer the one with both cover AND description
  const score = (r) => (r.cover ? 2 : 0) + (r.description ? 2 : 0) + (r.genre ? 1 : 0);
  return score(result2) > score(result) ? result2 : result;
}

async function main() {
  const toFetch = FORCE ? existingBooks : existingBooks.filter((b) => !isComplete(b));

  console.log(
    `\n${existingBooks.length} books total: ` +
      `${existingBooks.length - toFetch.length} reused, ${toFetch.length} to fetch.\n`
  );

  if (toFetch.length === 0) {
    console.log("Nothing to fetch — popularBooks.js is already complete. Use --force to refetch all.");
    return;
  }

  const out = [];
  let coverHit = 0;
  let descHit = 0;
  let fetched = 0;

  for (const b of existingBooks) {
    if (!FORCE && isComplete(b)) {
      out.push(b);
      if (b.cover) coverHit++;
      if (b.description) descHit++;
      continue;
    }

    const data = await fetchBookData(b.title, b.author);

    // Keep old cover if new fetch didn't find one
    const cover = data.cover || b.cover || null;

    const merged = {
      title: b.title,
      author: b.author,
      cover,
      description: data.description,
      genre: data.genre,
      pages: data.pages,
      published: data.published,
      key: b.key || ("pop-" + slug(b.title + "-" + b.author)),
    };

    out.push(merged);
    if (cover) coverHit++;
    if (merged.description) descHit++;
    fetched++;
    process.stdout.write(
      `\r  fetched ${fetched}/${toFetch.length} ` +
        `(${coverHit} covers, ${descHit} descriptions / ${existingBooks.length} total)   `
    );
    await sleep(250);
  }
  console.log("");

  const fileBody = `// popularBooks.js
// AUTO-GENERATED by buildPopularBooks.mjs — do not hand-edit.
//
// Curated popular books with cover URLs AND metadata (description, genre,
// pages, published year) baked in — so the app shows titles, covers, AND
// More info content instantly with zero network calls.

const POPULAR_BOOKS = ${JSON.stringify(out, null, 2)};

export default POPULAR_BOOKS;
`;

  writeFileSync("./popularBooks.js", fileBody, "utf8");
  console.log(
    `Done. ${coverHit}/${existingBooks.length} covers, ${descHit}/${existingBooks.length} descriptions. ` +
      `Wrote popularBooks.js`
  );

  const missingDesc = out.filter((b) => !b.description);
  if (missingDesc.length > 0) {
    console.log(`\n${missingDesc.length} books have no description from Google Books:`);
    missingDesc.slice(0, 10).forEach((b) => console.log("  -", b.title, "by", b.author));
    if (missingDesc.length > 10) console.log(`  ... and ${missingDesc.length - 10} more`);
  }
}

main();