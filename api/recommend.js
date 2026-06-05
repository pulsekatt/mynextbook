// api/recommend.js
// Streaming version. Server calls Gemini's streaming endpoint, pulls each
// COMPLETE book object out of the partial JSON as it arrives, and forwards it
// to the browser as a Server-Sent Event so the UI can render books one-by-one.
//
// Reliability: retry + fallback model applies to OPENING the stream. Once the
// stream is flowing we commit to it (you can't cleanly retry mid-stream).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODELS = ["gemini-3.5-flash", "gemini-2.5-flash"];

// Open a streaming connection to one model. Retries on transient errors.
async function openStream(model, body, apiKey, maxAttempts = 2) {
  let lastDetail = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      }
    );
    if (resp.ok && resp.body) return resp;

    lastDetail = await resp.text().catch(() => "");
    const transient = [429, 500, 503].includes(resp.status);
    if (!transient || attempt === maxAttempts) {
      const err = new Error(`${model} -> ${resp.status}`);
      err.status = resp.status;
      err.detail = lastDetail;
      throw err;
    }
    await sleep(500 * attempt);
  }
}

// Try each model in order; fall back only on transient errors.
async function openStreamWithFallback(body, apiKey) {
  let lastErr;
  for (const model of MODELS) {
    try {
      return await openStream(model, body, apiKey);
    } catch (err) {
      lastErr = err;
      if (![429, 500, 503].includes(err.status)) throw err;
      console.warn(`${model} unavailable (${err.status}); trying next model`);
    }
  }
  throw lastErr;
}

// Pulls complete top-level {...} objects out of a growing buffer, once each.
function makeExtractor() {
  let consumed = 0;
  return function extract(buffer) {
    const out = [];
    let i = consumed;
    while (i < buffer.length) {
      while (i < buffer.length && buffer[i] !== "{") i++;
      if (i >= buffer.length) break;
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let j = i; j < buffer.length; j++) {
        const c = buffer[j];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
        } else {
          if (c === '"') inStr = true;
          else if (c === "{") depth++;
          else if (c === "}") { depth--; if (depth === 0) { end = j; break; } }
        }
      }
      if (end === -1) break;
      try { out.push(JSON.parse(buffer.slice(i, end + 1))); } catch { break; }
      consumed = end + 1;
      i = end + 1;
    }
    return out;
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Missing GEMINI_API_KEY env var");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const { myBooks = [], notInterested = [] } = req.body || {};
  if (!Array.isArray(myBooks) || myBooks.length === 0) {
    return res.status(400).json({ error: "No books provided" });
  }

  const bookList = myBooks.map((b) => `"${b.title}" by ${b.author}`).join(", ");
  const excludeList = notInterested.map((b) => `"${b.title}" by ${b.author}`).join(", ");
  const excludeClause = excludeList
    ? ` Do NOT recommend any of these books (I'm not interested in them): ${excludeList}.`
    : "";

  // Note: ask for most-confident-first so arrival order = display order (no client sort needed while streaming).
  const prompt = `Based on these books I've read: ${bookList}.${excludeClause} Recommend 5 new books I'd enjoy, ordered from most to least confident match. Respond ONLY in JSON array format like this, no other text: [{"title":"Book Title","author":"Author Name","reason":"One sentence why I'd like it","confidence":92,"genre":"Primary genre","themes":["theme1","theme2","theme3"],"details":"A 2-3 sentence deeper explanation of why this book matches the reader's taste, referencing what they've read and what they'll get from it."}]. The confidence field should be a number from 70-99. The themes array should contain 2-4 short theme/topic tags.`;

  let geminiRes;
  try {
    geminiRes = await openStreamWithFallback(
      { contents: [{ parts: [{ text: prompt }] }] },
      apiKey
    );
  } catch (err) {
    console.error("Gemini API error:", err.status, err.detail);
    const busy = err.status === 503 || err.status === 429;
    return res
      .status(busy ? 503 : 502)
      .json({ error: busy ? "The recommendation models are busy right now. Please try again in a moment." : "Recommendation service failed" });
  }

  // Switch the response into Server-Sent Events mode and stream books out.
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    const extract = makeExtractor();
    let sseBuf = "";   // raw SSE lines from Gemini
    let textBuf = "";  // accumulated model text (the JSON array)
    let count = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuf += decoder.decode(value, { stream: true });

      // Gemini SSE: events are "data: {...}" separated by blank lines.
      let nl;
      while ((nl = sseBuf.indexOf("\n")) !== -1) {
        const line = sseBuf.slice(0, nl).trim();
        sseBuf = sseBuf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }
        const piece = chunk.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!piece) continue;
        textBuf += piece;

        // Any newly-complete book objects? Send them on.
        for (const book of extract(textBuf)) {
          send({ type: "book", book });
          count++;
        }
      }
    }

    if (count === 0) {
      send({ type: "error", error: "No recommendations were generated." });
    }
    send({ type: "done", count });
    res.end();
  } catch (err) {
    console.error("Stream error:", err);
    send({ type: "error", error: "Stream interrupted." });
    res.end();
  }
}
