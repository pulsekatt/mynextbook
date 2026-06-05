// diagnoseBooks.mjs
// Makes a SINGLE Google Books API call and prints the full response so we can
// see exactly why we're getting 429. Run locally:
//   $env:GOOGLE_BOOKS_API_KEY = "your_real_key"
//   node diagnoseBooks.mjs

const API_KEY = process.env.GOOGLE_BOOKS_API_KEY || "";

console.log("=".repeat(60));
if (!API_KEY) {
  console.log("KEY STATUS: MISSING (running anonymously — will 429 fast)");
} else {
  console.log(
    `KEY STATUS: present — ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)} (length ${API_KEY.length})`
  );
}
console.log("=".repeat(60));

const keyParam = API_KEY ? `&key=${API_KEY}` : "";
const url = `https://www.googleapis.com/books/v1/volumes?q=siddhartha+hesse&maxResults=1${keyParam}`;

console.log("\nRequesting (key hidden):");
console.log("  " + url.replace(API_KEY, "***KEY***"));
console.log("");

try {
  const res = await fetch(url);
  console.log("HTTP STATUS:", res.status, res.statusText);
  console.log("\nResponse headers of interest:");
  for (const h of [
    "content-type",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "retry-after",
    "www-authenticate",
  ]) {
    const v = res.headers.get(h);
    if (v) console.log(`  ${h}: ${v}`);
  }

  const text = await res.text();
  console.log("\nFULL RESPONSE BODY:");
  console.log(text);

  // Try to pull out Google's structured error reason.
  try {
    const j = JSON.parse(text);
    if (j.error) {
      console.log("\n--- PARSED ERROR ---");
      console.log("code:   ", j.error.code);
      console.log("message:", j.error.message);
      console.log("status: ", j.error.status);
      if (j.error.errors) {
        j.error.errors.forEach((e, i) => {
          console.log(`  error[${i}].reason:`, e.reason);
          console.log(`  error[${i}].domain:`, e.domain);
          console.log(`  error[${i}].message:`, e.message);
        });
      }
    }
  } catch {
    // body wasn't JSON
  }
} catch (e) {
  console.log("FETCH THREW:", e.message);
}
