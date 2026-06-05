// api/recommend.js
// Vercel serverless function. Runs on the server, so GEMINI_API_KEY is never
// shipped to the browser. The client POSTs { myBooks, notInterested } here.
//
// Reliability strategy:
//   1. Try the primary model, retrying a couple times on transient errors.
//   2. If the primary model is still overloaded (503), fall back to a second,
//      less-contended model and try that too.
//   3. Only fail if BOTH models are unavailable.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Primary first, fallback second. 2.5-flash is older/less busy, so it usually
// answers when 3.5-flash is slammed. Both are fine for this task.
const MODELS = ["gemini-3.5-flash", "gemini-2.5-flash"];

// Call ONE model, retrying on transient errors (503 overloaded, 429 rate-limited,
// 500 server error). Returns the parsed response, or throws with .status set.
async function callModel(model, body, apiKey, maxAttempts = 2) {
  let lastDetail = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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

    lastDetail = await resp.text();
    const transient = [429, 500, 503].includes(resp.status);

    if (!transient || attempt === maxAttempts) {
      const err = new Error(`${model} -> ${resp.status}`);
      err.status = resp.status;
      err.detail = lastDetail;
      throw err;
    }

    const wait = 500 * attempt; // 500ms, then 1000ms
    console.warn(`${model} returned ${resp.status}, retrying in ${wait}ms (attempt ${attempt}/${maxAttempts})`);
    await sleep(wait);
  }
}

// Try each model in order. Move to the next model only on transient errors;
// for a real error (bad request, bad key) stop immediately — fallback won't help.
async function getGeminiResponse(body, apiKey) {
  let lastErr;
  for (const model of MODELS) {
    try {
      const resp = await callModel(model, body, apiKey);
      if (model !== MODELS[0]) {
        console.warn(`Primary model busy; served from fallback model ${model}`);
      }
      return resp;
    } catch (err) {
      lastErr = err;
      const transient = [429, 500, 503].includes(err.status);
      if (!transient) throw err; // non-transient: don't bother with fallback
      console.warn(`${model} unavailable (${err.status}); trying next model`);
    }
  }
  throw lastErr; // all models exhausted
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
      geminiRes = await getGeminiResponse(
        { contents: [{ parts: [{ text: prompt }] }] },
        apiKey
      );
    } catch (err) {
      console.error("Gemini API error:", err.status, err.detail);
      if (err.status === 503 || err.status === 429) {
        return res
          .status(503)
          .json({ error: "The recommendation models are busy right now. Please try again in a moment." });
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