// api/recommend.js
// Vercel serverless function. Runs on the server, so GEMINI_API_KEY is never
// shipped to the browser. The client POSTs { myBooks, notInterested } here.

// Small helper: pause for `ms` milliseconds.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Call Gemini, retrying on transient errors (503 overloaded, 429 rate-limited,
// 500 server error). Waits a bit longer between each attempt (backoff).
async function callGeminiWithRetry(body, apiKey, maxAttempts = 4) {
  let lastErr = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      }
    );

    if (resp.ok) return resp;

    lastErr = await resp.text();
    const transient = [429, 500, 503].includes(resp.status);

    // If it's not a transient error, or we're out of attempts, stop.
    if (!transient || attempt === maxAttempts) {
      const err = new Error(`Gemini ${resp.status}`);
      err.status = resp.status;
      err.detail = lastErr;
      throw err;
    }

    // Wait before retrying: 0.6s, then 1.2s, then 2.4s...
    const wait = 600 * Math.pow(2, attempt - 1);
    console.warn(`Gemini ${resp.status}, retrying in ${wait}ms (attempt ${attempt}/${maxAttempts})`);
    await sleep(wait);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Missing GEMINI_API_KEY env var");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  try {
    const { myBooks = [], notInterested = [] } = req.body || {};

    if (!Array.isArray(myBooks) || myBooks.length === 0) {
      return res.status(400).json({ error: "No books provided" });
    }

    const bookList = myBooks
      .map((b) => `"${b.title}" by ${b.author}`)
      .join(", ");
    const excludeList = notInterested
      .map((b) => `"${b.title}" by ${b.author}`)
      .join(", ");
    const excludeClause = excludeList
      ? ` Do NOT recommend any of these books (I'm not interested in them): ${excludeList}.`
      : "";

    const prompt = `Based on these books I've read: ${bookList}.${excludeClause} Recommend 5 new books I'd enjoy. Respond ONLY in JSON array format like this, no other text: [{"title":"Book Title","author":"Author Name","reason":"One sentence why I'd like it","confidence":92,"genre":"Primary genre","themes":["theme1","theme2","theme3"],"details":"A 2-3 sentence deeper explanation of why this book matches the reader's taste, referencing what they've read and what they'll get from it."}]. The confidence field should be a number from 70-99 representing how confident you are this book matches the reader's taste. The themes array should contain 2-4 short theme/topic tags.`;

    let geminiRes;
    try {
      geminiRes = await callGeminiWithRetry(
        { contents: [{ parts: [{ text: prompt }] }] },
        apiKey
      );
    } catch (err) {
      console.error("Gemini API error:", err.status, err.detail);
      // 503 = model overloaded; tell the client it's temporary so it can say so.
      if (err.status === 503 || err.status === 429) {
        return res
          .status(503)
          .json({ error: "The recommendation model is busy right now. Please try again in a moment." });
      }
      return res.status(502).json({ error: "Recommendation service failed" });
    }

    const data = await geminiRes.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.replace(/```json|```/g, "").trim();

    let recommendations;
    try {
      recommendations = JSON.parse(text);
    } catch {
      console.error("Could not parse Gemini output:", text);
      return res.status(502).json({ error: "Could not parse recommendations" });
    }

    return res.status(200).json({ recommendations });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
}