// api/recommend.js
// Non-streaming. Calls Anthropic's Claude API server-side (key never reaches
// the browser). Client POSTs { myBooks, notInterested }, gets back { recommendations }.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Claude Haiku: fast + cheap, plenty smart for "recommend books like these".
const MODEL = "claude-haiku-4-5-20251001";

// Call Claude, retrying on transient errors (429 rate-limit, 529 overloaded, 5xx).
async function callClaudeWithRetry(body, apiKey, maxAttempts = 3) {
  let lastDetail = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) return resp;

    lastDetail = await resp.text().catch(() => "");
    const transient = [429, 500, 502, 503, 529].includes(resp.status);
    if (!transient || attempt === maxAttempts) {
      const err = new Error(`Claude ${resp.status}`);
      err.status = resp.status;
      err.detail = lastDetail;
      throw err;
    }
    const wait = 600 * attempt; // 600ms, 1200ms
    console.warn(`Claude returned ${resp.status}, retrying in ${wait}ms (attempt ${attempt}/${maxAttempts})`);
    await sleep(wait);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Missing ANTHROPIC_API_KEY env var");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  try {
    const { myBooks = [], notInterested = [] } = req.body || {};
    if (!Array.isArray(myBooks) || myBooks.length === 0) {
      return res.status(400).json({ error: "No books provided" });
    }

    const bookList = myBooks.map((b) => `"${b.title}" by ${b.author}`).join(", ");
    const excludeList = notInterested.map((b) => `"${b.title}" by ${b.author}`).join(", ");
    const excludeClause = excludeList
      ? ` Do NOT recommend any of these books (I'm not interested in them): ${excludeList}.`
      : "";

    const prompt = `Based on these books I've read: ${bookList}.${excludeClause} Recommend 5 new books I'd enjoy. Respond ONLY in JSON array format like this, no other text: [{"title":"Book Title","author":"Author Name","reason":"One sentence why I'd like it","confidence":92,"genre":"Primary genre","themes":["theme1","theme2","theme3"],"details":"A 2-3 sentence deeper explanation of why this book matches the reader's taste, referencing what they've read and what they'll get from it."}]. The confidence field should be a number from 70-99 representing how confident you are this book matches the reader's taste. The themes array should contain 2-4 short theme/topic tags.`;

    let claudeRes;
    try {
      claudeRes = await callClaudeWithRetry(
        {
          model: MODEL,
          max_tokens: 2048,
          system:
            "You are a book recommendation engine. Output ONLY valid JSON matching the requested format — no markdown fences, no preamble, no text outside the JSON array.",
          messages: [{ role: "user", content: prompt }],
        },
        apiKey
      );
    } catch (err) {
      console.error("Claude API error:", err.status, err.detail);
      if (err.status === 429 || err.status === 529) {
        return res
          .status(503)
          .json({ error: "The recommendation service is busy right now. Please try again in a moment." });
      }
      return res.status(502).json({ error: "Recommendation service failed" });
    }

    const data = await claudeRes.json();
    let text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    text = text.replace(/```json|```/g, "").trim();

    let recommendations;
    try {
      recommendations = JSON.parse(text);
    } catch {
      console.error("Could not parse Claude output:", text);
      return res.status(502).json({ error: "Could not parse recommendations" });
    }

    return res.status(200).json({ recommendations });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
}
