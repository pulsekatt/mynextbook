import { useState, useEffect, useRef } from "react";
import POPULAR_BOOKS from "./popularBooks";

const GOOGLE_BOOKS_API_KEY = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY;
const AMAZON_TAG = import.meta.env.VITE_AMAZON_TAG;

// Bestseller cache: persisted in localStorage with a 24h TTL so repeat visits
// hit instant-search from second 0 without re-fetching anything.
const CACHED_BOOKS_KEY = "popularBookCovers_v2";
const CACHED_BOOKS_TTL_MS = 24 * 60 * 60 * 1000;

// Search-result cache: live Google Books search responses by normalized query.
// Same queries get repeated constantly (popular titles especially) — caching
// these in localStorage with a 7-day TTL saves a huge chunk of the daily quota.
const SEARCH_CACHE_KEY = "bookSearchCache_v1";
const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 200; // keep storage size bounded

// Enrichment cache: per-recommendation {cover, genre, pages, published} keyed
// by "title|||author". The model recommends the same well-known books over and
// over, so cache hit rate is high. 30-day TTL — these fields rarely change.
const ENRICH_CACHE_KEY = "bookEnrichCache_v1";
const ENRICH_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ENRICH_CACHE_MAX_ENTRIES = 500;

// If a search turns up at least this many strong matches in our local popular-
// books cache, we show those and skip the Google Books API entirely. This is
// the single biggest quota saver: common searches ("stephen king", "tolkien",
// "the power of") are fully answered from the bundled cache with zero calls.
const MIN_CACHE_HITS_TO_SKIP_API = 5;

// Sharing — the public site URL and the message used when sharing.
const SHARE_URL = "https://mynextbook.io";
const SHARE_TEXT =
  "I found my next read with My Next Book — a free AI tool that recommends books based on what you've loved. Try it:";

// Header taglines — one is picked at random on each load to keep the landing
// fresh for repeat visitors. Each is a [setup, payoff] pair shown on two lines.
const TAGLINES = [
  ["Tell us what you couldn't put down.", "We'll find the next one."],
  ["You finished the book.", "Let's find your next obsession."],
  ["Tell us what you've loved reading —", "we'll find your next obsession."],
  ["The end of \u201cwhat should I read next?\u201d", "starts here."],
  ["You've got great taste.", "Let's prove it."],
  ["Books you'll love,", "chosen from the ones you already do."],
  ["Your next obsession is already out there.", "Let's go get it."],
  ["Great readers never run out", "of great books."],
  ["Never stare at your bookshelf again.", "Tell us what you loved."],
  ["Five books. Zero guesswork.", "One you won't put down."],
];

const LOADING_MESSAGES = [
  "📖 Analysing your reading taste...",
  "🔍 Searching the literary universe...",
  "🧠 Thinking like a librarian...",
  "✨ Discovering hidden gems...",
  "📚 Almost there, hang tight...",
];

// ---- localStorage cache helpers (search + enrichment) ----------------------

const normKey = (s) => (s || "").trim().toLowerCase();

function readCache(key, ttlMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Drop expired entries on read so the cache self-cleans over time.
    const now = Date.now();
    const fresh = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v === "object" && now - (v.t || 0) < ttlMs) fresh[k] = v;
    }
    return fresh;
  } catch {
    return {};
  }
}

function writeCache(key, obj, maxEntries) {
  try {
    // If we're over the cap, drop the oldest entries first.
    const entries = Object.entries(obj);
    if (entries.length > maxEntries) {
      entries.sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
      obj = Object.fromEntries(entries.slice(0, maxEntries));
    }
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {
    // ignore quota errors
  }
}

// Rank cached (popular) books by how well they match the query, best first.
// Scoring (highest wins): exact title > title starts-with > whole word in
// title > substring in title > author starts-with > author substring.
// This is what makes "the power of" surface "The Power of Now" / "The Power
// of Habit" at the top instead of being buried under generic API results.
// Array.sort is stable, so ties keep the curated order from popularBooks.js
// (which is itself roughly popularity-ordered), giving bestsellers priority.
function rankCachedMatches(books, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const b of books) {
    const title = (b.title || "").toLowerCase();
    const author = (b.author || "").toLowerCase();
    let score = 0;
    if (title === q) score = 100;
    else if (title.startsWith(q)) score = 80;
    else if (title.includes(" " + q)) score = 60;
    else if (title.includes(q)) score = 40;
    else if (author.startsWith(q)) score = 30;
    else if (author.includes(q)) score = 20;
    if (score > 0) scored.push({ b, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.b);
}

export default function App() {
  const [hoveredFindButton, setHoveredFindButton] = useState(false);
  const [hoveredButton, setHoveredButton] = useState(null);
  const [hoveredInfo, setHoveredInfo] = useState(null);
  const [hoveredNotInterested, setHoveredNotInterested] = useState(null);
  const [hoveredAlreadyRead, setHoveredAlreadyRead] = useState(null);
  const [hoveredHome, setHoveredHome] = useState(false);
  const [hoveredClearAll, setHoveredClearAll] = useState(false);
  const [hoveredStop, setHoveredStop] = useState(false);
  // Sharing UI state: which share button is hovered, and a brief "Copied!"
  // confirmation after the copy-link button is used.
  const [hoveredShare, setHoveredShare] = useState(null);
  const [shareCopied, setShareCopied] = useState(false);
  // Pick a random header tagline once, on first render, so it stays stable for
  // the whole session but varies between visits.
  const [tagline] = useState(
    () => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]
  );
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= 600 : false
  );
  // Touch-only devices ("hover: none" media query) — used to skip hover state
  // entirely so :hover effects don't get stuck after a tap, and so the hover
  // state from one card doesn't "bleed" onto the next when a card is dismissed
  // and the finger ends up over the card below.
  const [isTouch, setIsTouch] = useState(false);
  const [query, setQuery] = useState("");
  const [dropdown, setDropdown] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hoveredBook, setHoveredBook] = useState(null);
  const [hoveredCover, setHoveredCover] = useState(null);
  const [hoveredDropdown, setHoveredDropdown] = useState(null);
  const [booksExpanded, setBooksExpanded] = useState(true);
  const [expandedRec, setExpandedRec] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [cachedBooks, setCachedBooks] = useState(POPULAR_BOOKS);
  const [dismissing, setDismissing] = useState(null);
  const [myBooks, setMyBooks] = useState(() => {
    const saved = localStorage.getItem("myBooks");
    return saved ? JSON.parse(saved) : [];
  });
  const [notInterested, setNotInterested] = useState(() => {
    const saved = localStorage.getItem("notInterested");
    return saved ? JSON.parse(saved) : [];
  });
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const searchAbortRef = useRef(null);
  const recommendAbortRef = useRef(null);
  const dropdownRef = useRef(null);
  const loadingRef = useRef(null);
  const progressRef = useRef(null);
  const progressStartRef = useRef(null);
  // Search-results cache is kept in a ref so changes don't trigger re-renders.
  const searchCacheRef = useRef(null);
  const enrichCacheRef = useRef(null);

  useEffect(() => {
    // POPULAR_BOOKS ships with cover URLs baked in (see buildPopularBooks.mjs),
    // so titles + covers are available instantly on load with zero network calls.
    //
    // We still APPLY previously-cached covers from localStorage (for any book
    // that was missing a cover at build time but got one filled in on a prior
    // visit), but we no longer FETCH on mount — if a book has no cover after
    // this step, it just shows the 📖 placeholder until something else (e.g.
    // the user adding it as a recommendation) happens to fetch it.
    try {
      const raw = localStorage.getItem(CACHED_BOOKS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed?.covers) return;
      if (Date.now() - (parsed.timestamp || 0) > CACHED_BOOKS_TTL_MS) return;
      const stored = parsed.covers;
      if (Object.keys(stored).length === 0) return;
      setCachedBooks((prev) =>
        prev.map((b) => (!b.cover && stored[b.key] ? { ...b, cover: stored[b.key] } : b))
      );
    } catch {
      // ignore
    }
  }, []);

  // Load the search + enrichment caches once on mount.
  useEffect(() => {
    searchCacheRef.current = readCache(SEARCH_CACHE_KEY, SEARCH_CACHE_TTL_MS);
    enrichCacheRef.current = readCache(ENRICH_CACHE_KEY, ENRICH_CACHE_TTL_MS);
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 600);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Detect touch-only devices. We re-evaluate on change (devices that have
  // both touch and a mouse, like a Surface, will flip between modes).
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(hover: none)");
    setIsTouch(mql.matches);
    const handler = (e) => setIsTouch(e.matches);
    mql.addEventListener?.("change", handler);
    return () => mql.removeEventListener?.("change", handler);
  }, []);

  // On touch devices: skip every hover-state setter so :hover-style effects
  // never activate. On desktop these pass straight through to setState.
  // Usage: onMouseEnter={tap(setHoveredFoo, true)} onMouseLeave={tap(setHoveredFoo, false)}
  const tap = (fn, val) => () => { if (!isTouch) fn(val); };
  // Reset every per-card hover state — called after dismissing a card, so the
  // hover state from the card that just disappeared doesn't visually "stick"
  // to the card now sitting under the cursor / finger.
  const clearAllCardHovers = () => {
    setHoveredBook(null);
    setHoveredCover(null);
    setHoveredButton(null);
    setHoveredInfo(null);
    setHoveredAlreadyRead(null);
    setHoveredNotInterested(null);
  };

  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
        setSelectedIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    localStorage.setItem("myBooks", JSON.stringify(myBooks));
  }, [myBooks]);

  useEffect(() => {
    localStorage.setItem("notInterested", JSON.stringify(notInterested));
  }, [notInterested]);

  useEffect(() => {
    if (loading) {
      setProgress(0);
      setLoadingMsg(0);
      let msg = 0;
      loadingRef.current = setInterval(() => {
        msg = (msg + 1) % LOADING_MESSAGES.length;
        setLoadingMsg(msg);
      }, 1800);

      // Smooth, time-based easing. Instead of random jumps that slam to 90%
      // and then stall, we ease continuously toward ~95% over a long horizon
      // so the bar keeps creeping the whole time it's loading.
      const EXPECTED_MS = 14000; // rough horizon; bar approaches 95% over this
      progressStartRef.current = Date.now();
      progressRef.current = setInterval(() => {
        const elapsed = Date.now() - progressStartRef.current;
        const t = elapsed / EXPECTED_MS;
        // easeOut curve: fast-ish at first, gently decelerating, capped at 95%.
        const eased = 1 - Math.pow(1 - Math.min(t, 1), 2.2);
        setProgress(Math.min(eased * 95, 95));
      }, 80);
    } else {
      setProgress(100);
      clearInterval(loadingRef.current);
      clearInterval(progressRef.current);
      setTimeout(() => setProgress(0), 600);
    }
    return () => {
      clearInterval(loadingRef.current);
      clearInterval(progressRef.current);
    };
  }, [loading]);

  useEffect(() => {
    if (query.length < 1) {
      setDropdown([]);
      setSearching(false);
      setSelectedIndex(-1);
      clearTimeout(debounceRef.current);
      return;
    }

    // Rank local (popular-cache) matches synchronously — relevance-ordered so
    // the most on-point bestsellers lead.
    const ranked = rankCachedMatches(cachedBooks, query);

    // FAST PATH: if we already have enough strong local matches, show them
    // instantly and skip the network entirely — no debounce, no spinner, no
    // API call. This is where most of the quota savings come from.
    if (ranked.length >= MIN_CACHE_HITS_TO_SKIP_API) {
      clearTimeout(debounceRef.current);
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
        searchAbortRef.current = null;
      }
      setDropdown(ranked.slice(0, 15));
      setDropdownOpen(true);
      setSelectedIndex(-1);
      setSearching(false);
      return;
    }

    // SLOW PATH: not enough local matches. Show whatever we have right away so
    // the dropdown isn't empty, then fetch live to supplement / fill it out.
    if (ranked.length > 0) {
      setDropdown(ranked.slice(0, 15));
      setDropdownOpen(true);
      setSelectedIndex(-1);
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      // Check the localStorage search cache first — same query within the TTL
      // skips the API entirely and renders instantly.
      const cacheKey = normKey(query);
      const cacheStore = searchCacheRef.current || {};
      const cachedEntry = cacheStore[cacheKey];
      let liveResults = null;
      if (cachedEntry && Date.now() - cachedEntry.t < SEARCH_CACHE_TTL_MS) {
        liveResults = cachedEntry.results;
      }

      // Only flip the spinner on if we actually need to hit the network.
      if (!liveResults) setSearching(true);
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        if (!liveResults) {
          const res = await fetch(
            `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
              query
            )}&maxResults=15&key=${GOOGLE_BOOKS_API_KEY}`,
            { signal: controller.signal }
          );
          const data = await res.json();
          // Surface API-level errors (bad/blocked key, quota exceeded, etc.) instead
          // of silently showing an empty dropdown. data.error is Google's error shape.
          if (!res.ok || data.error) {
            console.error(
              "Google Books search error:",
              res.status,
              data.error?.message || "(no message)"
            );
          }
          liveResults = (data.items || [])
            .filter((b) => b && b.volumeInfo && b.volumeInfo.title)
            .map((b) => ({
              title: b.volumeInfo.title,
              author: b.volumeInfo.authors?.[0] || "Unknown",
              cover: b.volumeInfo.imageLinks?.smallThumbnail || b.volumeInfo.imageLinks?.thumbnail || null,
              key: b.id,
            }));

          // Persist the response so the next identical query is free.
          if (liveResults.length > 0) {
            cacheStore[cacheKey] = { t: Date.now(), results: liveResults };
            writeCache(SEARCH_CACHE_KEY, cacheStore, SEARCH_CACHE_MAX_ENTRIES);
          }
        }

        // Merge: RANKED CACHED FIRST (popular/relevant books lead), then live
        // results with covers, then live results without covers as a fallback.
        // Dedupe on BOTH the source key AND a normalized title+author signature,
        // so the same book appearing as multiple Google Books editions (or in
        // both the cache and live results) only shows up once.
        const sig = (b) => normKey(b.title) + "|||" + normKey(b.author);
        const seenKeys = new Set();
        const seenSigs = new Set();
        const merged = [];
        const tryAdd = (b) => {
          if (seenKeys.has(b.key) || seenSigs.has(sig(b))) return;
          merged.push(b);
          seenKeys.add(b.key);
          seenSigs.add(sig(b));
        };

        // First: ranked cached matches (popular books, relevance-ordered)
        for (const b of ranked) tryAdd(b);
        // Second: live results WITH covers
        for (const b of liveResults) {
          if (b.cover) tryAdd(b);
        }
        // Third: live results WITHOUT covers (fallback)
        for (const b of liveResults) {
          if (!b.cover) tryAdd(b);
        }

        // If the API returned nothing usable, fall back to ranked cached matches.
        const finalList = merged.length > 0 ? merged : ranked;
        setDropdown(finalList.slice(0, 15));
        setDropdownOpen(true);
        setSelectedIndex(-1);
      } catch (err) {
        // AbortError is expected when user hits Stop — ignore it.
        // On a real failure, show cached matches so the dropdown isn't empty.
        if (err.name !== "AbortError") {
          console.error(err);
          if (ranked.length > 0) {
            setDropdown(ranked.slice(0, 15));
            setDropdownOpen(true);
            setSelectedIndex(-1);
          }
        }
      } finally {
        searchAbortRef.current = null;
        setSearching(false);
      }
    }, 200);
  }, [query, cachedBooks]);

  const addBook = (book) => {
    // Dedupe by key AND by title+author, since the same book can arrive with
    // different keys (e.g. from the cached list vs a live Google Books result).
    const isDup = myBooks.some(
      (b) =>
        b.key === book.key ||
        (normKey(b.title) === normKey(book.title) && normKey(b.author) === normKey(book.author))
    );
    if (!isDup) setMyBooks([...myBooks, book]);
    setQuery("");
    setDropdown([]);
    setDropdownOpen(false);
    setSelectedIndex(-1);
  };

  const removeBook = (key) => setMyBooks(myBooks.filter((b) => b.key !== key));

  // Cancel an in-flight book search (debounce + fetch) and reset the spinner.
  const stopSearch = () => {
    clearTimeout(debounceRef.current);
    if (searchAbortRef.current) searchAbortRef.current.abort();
    searchAbortRef.current = null;
    setSearching(false);
  };

  const clearAll = () => {
    setMyBooks([]);
    setBooksExpanded(true);
  };

  // Reset back to the "home" state: clears recommendations and scrolls up,
  // but keeps the user's books so they can tweak and search again.
  const goHome = () => {
    setRecommendations([]);
    setExpandedRec(null);
    setError("");
    setBooksExpanded(true);
    setDismissing(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const dismissRec = (idx, direction = "right") => {
    // Reset hover states immediately, so the hover effect from the dismissed
    // card doesn't bleed onto whichever card slides under the finger/cursor.
    clearAllCardHovers();
    if (direction === "right") {
      const rec = recommendations[idx];
      setNotInterested((prev) => {
        if (prev.some((b) => b.title === rec.title && b.author === rec.author)) return prev;
        return [...prev, { title: rec.title, author: rec.author }];
      });
    }
    setDismissing({ idx, dir: direction });
    setTimeout(() => {
      setRecommendations((prev) => prev.filter((_, i) => i !== idx));
      setDismissing(null);
      if (expandedRec === idx) setExpandedRec(null);
      else if (expandedRec !== null && expandedRec > idx) setExpandedRec(expandedRec - 1);
    }, 1000);
  };

  const markAsRead = (idx) => {
    const rec = recommendations[idx];
    const book = {
      title: rec.title,
      author: rec.author,
      cover: rec.cover || null,
      key: rec.title + "-" + rec.author,
    };
    if (!myBooks.find((b) => b.key === book.key)) {
      setMyBooks((prev) => [...prev, book]);
    }
    dismissRec(idx, "left");
  };

  const getRecommendations = async () => {
    setLoading(true);
    setError("");
    setRecommendations([]);
    setExpandedRec(null);
    const controller = new AbortController();
    recommendAbortRef.current = controller;
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ myBooks, notInterested }),
        signal: controller.signal,
      });

      // Errors come back as plain JSON with an "error" message.
      if (!res.ok) {
        let msg = "Failed to get recommendations. Try again.";
        try {
          const j = await res.json();
          if (j.error) msg = j.error;
        } catch {}
        setError(msg);
        return;
      }

      const { recommendations: recs } = await res.json();

      // Pull factual fields (cover, genre, pages, year) from Google Books
      // — these are real data, unlike anything the model would guess.
      // We cache enrichment by "title|||author" in localStorage, so repeated
      // recommendations of the same well-known book skip the API entirely.
      const enrichStore = enrichCacheRef.current || {};
      let enrichDirty = false;

      const recsWithCovers = await Promise.all(
        recs.map(async (r) => {
          const eKey = normKey(r.title) + "|||" + normKey(r.author);
          const cached = enrichStore[eKey];
          if (cached && Date.now() - cached.t < ENRICH_CACHE_TTL_MS) {
            return { ...r, ...cached.data };
          }

          try {
            const coverRes = await fetch(
              `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
                `intitle:${r.title} inauthor:${r.author}`
              )}&maxResults=5&key=${GOOGLE_BOOKS_API_KEY}`,
              { signal: controller.signal }
            );
            const coverData = await coverRes.json();
            let items = coverData.items || [];

            // If the strict intitle/inauthor query found nothing, retry with a
            // looser plain-text query — some catalog titles differ slightly.
            if (items.length === 0) {
              const loose = await fetch(
                `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
                  r.title + " " + r.author
                )}&maxResults=5&key=${GOOGLE_BOOKS_API_KEY}`,
                { signal: controller.signal }
              );
              const looseData = await loose.json();
              items = looseData.items || [];
            }

            // Find the first edition that actually has a cover image.
            let info = items[0]?.volumeInfo || {};
            let cover = null;
            for (const it of items) {
              const links = it.volumeInfo?.imageLinks;
              const c = links?.thumbnail || links?.smallThumbnail;
              if (c) {
                cover = c;
                info = it.volumeInfo; // use the edition we got the cover from for genre/pages too
                break;
              }
            }
            // Force https so the image loads on an https site (avoid mixed-content block).
            cover = cover ? cover.replace(/^http:\/\//, "https://") : null;

            const enriched = {
              cover,
              genre: info.categories?.[0] || null,
              pages: info.pageCount || null,
              published: info.publishedDate ? String(info.publishedDate).slice(0, 4) : null,
            };

            // Only cache when we got *something* useful — don't poison the
            // cache with empty results from a hiccup.
            if (cover || enriched.genre || enriched.pages || enriched.published) {
              enrichStore[eKey] = { t: Date.now(), data: enriched };
              enrichDirty = true;
            }

            return { ...r, ...enriched };
          } catch {
            return { ...r, cover: null };
          }
        })
      );

      if (enrichDirty) {
        writeCache(ENRICH_CACHE_KEY, enrichStore, ENRICH_CACHE_MAX_ENTRIES);
      }

      const sorted = [...recsWithCovers]
        .filter((r) => !notInterested.some((ni) => ni.title.toLowerCase() === r.title.toLowerCase() && ni.author.toLowerCase() === r.author.toLowerCase()))
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      setRecommendations(sorted);
    } catch (err) {
      // AbortError = user pressed Stop; don't show an error in that case.
      if (err.name !== "AbortError") {
        setError("Failed to get recommendations. Try again.");
      }
    } finally {
      recommendAbortRef.current = null;
      setLoading(false);
    }
  };

  // Stop an in-flight recommendation request without clearing the book list.
  const stopRecommend = () => {
    if (recommendAbortRef.current) recommendAbortRef.current.abort();
    recommendAbortRef.current = null;
    setLoading(false);
  };

  const renderConfidence = (confidence) => {
    if (!confidence) return null;

    let gradient;
    if (confidence >= 90) {
      gradient = "linear-gradient(90deg, #7c3aed, #a78bfa)";
    } else if (confidence >= 80) {
      gradient = "linear-gradient(90deg, #4f46e5, #818cf8)";
    } else {
      gradient = "linear-gradient(90deg, #9ca3af, #d1d5db)";
    }

    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#a78bfa" }}>
            🎯 {confidence}% match
          </span>
        </div>
        <div style={{ background: "#f0ebff", borderRadius: 99, height: 5, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${confidence}%`,
              background: gradient,
              borderRadius: 99,
              transition: "width 1s ease",
            }}
          />
        </div>
      </div>
    );
  };

  // A small fact pill for the "More info" panel.
  const InfoPill = ({ icon, label }) => (
    <span
      className="info-pill"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        background: "#f0ebff",
        border: "1px solid #e2d9f3",
        borderRadius: 99,
        padding: "6px 14px",
        fontSize: 13,
        fontWeight: 600,
        color: "#6b5fa0",
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  );

  const amazonLink = (title, author) =>
    `https://www.amazon.com/s?k=${encodeURIComponent(title + " " + author)}&tag=${AMAZON_TAG}`;

  // Share link builders. Each opens the platform's native share dialog in a
  // new tab pre-filled with our message + site URL.
  const shareLinks = {
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SHARE_URL)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SHARE_URL)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(SHARE_TEXT + " " + SHARE_URL)}`,
  };

  // Copy the site URL to the clipboard, with a short "Copied!" confirmation.
  // Falls back to a hidden textarea + execCommand on older/insecure contexts
  // where navigator.clipboard isn't available.
  const copyShareLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(SHARE_URL);
      } else {
        const ta = document.createElement("textarea");
        ta.value = SHARE_URL;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // If copy fails entirely, do nothing — the other share buttons still work.
    }
  };

  const collapsed = recommendations.length > 0;

  return (
    <div className="app-root" style={{ minHeight: "100vh", background: "#f0ede8", fontFamily: "'Segoe UI', sans-serif" }}>
      <style>{`
        .app-root {
          user-select: none;
          cursor: default;
        }
        .app-root input {
          user-select: text;
          cursor: text;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(var(--rot, 0deg)); }
          50% { transform: translateY(-24px) rotate(calc(var(--rot, 0deg) + 4deg)); }
        }
        .floating-book {
          position: absolute;
          animation: float var(--dur, 11s) ease-in-out infinite;
          pointer-events: none;
          filter: grayscale(20%);
        }
        @keyframes fadeDown {
          0% { opacity: 0; transform: translateY(-12px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .fade-down {
          animation: fadeDown 0.8s ease-out forwards;
        }
        @keyframes slideIn {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .slide-in {
          animation: slideIn 0.6s ease-out forwards;
        }
        .step-card {
          transition: all 0.3s ease;
          cursor: default;
        }
        .step-card:hover {
          transform: translateY(-16px) scale(1.1);
          box-shadow: 0 16px 30px rgba(124, 58, 237, 0.14) !important;
        }
        .trust-pill {
          transition: all 0.25s ease;
        }
        .trust-pill:hover {
          transform: translateY(-3px);
          background: rgba(167,139,250,0.22) !important;
          border-color: rgba(167,139,250,0.55) !important;
        }
        .books-card {
          transition: box-shadow 0.3s ease, transform 0.3s ease;
        }
        .book-row {
          transition: background 0.2s ease, transform 0.2s ease;
          border-radius: 10px;
        }
        .book-row:hover {
          background: #faf8ff;
          transform: translateX(4px);
        }
        @keyframes dismissSlide {
          0% { opacity: 1; transform: translateX(0); max-height: 300px; margin-bottom: 16px; }
          60% { opacity: 0; transform: translateX(90px); max-height: 300px; margin-bottom: 16px; }
          100% { opacity: 0; transform: translateX(90px); max-height: 0; margin-bottom: 0; padding: 0; }
        }
        @keyframes dismissSlideLeft {
          0% { opacity: 1; transform: translateX(0); max-height: 300px; margin-bottom: 16px; }
          60% { opacity: 0; transform: translateX(-90px); max-height: 300px; margin-bottom: 16px; }
          100% { opacity: 0; transform: translateX(-90px); max-height: 0; margin-bottom: 0; padding: 0; }
        }
        .rec-dismissing {
          animation: dismissSlide 1s cubic-bezier(0.33, 0, 0.2, 1) forwards;
          overflow: hidden;
        }
        .rec-dismissing-left {
          animation: dismissSlideLeft 1s cubic-bezier(0.33, 0, 0.2, 1) forwards;
          overflow: hidden;
        }
        @keyframes dropdownReveal {
          0% { opacity: 0; transform: translateY(-8px); max-height: 0; }
          100% { opacity: 1; transform: translateY(0); max-height: 400px; }
        }
        @keyframes dropdownRevealUp {
          0% { opacity: 0; transform: translateY(8px); max-height: 0; }
          100% { opacity: 1; transform: translateY(0); max-height: 400px; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes stopFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes homeFadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes loadingBob {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50% { transform: translateY(-12px) rotate(3deg); }
        }
        .loading-book {
          display: inline-block;
          animation: loadingBob 2s ease-in-out infinite;
        }
        .loading-view {
          animation: fadeDown 0.4s ease-out both;
        }
        /* The mobile info panel is hidden by default (desktop); the mobile
           media query below flips it on and hides the desktop panel instead. */
        .info-panel-mobile {
          display: none;
        }

        /* ---- Mobile tweaks (phones) ---- */
        @media (max-width: 600px) {
          /* Home button on mobile: collapse to a compact round icon-only
             button tucked in the corner, so it never overlaps the trust
             pills. The "Home" text label is hidden; just the 🏠 shows. */
          .home-button {
            top: 12px !important;
            right: 12px !important;
            padding: 6px !important;
            width: 30px !important;
            height: 30px !important;
            font-size: 11px !important;
            justify-content: center !important;
            gap: 0 !important;
          }
          .home-button span {
            font-size: 13px !important;
          }
          .home-label {
            display: none !important;
          }

          /* Action buttons row layout on mobile:
             - Buy + More-info share row 1 side-by-side
             - More info FULL WIDTH on top (order: -1)
             - Buy on Amazon FULL WIDTH below it
             - Already-read FULL WIDTH
             - Not-interested FULL WIDTH
             (Stacked vertically so each is easy to tap without misfires.) */
          .rec-actions {
            gap: 8px !important;
          }
          .buy-btn,
          .info-btn {
            flex: 1 1 100% !important;
            text-align: center !important;
          }
          /* More info sits ABOVE the Amazon buy button on mobile. */
          .info-btn {
            order: -1 !important;
          }
          /* On mobile, the info panel slides in at the very top of the button
             column (above More info), not at the bottom of the card. Swap which
             panel is visible. */
          .info-panel-mobile {
            display: grid !important;
            order: -2 !important;
            flex: 1 1 100% !important;
          }
          .info-panel-desktop {
            display: none !important;
          }
          /* Shrink the genre/pages/year pills on mobile so all three fit on a
             single line without wrapping. */
          .info-pill {
            padding: 5px 10px !important;
            font-size: 11px !important;
            gap: 5px !important;
          }
          .info-panel-mobile > div > div {
            flex-wrap: nowrap !important;
          }
          /* Keep the loading view at its original (smaller) size on mobile —
             the larger sizing only applies on PC. */
          .loading-book {
            font-size: 52px !important;
            margin-bottom: 18px !important;
          }
          .loading-message {
            font-size: 18px !important;
            min-height: 28px !important;
            margin-bottom: 22px !important;
          }
          .loading-bar {
            max-width: 420px !important;
            height: 8px !important;
            margin-bottom: 24px !important;
          }
          .already-read-btn,
          .not-interested-btn {
            flex: 1 1 100% !important;
            margin-left: 0 !important;
            justify-content: center !important;
            text-align: center !important;
          }
          .already-read-btn {
            display: inline-flex !important;
            align-items: center !important;
          }

          /* Tighten up the recommendation cards on mobile so they take less
             vertical space and don't feel oversized on a phone screen. */
          .rec-card {
            padding: 14px !important;
            border-radius: 14px !important;
            margin-bottom: 12px !important;
          }

          /* 2. Smaller, shorter search bar + placeholder on mobile */
          .search-input {
            padding: 16px 14px !important;
            font-size: 17px !important;
          }
          .search-input.collapsed {
            padding: 11px 14px !important;
            font-size: 15px !important;
          }
          .search-wrap {
            width: 100% !important;
            margin-left: 0 !important;
          }
          .search-label {
            font-size: 14px !important;
            margin-bottom: 6px !important;
          }

          /* 3. Stack the "how it works" cards vertically on mobile */
          .cards-row {
            flex-direction: column !important;
            width: 100% !important;
            margin-left: 0 !important;
          }

          /* Let other fixed-width regions go full width on mobile */
          .books-card,
          .recs-wrap {
            width: 100% !important;
            margin-left: 0 !important;
          }

          /* 4. Recommendation: image first, text below (stack vertically) */
          .rec-main {
            flex-direction: column !important;
            align-items: center !important;
            text-align: center !important;
          }
          .rec-cover,
          .rec-cover-placeholder {
            width: 100px !important;
            height: 145px !important;
          }
          .rec-confidence-wrap {
            text-align: left;
          }

          /* 5. Slightly smaller recommendation description text on mobile */
          .rec-details {
            font-size: 14px !important;
          }
        }
      `}</style>

      {progress > 0 && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: `${progress}%`,
            height: 3,
            background: "linear-gradient(90deg, #c084fc, #818cf8)",
            transition: "width 0.2s linear",
            zIndex: 999,
          }}
        />
      )}

      {/* Header */}
      <div
        style={{
          background: "linear-gradient(180deg, #1e1b4b 0%, #1e3a5f 100%)",
          padding: loading ? "32px 20px 56px" : "44px 20px 84px",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
          transition: "padding 0.5s ease",
        }}
      >
        {/* Home button — only shown once recommendations exist. */}
        {collapsed && (
          <button
            className="home-button"
            onClick={goHome}
            onMouseEnter={tap(setHoveredHome, true)}
            onMouseLeave={tap(setHoveredHome, false)}
            style={{
              position: "absolute",
              top: 20,
              right: 20,
              zIndex: 2,
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              background: hoveredHome ? "rgba(167,139,250,0.28)" : "rgba(167,139,250,0.12)",
              border: "1px solid rgba(167,139,250,0.4)",
              borderRadius: 99,
              padding: "8px 16px",
              color: "#c4b5fd",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0.3,
              cursor: "pointer",
              backdropFilter: "blur(4px)",
              transform: hoveredHome ? "scale(1.05)" : "scale(1)",
              transition: "transform 0.25s ease, background 0.25s ease",
              animation: "homeFadeIn 0.5s ease-out both",
            }}
          >
            <span style={{ fontSize: 14 }}>🏠</span>
            <span className="home-label">Home</span>
          </button>
        )}

        {[
          { emoji: "📕", left: "7%", top: "20%", size: 46, dur: "12s", delay: "0s", rot: "-12deg", op: 0.26 },
          { emoji: "📗", left: "15%", top: "58%", size: 30, dur: "14s", delay: "1.5s", rot: "8deg", op: 0.12 },
          { emoji: "📘", left: "26%", top: "16%", size: 26, dur: "10s", delay: "0.8s", rot: "15deg", op: 0.1 },
          { emoji: "📚", left: "33%", top: "70%", size: 38, dur: "13s", delay: "2.6s", rot: "-6deg", op: 0.22 },
          { emoji: "📔", left: "44%", top: "82%", size: 22, dur: "13.5s", delay: "3s", rot: "6deg", op: 0.09 },
          { emoji: "📙", right: "8%", top: "24%", size: 48, dur: "13s", delay: "0.4s", rot: "10deg", op: 0.27 },
          { emoji: "📚", right: "18%", top: "62%", size: 34, dur: "11s", delay: "2.2s", rot: "-8deg", op: 0.15 },
          { emoji: "📖", right: "29%", top: "14%", size: 24, dur: "15s", delay: "1.1s", rot: "-15deg", op: 0.1 },
          { emoji: "📓", right: "37%", top: "74%", size: 28, dur: "12.5s", delay: "1.9s", rot: "12deg", op: 0.13 },
          { emoji: "📕", right: "46%", top: "20%", size: 20, dur: "14.5s", delay: "3.4s", rot: "-10deg", op: 0.08 },
          { emoji: "📗", left: "2%", top: "70%", size: 24, dur: "11.5s", delay: "2.8s", rot: "14deg", op: 0.11 },
          { emoji: "📘", right: "2%", top: "68%", size: 26, dur: "12.8s", delay: "0.6s", rot: "-14deg", op: 0.12 },
        ].map((b, idx) => (
          <div
            key={idx}
            className="floating-book"
            style={{
              left: b.left,
              right: b.right,
              top: b.top,
              fontSize: b.size,
              opacity: b.op,
              "--dur": b.dur,
              "--rot": b.rot,
              animationDelay: b.delay,
            }}
          >
            {b.emoji}
          </div>
        ))}

        <div
          style={{
            position: "relative",
            zIndex: 1,
            transform: loading ? "scale(0.82)" : "scale(1)",
            transformOrigin: "center top",
            transition: "transform 0.5s ease",
          }}
        >
          <div
            className="fade-down"
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 11,
              marginBottom: 18,
            }}
          >
            {[
              { icon: "✨", label: "AI-POWERED" },
              { icon: "🔓", label: "NO LOGIN" },
              { icon: "💸", label: "100% FREE" },
            ].map((pill, idx) => (
              <div
                key={idx}
                className="trust-pill"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  background: "rgba(167,139,250,0.12)",
                  border: "1px solid rgba(167,139,250,0.3)",
                  borderRadius: 99,
                  padding: "6px 16px",
                  backdropFilter: "blur(4px)",
                }}
              >
                <span style={{ fontSize: 13 }}>{pill.icon}</span>
                <span style={{ color: "#c4b5fd", fontSize: 12.5, fontWeight: 600, letterSpacing: 0.5 }}>
                  {pill.label}
                </span>
              </div>
            ))}
          </div>
          <h1
            style={{
              color: "white",
              fontSize: 56,
              margin: 0,
              fontWeight: 900,
              letterSpacing: -1.8,
              lineHeight: 1.05,
            }}
          >
            My Next Book
          </h1>
          <div
            style={{
              width: 60,
              height: 3,
              background: "linear-gradient(90deg, #7c3aed, #a78bfa)",
              borderRadius: 99,
              margin: loading ? "0 auto" : "18px auto 20px",
              opacity: loading ? 0 : 1,
              transition: "opacity 0.4s ease, margin 0.5s ease",
            }}
          />
          <p
            style={{
              color: "#c4b5fd",
              fontSize: 18,
              maxWidth: 520,
              margin: "0 auto",
              lineHeight: 1.7,
              opacity: loading ? 0 : 1,
              maxHeight: loading ? 0 : 120,
              overflow: "hidden",
              transition: "opacity 0.4s ease, max-height 0.5s ease",
            }}
          >
            {tagline[0]}<br />
            {tagline[1]}
          </p>
        </div>

        {/* Wave edge — beige curve at the bottom of the header that blends it
            into the page below, replacing the old hard gradient band. */}
        <svg
          viewBox="0 0 1440 90"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            bottom: -1,
            left: 0,
            width: "100%",
            height: 70,
            display: "block",
            zIndex: 3,
            pointerEvents: "none",
          }}
        >
          <path
            d="M0,48 C240,90 480,90 720,58 C960,26 1200,26 1440,52 L1440,90 L0,90 Z"
            fill="#f0ede8"
          />
        </svg>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "36px 20px", display: "flex", flexDirection: "column" }}>
        {/* Controls region (sticky + compact once recommendations exist) */}
        <div
          style={
            collapsed
              ? {
                  order: 3,
                  background: "rgba(240,237,232,0.9)",
                  borderTop: "1px solid #e2d9f3",
                  margin: "28px -20px 0",
                  padding: "14px 20px 40px",
                }
              : { order: 0 }
          }
        >
        {/* Search — hidden while loading so the loading view stands alone. */}
        <div
          className="search-wrap"
          style={{
            position: "relative",
            marginBottom: collapsed ? 0 : 10,
            width: "min(960px, 92vw)",
            marginLeft: "calc(50% - min(480px, 46vw))",
            display: loading ? "none" : undefined,
          }}
          ref={dropdownRef}
        >
          {!collapsed && (
            <label
              className="search-label"
              style={{
                display: "block",
                textAlign: "left",
                marginLeft: 4,
                marginBottom: 8,
                color: "#7c6faa",
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: 0.2,
              }}
            >
              📚 Add books you've already read
            </label>
          )}
          <input
            className={collapsed ? "search-input collapsed" : "search-input"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setDropdownOpen(true);
              if (dropdown.length === 0 && query.length === 0 && cachedBooks.length > 0) {
                setDropdown(cachedBooks.slice(0, 15));
              }
            }}
            onKeyDown={(e) => {
              if (dropdown.length === 0) return;

              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((prev) => (prev < dropdown.length - 1 ? prev + 1 : prev));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
              } else if (e.key === "Enter" && selectedIndex >= 0) {
                e.preventDefault();
                addBook(dropdown[selectedIndex]);
              }
            }}
            placeholder={
              myBooks.length > 0
                ? (isMobile ? "🔍 Add another title..." : "🔍 Add another book you've read...")
                : (isMobile ? "🔍 e.g. The Hobbit, Dune..." : "🔍 e.g. The Hobbit, Dune, Project Hail Mary...")
            }
            style={{
              width: "100%",
              padding: collapsed ? "14px 18px" : "28px 18px",
              fontSize: collapsed ? 18 : 35,
              boxSizing: "border-box",
              border: "3px solid #e2d9f3",
              borderRadius: 14,
              outline: "none",
              background: "white",
              boxShadow: "0 4px 16px rgba(99,60,180,0.08)",
              transition: "padding 0.3s ease, font-size 0.3s ease",
            }}
          />
          {searching && (
            <button
              onClick={stopSearch}
              onMouseEnter={tap(setHoveredStop, true)}
              onMouseLeave={tap(setHoveredStop, false)}
              style={{
                position: "absolute",
                right: 14,
                top: "50%",
                transform: hoveredStop ? "translateY(-50%) scale(1.05)" : "translateY(-50%) scale(1)",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                background: hoveredStop ? "#fef2f2" : "#f0ebff",
                color: hoveredStop ? "#dc2626" : "#7c3aed",
                border: "1px solid",
                borderColor: hoveredStop ? "#fca5a5" : "#e2d9f3",
                borderRadius: 99,
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
                animation: "stopFadeIn 0.18s ease-out",
              }}
            >
              <span
                style={{
                  width: 11,
                  height: 11,
                  border: "2px solid currentColor",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "spin 0.7s linear infinite",
                }}
              />
              Stop
            </button>
          )}
          {dropdownOpen && dropdown.length > 0 && (
            <div
              style={{
                position: "absolute",
                ...(collapsed
                  ? { bottom: "calc(100% + 6px)" }
                  : { top: "calc(100% + 6px)" }),
                background: "white",
                border: "1px solid #e2d9f3",
                borderRadius: 14,
                width: "100%",
                zIndex: 10,
                boxShadow: "0 8px 30px rgba(99,60,180,0.12)",
                overflowX: "hidden",
                overflowY: "auto",
                maxHeight: 360,
                overscrollBehavior: "contain",
                animation: collapsed ? "dropdownRevealUp 0.25s ease-out" : "dropdownReveal 0.25s ease-out",
              }}
            >
              {dropdown.map((book, idx) => (
                <div
                  key={book.key}
                  onClick={() => addBook(book)}
                  style={{
                    padding: "12px 16px",
                    cursor: "pointer",
                    borderBottom: "1px solid #f3f0fa",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    backgroundColor: idx === selectedIndex ? "#f0e8ff" : "white",
                    overflow: "hidden",
                  }}
                  onMouseEnter={(e) => {
                    if (isTouch) return;
                    e.currentTarget.style.background = "#faf8ff";
                    setHoveredDropdown(idx);
                  }}
                  onMouseLeave={(e) => {
                    if (isTouch) return;
                    e.currentTarget.style.background = idx === selectedIndex ? "#f0e8ff" : "white";
                    setHoveredDropdown(null);
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      transformOrigin: "left center",
                      transform: hoveredDropdown === idx ? "scale(1.1)" : "scale(1)",
                      transition: "transform 0.2s ease",
                    }}
                  >
                  {book.cover ? (
                    <img
                      src={book.cover}
                      alt={book.title}
                      style={{
                        width: 38,
                        height: 54,
                        objectFit: "cover",
                        borderRadius: 4,
                        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 38,
                        height: 54,
                        background: "#e8e0f7",
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 20,
                      }}
                    >
                      📖
                    </div>
                  )}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#1e1b4b" }}>
                      {book.title}
                    </div>
                    <div style={{ color: "#7c6faa", fontSize: 13 }}>{book.author}</div>
                  </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Empty state */}
        {myBooks.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0 40px" }}>
            <div
              className="cards-row"
              style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap", width: "min(960px, 92vw)", marginLeft: "calc(50% - min(480px, 46vw))" }}
            >
              {[
                {
                  icon: "🔍",
                  step: "1",
                  title: "Add your books",
                  desc: "Search and add books you've already read",
                },
                {
                  icon: "🧠",
                  step: "2",
                  title: "AI analyses your taste",
                  desc: "Our AI finds patterns in what you love",
                },
                {
                  icon: "📖",
                  step: "3",
                  title: "Get recommendations",
                  desc: "Discover 5 books perfectly matched to you — 100% free, forever",
                },
              ].map((s, i) => (
                <div
                  key={i}
                  className="slide-in"
                  style={{
                    flex: 1,
                    display: "flex",
                    animationDelay: `${i * 150}ms`,
                  }}
                >
                  <div
                    className="step-card"
                    style={{
                      background: "white",
                      borderRadius: 16,
                      padding: "36px 20px",
                      flex: 1,
                      boxShadow: "0 4px 16px rgba(99,60,180,0.08)",
                      border: "1px solid #e8e0f7",
                    }}
                  >
                    <div style={{ fontSize: 55, marginBottom: 10 }}>{s.icon}</div>
                    <div
                      style={{
                        background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
                        color: "white",
                        borderRadius: 99,
                        width: 26,
                        height: 26,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                        fontWeight: 700,
                        margin: "0 auto 10px",
                      }}
                    >
                      {s.step}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 18, color: "#1e1b4b", marginBottom: 6 }}>
                      {s.title}
                    </div>
                    <div style={{ color: "#7c6faa", fontSize: 18, lineHeight: 1.5 }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Mobile-only: a button under the how-it-works cards that scrolls
                back up to the search field, since on a phone the search bar is
                pushed out of view once you've scrolled down to read the cards. */}
            {isMobile && (
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                style={{
                  marginTop: 28,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "white",
                  color: "#7c3aed",
                  border: "1.5px solid #c4b5fd",
                  borderRadius: 99,
                  padding: "11px 22px",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 2px 10px rgba(124,58,237,0.12)",
                }}
              >
                <span style={{ fontSize: 15 }}>↑</span>
                Back to search
              </button>
            )}
          </div>
        )}

        {/* Books list — hidden entirely while loading so only the clean
            loading view (below) shows. */}
        {myBooks.length > 0 && !loading && (
          <div
            className="books-card"
            style={{
              background: "white",
              borderRadius: collapsed ? 12 : 18,
              padding: collapsed ? "10px 16px" : 22,
              marginTop: collapsed ? 10 : 0,
              marginBottom: collapsed ? 0 : 22,
              boxShadow: collapsed ? "none" : "0 4px 16px rgba(99,60,180,0.08)",
              border: "1px solid #e8e0f7",
              width: "min(960px, 92vw)",
              marginLeft: "calc(50% - min(480px, 46vw))",
              boxSizing: "border-box",
            }}
          >
            <div
              onClick={() => collapsed && setBooksExpanded((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                margin: collapsed ? 0 : "0 0 16px 0",
                cursor: collapsed ? "pointer" : "default",
              }}
            >
              <h3 style={{ margin: 0, color: "#1e1b4b", fontSize: collapsed ? 14 : 16, fontWeight: 700 }}>
                📋 Books I've read ({myBooks.length})
              </h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (loading) stopRecommend();
                    else clearAll();
                  }}
                  onMouseEnter={tap(setHoveredClearAll, true)}
                  onMouseLeave={tap(setHoveredClearAll, false)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: loading
                      ? (hoveredClearAll ? "#dc2626" : "#fef2f2")
                      : (hoveredClearAll ? "#fef2f2" : "transparent"),
                    color: loading
                      ? (hoveredClearAll ? "white" : "#dc2626")
                      : (hoveredClearAll ? "#dc2626" : "#a78bfa"),
                    border: "1px solid",
                    borderColor: loading ? "#fca5a5" : (hoveredClearAll ? "#fca5a5" : "#e2d9f3"),
                    borderRadius: 99,
                    padding: "5px 12px",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  {loading ? "⏹ Stop" : "🗑 Clear all"}
                </button>
                {collapsed && (
                  <span style={{ color: "#a78bfa", fontSize: 13, fontWeight: 600 }}>
                    {booksExpanded ? "Hide ▴" : "Show ▾"}
                  </span>
                )}
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateRows: (!collapsed || booksExpanded) ? "1fr" : "0fr",
                transition: "grid-template-rows 0.4s ease",
              }}
            >
              <div style={{ overflow: "hidden", minHeight: 0 }}>
                {myBooks.map((b) => (
              <div
                key={b.key}
                className="book-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 8px",
                  borderBottom: "1px solid #f3f0fa",
                }}
              >
                {b.cover ? (
                  <img
                    src={b.cover}
                    alt={b.title}
                    style={{
                      width: 32,
                      height: 46,
                      objectFit: "cover",
                      borderRadius: 4,
                      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 32,
                      height: 46,
                      background: "#e8e0f7",
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    📖
                  </div>
                )}
                <span style={{ flex: 1, fontSize: 14, color: "#1e1b4b" }}>
                  <strong>{b.title}</strong> <span style={{ color: "#7c6faa" }}>by {b.author}</span>
                </span>
                <button
                  onClick={() => removeBook(b.key)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#c4b5fd",
                    fontSize: 18,
                  }}
                >
                  ✕
                </button>
              </div>
                ))}
              </div>
            </div>

            <button
              onClick={getRecommendations}
              onMouseEnter={tap(setHoveredFindButton, true)}
              onMouseLeave={tap(setHoveredFindButton, false)}
              style={{
                marginTop: collapsed ? (booksExpanded ? 16 : 10) : 20,
                padding: collapsed ? "10px 18px" : "15px 24px",
                background: "linear-gradient(90deg, #1e1b4b 0%, #4c1d95 50%, #1e3a5f 100%)",
                color: "white",
                border: "none",
                borderRadius: collapsed ? 10 : 14,
                fontSize: collapsed ? 14 : 15,
                cursor: "pointer",
                width: "100%",
                fontWeight: 700,
                boxShadow: "0 4px 14px rgba(30,27,75,0.35)",
                transform: hoveredFindButton ? "scale(1.02)" : "scale(1)",
                transition: "transform 0.3s ease",
              }}
            >
              {myBooks.length > 1 ? "🔍 Find more books!" : "🔍 Find my next book!"}
            </button>
          </div>
        )}

        {/* Clean loading view — replaces the whole books card while we wait
            on recommendations. Just the floating book, the rotating status
            message, a filling progress bar, and a Stop button. */}
        {myBooks.length > 0 && loading && (
          <div
            className="loading-view"
            style={{
              width: "min(960px, 92vw)",
              marginLeft: "calc(50% - min(480px, 46vw))",
              marginTop: collapsed ? 10 : 0,
              marginBottom: collapsed ? 0 : 22,
              textAlign: "center",
              padding: "44px 20px",
              boxSizing: "border-box",
            }}
          >
            <div className="loading-book" style={{ fontSize: 104, marginBottom: 24 }}>📚</div>
            <div
              className="loading-message"
              style={{
                color: "#4c3f7a",
                fontSize: 36,
                fontWeight: 700,
                minHeight: 52,
                marginBottom: 30,
              }}
            >
              {LOADING_MESSAGES[loadingMsg]}
            </div>
            <div
              className="loading-bar"
              style={{
                maxWidth: 560,
                margin: "0 auto 28px",
                background: "#e4dbfa",
                borderRadius: 99,
                height: 14,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, #7c3aed, #4f46e5)",
                  borderRadius: 99,
                  transition: "width 0.2s linear",
                }}
              />
            </div>
            <button
              onClick={stopRecommend}
              onMouseEnter={tap(setHoveredStop, true)}
              onMouseLeave={tap(setHoveredStop, false)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                background: hoveredStop ? "#fef2f2" : "transparent",
                color: hoveredStop ? "#dc2626" : "#a78bfa",
                border: "1px solid",
                borderColor: hoveredStop ? "#fca5a5" : "#d8ccf2",
                borderRadius: 99,
                padding: "8px 18px",
                fontSize: 13.5,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              ⏹ Stop
            </button>
          </div>
        )}
        </div>
        {/* end controls region */}

        {error && (
          <p
            style={{
              order: 1,
              color: "#dc2626",
              textAlign: "center",
              background: "#fef2f2",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #fecaca",
            }}
          >
            {error}
          </p>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="recs-wrap" style={{ order: 2, width: "min(960px, 92vw)", marginLeft: "calc(50% - min(480px, 46vw))" }}>
            <h3 style={{ color: "#1e1b4b", marginBottom: 16, fontSize: 20, fontWeight: 800 }}>
              ✨ Your next reads
            </h3>
            {recommendations.map((r, i) => {
              const hasMoreInfo = r.genre || r.pages || r.published;
              // Shared pill set, used by both the desktop panel (bottom of card)
              // and the mobile panel (above the buttons).
              const infoPills = (
                <>
                  {r.genre && <InfoPill icon="📚" label={r.genre} />}
                  {r.pages && <InfoPill icon="📄" label={`${r.pages} pages`} />}
                  {r.published && <InfoPill icon="📅" label={r.published} />}
                </>
              );
              return (
              <div
                key={r.title + r.author}
                className={"rec-card " + (dismissing?.idx === i ? (dismissing.dir === "left" ? "rec-dismissing-left" : "rec-dismissing") : "")}
                onMouseEnter={tap(setHoveredBook, i)}
                onMouseLeave={tap(setHoveredBook, null)}
                onClick={() => hasMoreInfo && setExpandedRec(expandedRec === i ? null : i)}
                style={{
                  background: "white",
                  borderRadius: 18,
                  padding: 22,
                  marginBottom: 16,
                  boxSizing: "border-box",
                  cursor: hasMoreInfo ? "pointer" : "default",
                  boxShadow:
                    hoveredBook === i
                      ? "0 14px 32px rgba(124,58,237,0.16)"
                      : "0 4px 16px rgba(99,60,180,0.08)",
                  border: "1px solid #e8e0f7",
                  borderLeft: "5px solid #7c3aed",
                  transform: hoveredBook === i ? "translateY(-5px)" : "translateY(0)",
                  transition: "transform 0.3s ease, box-shadow 0.3s ease",
                }}
              >
                <div className="rec-main" style={{ display: "flex", gap: 16, marginBottom: 14 }}>
                  {r.cover ? (
                    <img
                      className="rec-cover"
                      src={r.cover}
                      alt={r.title}
                      onMouseEnter={tap(setHoveredCover, i)}
                      onMouseLeave={tap(setHoveredCover, null)}
                      style={{
                        width: 86,
                        height: 125,
                        objectFit: "cover",
                        borderRadius: 8,
                        boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
                        flexShrink: 0,
                        transform: hoveredCover === i ? "scale(1.1)" : "scale(1)",
                        transition: "transform 0.3s ease",
                      }}
                    />
                  ) : (
                    <div
                      className="rec-cover-placeholder"
                      style={{
                        width: 86,
                        height: 125,
                        background: "#e8e0f7",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 36,
                        flexShrink: 0,
                      }}
                    >
                      📖
                    </div>
                  )}
                  <div className="rec-confidence-wrap" style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 19, color: "#1e1b4b", marginBottom: 4 }}>
                      {r.title}
                    </div>
                    <div style={{ color: "#7c6faa", fontSize: 15, marginBottom: 10 }}>
                      by {r.author}
                    </div>
                    {renderConfidence(r.confidence)}
                    <div className="rec-details" style={{ color: "#555", fontSize: 16, lineHeight: 1.6 }}>{r.details}</div>
                  </div>
                </div>
                <div className="rec-actions" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <a
                    className="buy-btn"
                    href={amazonLink(r.title, r.author)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={tap(setHoveredButton, i)}
                    onMouseLeave={tap(setHoveredButton, null)}
                    style={{
                      display: "inline-block",
                      padding: "9px 20px",
                      background: "#f90",
                      borderRadius: 10,
                      textDecoration: "none",
                      color: "#111",
                      fontSize: 13,
                      fontWeight: 700,
                      boxShadow: "0 2px 8px rgba(255,153,0,0.3)",
                      transform: hoveredButton === i ? "scale(1.08)" : "scale(1)",
                      transition: "transform 0.3s ease",
                      cursor: "pointer",
                    }}
                  >
                    🛒 Buy on Amazon
                  </a>
                  {hasMoreInfo && (
                    <button
                      className="info-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedRec(expandedRec === i ? null : i);
                      }}
                      onMouseEnter={tap(setHoveredInfo, i)}
                      onMouseLeave={tap(setHoveredInfo, null)}
                      style={{
                        padding: "9px 18px",
                        background: expandedRec === i ? "#7c3aed" : "white",
                        color: expandedRec === i ? "white" : "#7c3aed",
                        border: "1.5px solid #7c3aed",
                        borderRadius: 10,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        transform: hoveredInfo === i ? "scale(1.08)" : "scale(1)",
                        transition: "transform 0.3s ease, background 0.2s ease, color 0.2s ease",
                      }}
                    >
                      {expandedRec === i ? "Less info ▴" : "ℹ️ More info ▾"}
                    </button>
                  )}
                  <button
                    className="already-read-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      markAsRead(i);
                    }}
                    onMouseEnter={tap(setHoveredAlreadyRead, i)}
                    onMouseLeave={tap(setHoveredAlreadyRead, null)}
                    style={{
                      padding: "9px 18px",
                      background: hoveredAlreadyRead === i ? "#f0fdf4" : "white",
                      color: hoveredAlreadyRead === i ? "#16a34a" : "#9ca3af",
                      border: "1.5px solid",
                      borderColor: hoveredAlreadyRead === i ? "#86efac" : "#e5e7eb",
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      transform: hoveredAlreadyRead === i ? "scale(1.08)" : "scale(1)",
                      transition: "all 0.25s ease",
                      marginLeft: "auto",
                    }}
                  >
                    ✓ Already read
                  </button>
                  <button
                    className="not-interested-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissRec(i);
                    }}
                    onMouseEnter={tap(setHoveredNotInterested, i)}
                    onMouseLeave={tap(setHoveredNotInterested, null)}
                    style={{
                      padding: "9px 18px",
                      background: hoveredNotInterested === i ? "#fef2f2" : "white",
                      color: hoveredNotInterested === i ? "#dc2626" : "#9ca3af",
                      border: "1.5px solid",
                      borderColor: hoveredNotInterested === i ? "#fca5a5" : "#e5e7eb",
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      transform: hoveredNotInterested === i ? "scale(1.08)" : "scale(1)",
                      transition: "all 0.25s ease",
                    }}
                  >
                    ✕ Not interested
                  </button>

                  {/* Mobile-only info panel — slides in ABOVE the buttons
                      (order: -2 puts it at the very top of the stacked column).
                      Hidden on desktop via CSS; the desktop panel below the
                      button row is used there instead. */}
                  {hasMoreInfo && (
                    <div
                      className="info-panel-mobile"
                      style={{
                        gridTemplateRows: expandedRec === i ? "1fr" : "0fr",
                        opacity: expandedRec === i ? 1 : 0,
                        transition: "grid-template-rows 0.45s ease, opacity 0.35s ease",
                      }}
                    >
                      <div style={{ overflow: "hidden", minHeight: 0 }}>
                        <div
                          style={{
                            paddingBottom: 14,
                            marginBottom: 2,
                            borderBottom: "1px dashed #e2d9f3",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 8,
                            justifyContent: "center",
                          }}
                        >
                          {infoPills}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className="info-panel-desktop"
                  style={{
                    display: "grid",
                    gridTemplateRows: expandedRec === i ? "1fr" : "0fr",
                    opacity: expandedRec === i ? 1 : 0,
                    transition: "grid-template-rows 0.45s ease, opacity 0.35s ease",
                  }}
                >
                  <div style={{ overflow: "hidden", minHeight: 0 }}>
                    <div
                      style={{
                        marginTop: 16,
                        paddingTop: 16,
                        borderTop: "1px dashed #e2d9f3",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      {infoPills}
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}

        {/* Thank-you + share — placed at the VERY BOTTOM (order: 4), below the
            sticky controls region / "Find more books" button (order: 3). Only
            rendered once recommendations exist. */}
        {recommendations.length > 0 && (
          <div
            className="share-card-wrap"
            style={{
              order: 4,
              width: "min(960px, 92vw)",
              marginLeft: "calc(50% - min(480px, 46vw))",
              marginTop: 28,
            }}
          >
            <div
              className="share-card"
              style={{
                background: "linear-gradient(135deg, #1e1b4b 0%, #1e3a5f 100%)",
                border: "1px solid rgba(167,139,250,0.25)",
                borderRadius: 18,
                padding: "32px 22px",
                textAlign: "center",
                position: "relative",
                overflow: "hidden",
                boxShadow: "0 8px 30px rgba(30,27,75,0.18)",
              }}
            >
              {/* Soft purple glow to match the header's depth */}
              <div
                style={{
                  position: "absolute",
                  top: "-40%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 360,
                  height: 360,
                  background: "radial-gradient(circle, rgba(124,58,237,0.35), transparent 70%)",
                  pointerEvents: "none",
                }}
              />
              <div style={{ position: "relative", zIndex: 1 }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>📚💜</div>
              <div style={{ fontWeight: 800, fontSize: 19, color: "#ffffff", marginBottom: 6 }}>
                Thanks for trying My Next Book!
              </div>
              <div
                style={{
                  color: "#c4b5fd",
                  fontSize: 14.5,
                  lineHeight: 1.6,
                  maxWidth: 420,
                  margin: "0 auto 18px",
                }}
              >
                If you found a read worth picking up, share it with a friend who
                always needs their next book.
              </div>
              <div
                className="share-actions"
                style={{
                  display: "flex",
                  justifyContent: "center",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                {[
                  { id: "x", label: "X", icon: "𝕏", href: shareLinks.x, bg: "#000", color: "#fff" },
                  { id: "facebook", label: "Facebook", icon: "f", href: shareLinks.facebook, bg: "#1877f2", color: "#fff" },
                  { id: "whatsapp", label: "WhatsApp", icon: "🟢", href: shareLinks.whatsapp, bg: "#25d366", color: "#fff" },
                ].map((s) => (
                  <a
                    key={s.id}
                    href={s.href}
                    target="_blank"
                    rel="noreferrer"
                    onMouseEnter={tap(setHoveredShare, s.id)}
                    onMouseLeave={tap(setHoveredShare, null)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 18px",
                      background: s.bg,
                      color: s.color,
                      borderRadius: 99,
                      textDecoration: "none",
                      fontSize: 14,
                      fontWeight: 700,
                      boxShadow: "0 2px 8px rgba(30,27,75,0.15)",
                      transform: hoveredShare === s.id ? "scale(1.06)" : "scale(1)",
                      transition: "transform 0.25s ease",
                    }}
                  >
                    <span style={{ fontWeight: 900 }}>{s.icon}</span>
                    {s.label}
                  </a>
                ))}
                <button
                  onClick={copyShareLink}
                  onMouseEnter={tap(setHoveredShare, "copy")}
                  onMouseLeave={tap(setHoveredShare, null)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 18px",
                    background: shareCopied ? "#16a34a" : "rgba(167,139,250,0.15)",
                    color: shareCopied ? "white" : "#c4b5fd",
                    border: "1.5px solid",
                    borderColor: shareCopied ? "#16a34a" : "rgba(167,139,250,0.5)",
                    borderRadius: 99,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    backdropFilter: "blur(4px)",
                    transform: hoveredShare === "copy" && !shareCopied ? "scale(1.06)" : "scale(1)",
                    transition: "transform 0.25s ease, background 0.2s ease, color 0.2s ease",
                  }}
                >
                  <span>{shareCopied ? "✓" : "🔗"}</span>
                  {shareCopied ? "Copied!" : "Copy link"}
                </button>
              </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
