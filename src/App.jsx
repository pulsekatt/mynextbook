import { useState, useEffect, useRef } from "react";
import POPULAR_BOOKS from "./popularBooks";

const GOOGLE_BOOKS_API_KEY = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY;
const AMAZON_TAG = import.meta.env.VITE_AMAZON_TAG;

// Bestseller cache: persisted in localStorage with a 24h TTL so repeat visits
// hit instant-search from second 0 without re-fetching anything.
const CACHED_BOOKS_KEY = "popularBookCovers_v2";
const CACHED_BOOKS_TTL_MS = 24 * 60 * 60 * 1000;

const LOADING_MESSAGES = [
  "📖 Analysing your reading taste...",
  "🔍 Searching the literary universe...",
  "🧠 Thinking like a librarian...",
  "✨ Discovering hidden gems...",
  "📚 Almost there, hang tight...",
];

export default function App() {
  const [hoveredFindButton, setHoveredFindButton] = useState(false);
  const [hoveredButton, setHoveredButton] = useState(null);
  const [hoveredInfo, setHoveredInfo] = useState(null);
  const [hoveredNotInterested, setHoveredNotInterested] = useState(null);
  const [hoveredAlreadyRead, setHoveredAlreadyRead] = useState(null);
  const [hoveredHome, setHoveredHome] = useState(false);
  const [hoveredClearAll, setHoveredClearAll] = useState(false);
  const [hoveredStop, setHoveredStop] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= 600 : false
  );
  const [query, setQuery] = useState("");
  const [dropdown, setDropdown] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hoveredBook, setHoveredBook] = useState(null);
  const [hoveredCover, setHoveredCover] = useState(null);
  const [hoveredDropdown, setHoveredDropdown] = useState(null);
  const [booksExpanded, setBooksExpanded] = useState(false);
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

  useEffect(() => {
    // POPULAR_BOOKS now ships with cover URLs baked in (see buildPopularBooks.mjs),
    // so titles AND covers are available instantly on load with no network calls.
    // The only thing this effect does is lazily backfill covers for the FEW books
    // (if any) that had no cover at build time — most runs do nothing.
    const missing = POPULAR_BOOKS.filter((b) => !b.cover);
    if (missing.length === 0) return; // nothing to do — the common case

    const backfill = async () => {
      // Reuse a localStorage map so we don't re-fetch the same gaps every visit.
      let stored = {};
      try {
        const raw = localStorage.getItem(CACHED_BOOKS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.covers && Date.now() - (parsed.timestamp || 0) < CACHED_BOOKS_TTL_MS) {
            stored = parsed.covers;
          }
        }
      } catch {
        // ignore
      }

      // Apply anything we already have cached.
      if (Object.keys(stored).length > 0) {
        setCachedBooks((prev) =>
          prev.map((b) => (!b.cover && stored[b.key] ? { ...b, cover: stored[b.key] } : b))
        );
      }

      const stillMissing = missing.filter((b) => !stored[b.key]);
      for (const b of stillMissing) {
        try {
          const res = await fetch(
            `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
              b.title + " " + b.author
            )}&maxResults=1&key=${GOOGLE_BOOKS_API_KEY}`
          );
          if (!res.ok) continue;
          const data = await res.json();
          const img = data.items?.[0]?.volumeInfo?.imageLinks;
          const cover = (img?.smallThumbnail || img?.thumbnail || null)?.replace(/^http:\/\//, "https://");
          if (cover) {
            stored[b.key] = cover;
            setCachedBooks((prev) =>
              prev.map((bk) => (bk.key === b.key ? { ...bk, cover } : bk))
            );
          }
        } catch {
          // skip; placeholder emoji shows
        }
      }

      try {
        localStorage.setItem(
          CACHED_BOOKS_KEY,
          JSON.stringify({ covers: stored, timestamp: Date.now() })
        );
      } catch {
        // ignore
      }
    };
    backfill();
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 600);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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

    // 1. Compute cached matches now (used in the merge for their covers),
    // but DON'T render them yet — rendering here then re-rendering after the
    // API responds causes a visible "jump". We set the dropdown only once.
    const cached = cachedBooks.filter(
      (b) =>
        b.title.toLowerCase().includes(query.toLowerCase()) ||
        b.author.toLowerCase().includes(query.toLowerCase())
    );

    // 2. Fetch live results, then set the dropdown a single time with the merge.
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      // Only flip the spinner on once the real fetch begins (after debounce),
      // so it doesn't flash on/off with every keystroke while typing fast.
      setSearching(true);
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
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
        const liveResults = (data.items || [])
          .filter((b) => b && b.volumeInfo && b.volumeInfo.title)
          .map((b) => ({
            title: b.volumeInfo.title,
            author: b.volumeInfo.authors?.[0] || "Unknown",
            cover: b.volumeInfo.imageLinks?.smallThumbnail || b.volumeInfo.imageLinks?.thumbnail || null,
            key: b.id,
          }));

        // Merge: prioritize live results with covers, then cached, then live without covers.
        // Dedupe on BOTH the source key AND a normalized title+author signature,
        // so the same book appearing as multiple Google Books editions (or in both
        // the cache and live results) only shows up once.
        const norm = (s) => (s || "").trim().toLowerCase();
        const sig = (b) => norm(b.title) + "|||" + norm(b.author);
        const seenKeys = new Set();
        const seenSigs = new Set();
        const merged = [];
        const tryAdd = (b) => {
          if (seenKeys.has(b.key) || seenSigs.has(sig(b))) return;
          merged.push(b);
          seenKeys.add(b.key);
          seenSigs.add(sig(b));
        };

        // First: live results WITH covers
        for (const b of liveResults) {
          if (b.cover) tryAdd(b);
        }

        // Second: cached results (already have enriched covers if available)
        for (const b of cached) {
          tryAdd(b);
        }

        // Third: live results WITHOUT covers (fallback)
        for (const b of liveResults) {
          if (!b.cover) tryAdd(b);
        }

        // If the API returned nothing usable, fall back to cached matches.
        const finalList = merged.length > 0 ? merged : cached;
        setDropdown(finalList.slice(0, 15));
        setDropdownOpen(true);
        setSelectedIndex(-1);
      } catch (err) {
        // AbortError is expected when user hits Stop — ignore it.
        // On a real failure, show cached matches so the dropdown isn't empty.
        if (err.name !== "AbortError") {
          console.error(err);
          if (cached.length > 0) {
            setDropdown(cached.slice(0, 15));
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
    const norm = (s) => (s || "").trim().toLowerCase();
    const isDup = myBooks.some(
      (b) =>
        b.key === book.key ||
        (norm(b.title) === norm(book.title) && norm(b.author) === norm(book.author))
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
    setBooksExpanded(false);
  };

  // Reset back to the "home" state: clears recommendations and scrolls up,
  // but keeps the user's books so they can tweak and search again.
  const goHome = () => {
    setRecommendations([]);
    setExpandedRec(null);
    setError("");
    setBooksExpanded(false);
    setDismissing(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const dismissRec = (idx, direction = "right") => {
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
    }, 650);
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
      const recsWithCovers = await Promise.all(
        recs.map(async (r) => {
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

            return {
              ...r,
              cover,
              genre: info.categories?.[0] || null,
              pages: info.pageCount || null,
              published: info.publishedDate ? String(info.publishedDate).slice(0, 4) : null,
            };
          } catch {
            return { ...r, cover: null };
          }
        })
      );

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
          55% { opacity: 0; transform: translateX(80px); max-height: 300px; margin-bottom: 16px; }
          100% { opacity: 0; transform: translateX(80px); max-height: 0; margin-bottom: 0; padding: 0; }
        }
        @keyframes dismissSlideLeft {
          0% { opacity: 1; transform: translateX(0); max-height: 300px; margin-bottom: 16px; }
          55% { opacity: 0; transform: translateX(-80px); max-height: 300px; margin-bottom: 16px; }
          100% { opacity: 0; transform: translateX(-80px); max-height: 0; margin-bottom: 0; padding: 0; }
        }
        .rec-dismissing {
          animation: dismissSlide 0.65s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
          overflow: hidden;
        }
        .rec-dismissing-left {
          animation: dismissSlideLeft 0.65s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
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

        /* ---- Mobile tweaks (phones) ---- */
        @media (max-width: 600px) {
          /* 2 (this round). Home button: ease it off the very top-right corner. */
          .home-button {
            top: 14px !important;
            right: 12px !important;
            padding: 6px 12px !important;
            font-size: 12px !important;
          }

          /* 3 (this round). Action buttons: Buy + More-info on row 1,
             Already-read + Not-interested share row 2 side-by-side. */
          .rec-actions {
            gap: 8px !important;
          }
          .buy-btn,
          .info-btn {
            flex: 1 1 auto !important;
            text-align: center !important;
          }
          .already-read-btn,
          .not-interested-btn {
            flex: 1 1 0 !important;
            margin-left: 0 !important;
            justify-content: center !important;
            text-align: center !important;
          }
          .already-read-btn {
            display: inline-flex !important;
            align-items: center !important;
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
            font-size: 11px !important;
            margin-bottom: 5px !important;
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
            width: 120px !important;
            height: 174px !important;
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
          background: "linear-gradient(180deg, #1e1b4b 0%, #1e3a5f 90%, #f0ede8 100%)",
          padding: "44px 20px 64px",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Home button — only shown once recommendations exist. */}
        {collapsed && (
          <button
            className="home-button"
            onClick={goHome}
            onMouseEnter={() => setHoveredHome(true)}
            onMouseLeave={() => setHoveredHome(false)}
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
            <span>Home</span>
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

        <div style={{ position: "relative", zIndex: 1 }}>
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
              margin: "18px auto 20px",
            }}
          />
          <p
            style={{
              color: "#c4b5fd",
              fontSize: 18,
              maxWidth: 520,
              margin: "0 auto",
              lineHeight: 1.7,
            }}
          >
            Tell us what you've loved reading —<br />
            we'll find your next obsession.
          </p>
        </div>
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
        {/* Search */}
        <div
          className="search-wrap"
          style={{ position: "relative", marginBottom: collapsed ? 0 : 10, width: "min(960px, 92vw)", marginLeft: "calc(50% - min(480px, 46vw))" }}
          ref={dropdownRef}
        >
          {!collapsed && (
            <label
              className="search-label"
              style={{
                display: "block",
                textAlign: "left",
                marginLeft: 4,
                marginBottom: 7,
                color: "#7c6faa",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0.2,
              }}
            >
              📚 Books you've read
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
                ? (isMobile ? "🔍 Add more books..." : "🔍 Add more books you've read...")
                : (isMobile ? "🔍 Search a book..." : "🔍 Search for a book you've read...")
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
              onMouseEnter={() => setHoveredStop(true)}
              onMouseLeave={() => setHoveredStop(false)}
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
                    e.currentTarget.style.background = "#faf8ff";
                    setHoveredDropdown(idx);
                  }}
                  onMouseLeave={(e) => {
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
                  desc: "Discover 5 books perfectly matched to you",
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
          </div>
        )}

        {/* Books list */}
        {myBooks.length > 0 && (
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
                  onMouseEnter={() => setHoveredClearAll(true)}
                  onMouseLeave={() => setHoveredClearAll(false)}
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
            {(!collapsed || booksExpanded) &&
              myBooks.map((b) => (
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

            {loading ? (
              <div style={{ marginTop: 24, textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📚</div>
                <div style={{ color: "#6b5fa0", fontSize: 15, fontWeight: 500, minHeight: 24 }}>
                  {LOADING_MESSAGES[loadingMsg]}
                </div>
                <div
                  style={{
                    marginTop: 16,
                    background: "#f0ebff",
                    borderRadius: 99,
                    height: 6,
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
              </div>
            ) : (
              <button
                onClick={getRecommendations}
                onMouseEnter={() => setHoveredFindButton(true)}
                onMouseLeave={() => setHoveredFindButton(false)}
                style={{
                  marginTop: collapsed ? (booksExpanded ? 16 : 10) : 20,
                  padding: collapsed ? "10px 18px" : "15px 24px",
                  background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
                  color: "white",
                  border: "none",
                  borderRadius: collapsed ? 10 : 14,
                  fontSize: collapsed ? 14 : 15,
                  cursor: "pointer",
                  width: "100%",
                  fontWeight: 700,
                  boxShadow: "0 4px 14px rgba(124,58,237,0.35)",
                  transform: hoveredFindButton ? "scale(1.02)" : "scale(1)",
                  transition: "transform 0.3s ease",
                }}
              >
                {myBooks.length > 1 ? "🔍 Find more books!" : "🔍 Find my next book!"}
              </button>
            )}
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
              return (
              <div
                key={r.title + r.author}
                className={dismissing?.idx === i ? (dismissing.dir === "left" ? "rec-dismissing-left" : "rec-dismissing") : ""}
                onMouseEnter={() => setHoveredBook(i)}
                onMouseLeave={() => setHoveredBook(null)}
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
                      onMouseEnter={() => setHoveredCover(i)}
                      onMouseLeave={() => setHoveredCover(null)}
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
                    onMouseEnter={() => setHoveredButton(i)}
                    onMouseLeave={() => setHoveredButton(null)}
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
                      onMouseEnter={() => setHoveredInfo(i)}
                      onMouseLeave={() => setHoveredInfo(null)}
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
                    onMouseEnter={() => setHoveredAlreadyRead(i)}
                    onMouseLeave={() => setHoveredAlreadyRead(null)}
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
                    onMouseEnter={() => setHoveredNotInterested(i)}
                    onMouseLeave={() => setHoveredNotInterested(null)}
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
                </div>

                <div
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
                      {r.genre && <InfoPill icon="📚" label={r.genre} />}
                      {r.pages && <InfoPill icon="📄" label={`${r.pages} pages`} />}
                      {r.published && <InfoPill icon="📅" label={r.published} />}
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
