import { useState, useEffect, useRef } from "react";

const GOOGLE_BOOKS_API_KEY = import.meta.env.VITE_GOOGLE_BOOKS_API_KEY;
const AMAZON_TAG = import.meta.env.VITE_AMAZON_TAG;

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
  const [query, setQuery] = useState("");
  const [dropdown, setDropdown] = useState([]);
  const [hoveredBook, setHoveredBook] = useState(null);
  const [hoveredCover, setHoveredCover] = useState(null);
  const [hoveredDropdown, setHoveredDropdown] = useState(null);
  const [booksExpanded, setBooksExpanded] = useState(false);
  const [expandedRec, setExpandedRec] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [cachedBooks, setCachedBooks] = useState([]);
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
  const dropdownRef = useRef(null);
  const loadingRef = useRef(null);
  const progressRef = useRef(null);

  useEffect(() => {
    const loadCachedBooks = async () => {
      try {
        const res = await fetch(
          `https://www.googleapis.com/books/v1/volumes?q=bestseller&orderBy=relevance&maxResults=50&key=${GOOGLE_BOOKS_API_KEY}`
        );
        const data = await res.json();
        const books = (data.items || []).map((b) => ({
          title: b.volumeInfo.title,
          author: b.volumeInfo.authors?.[0] || "Unknown",
          cover: b.volumeInfo.imageLinks?.smallThumbnail || null,
          key: b.id,
        }));
        setCachedBooks(books);
      } catch (err) {
        console.error("Failed to load cached books:", err);
      }
    };
    loadCachedBooks();
  }, []);

  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdown([]);
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
      let prog = 0;
      loadingRef.current = setInterval(() => {
        msg = (msg + 1) % LOADING_MESSAGES.length;
        setLoadingMsg(msg);
      }, 1800);
      progressRef.current = setInterval(() => {
        prog = Math.min(prog + Math.random() * 8, 90);
        setProgress(prog);
      }, 300);
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

    const filtered = cachedBooks.filter(
      (b) =>
        b.title.toLowerCase().includes(query.toLowerCase()) ||
        b.author.toLowerCase().includes(query.toLowerCase())
    );

    if (filtered.length > 0) {
      setDropdown(filtered.slice(0, 5));
      setSelectedIndex(-1);
      setSearching(false);
      clearTimeout(debounceRef.current);
      return;
    }

    setSearching(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
            query
          )}&maxResults=5&key=${GOOGLE_BOOKS_API_KEY}`
        );
        const data = await res.json();
        setDropdown(
          (data.items || []).map((b) => ({
            title: b.volumeInfo.title,
            author: b.volumeInfo.authors?.[0] || "Unknown",
            cover: b.volumeInfo.imageLinks?.smallThumbnail || null,
            key: b.id,
          }))
        );
        setSelectedIndex(-1);
      } catch (err) {
        console.error(err);
      } finally {
        setSearching(false);
      }
    }, 200);
  }, [query, cachedBooks]);

  const addBook = (book) => {
    if (!myBooks.find((b) => b.key === book.key)) setMyBooks([...myBooks, book]);
    setQuery("");
    setDropdown([]);
    setSelectedIndex(-1);
  };

  const removeBook = (key) => setMyBooks(myBooks.filter((b) => b.key !== key));

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
    }, 350);
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
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ myBooks, notInterested }),
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

      // Pull factual fields (cover, genre, pages, year, rating) from Google Books
      // — these are real data, unlike anything the model would guess.
      const recsWithCovers = await Promise.all(
        recs.map(async (r) => {
          try {
            const coverRes = await fetch(
              `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
                r.title + " " + r.author
              )}&maxResults=1&key=${GOOGLE_BOOKS_API_KEY}`
            );
            const coverData = await coverRes.json();
            const info = coverData.items?.[0]?.volumeInfo || {};
            return {
              ...r,
              cover: info.imageLinks?.thumbnail || null,
              genre: info.categories?.[0] || null,
              pages: info.pageCount || null,
              published: info.publishedDate ? String(info.publishedDate).slice(0, 4) : null,
              rating: info.averageRating || null,
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
      setError("Failed to get recommendations. Try again.");
    } finally {
      setLoading(false);
    }
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
          50% { opacity: 0; transform: translateX(60px); max-height: 300px; margin-bottom: 16px; }
          100% { opacity: 0; transform: translateX(60px); max-height: 0; margin-bottom: 0; padding: 0; }
        }
        @keyframes dismissSlideLeft {
          0% { opacity: 1; transform: translateX(0); max-height: 300px; margin-bottom: 16px; }
          50% { opacity: 0; transform: translateX(-60px); max-height: 300px; margin-bottom: 16px; }
          100% { opacity: 0; transform: translateX(-60px); max-height: 0; margin-bottom: 0; padding: 0; }
        }
        .rec-dismissing {
          animation: dismissSlide 0.35s ease-out forwards;
          overflow: hidden;
        }
        .rec-dismissing-left {
          animation: dismissSlideLeft 0.35s ease-out forwards;
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
            transition: "width 0.3s ease",
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
          style={{ position: "relative", marginBottom: collapsed ? 0 : 10, width: "min(960px, 92vw)", marginLeft: "calc(50% - min(480px, 46vw))" }}
          ref={dropdownRef}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              if (query.length === 0 && cachedBooks.length > 0) {
                setDropdown(cachedBooks.slice(0, 5));
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
                ? "🔍 Add more books you've read..."
                : "🔍 Search for a book you've read..."
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
            <div
              style={{
                position: "absolute",
                right: 16,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#a78bfa",
                fontSize: 13,
              }}
            >
              searching...
            </div>
          )}
          {dropdown.length > 0 && (
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
                overflow: "hidden",
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
              {collapsed && (
                <span style={{ color: "#a78bfa", fontSize: 13, fontWeight: 600 }}>
                  {booksExpanded ? "Hide ▴" : "Show ▾"}
                </span>
              )}
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
                      transition: "width 0.3s ease",
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
          <div style={{ order: 2, width: "min(960px, 92vw)", marginLeft: "calc(50% - min(480px, 46vw))" }}>
            <h3 style={{ color: "#1e1b4b", marginBottom: 16, fontSize: 20, fontWeight: 800 }}>
              ✨ Your next reads
            </h3>
            {recommendations.map((r, i) => {
              const hasMoreInfo = r.genre || r.pages || r.published || r.rating;
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
                <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
                  {r.cover ? (
                    <img
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
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 19, color: "#1e1b4b", marginBottom: 4 }}>
                      {r.title}
                    </div>
                    <div style={{ color: "#7c6faa", fontSize: 15, marginBottom: 10 }}>
                      by {r.author}
                    </div>
                    {renderConfidence(r.confidence)}
                    <div style={{ color: "#555", fontSize: 16, lineHeight: 1.6 }}>{r.details}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <a
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
                      {r.rating && <InfoPill icon="⭐" label={`${r.rating} / 5`} />}
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
