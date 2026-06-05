// buildPopularBooks.mjs
//
// ONE-TIME / OCCASIONAL build script. Run this LOCALLY (not in the app).
// It reads the curated [title, author] list below, fetches a cover thumbnail
// for each from Google Books, and writes a finished popularBooks.js with the
// cover URLs baked in — so the app never has to fetch covers for these books.
//
// Usage:
//   1. Put your Google Books API key in the env var (optional but avoids rate limits):
//        export GOOGLE_BOOKS_API_KEY=your_key_here
//   2. node buildPopularBooks.mjs
//   3. It overwrites ./popularBooks.js with covers included.
//   4. Commit the new popularBooks.js and push. Done.
//
// Re-run only when you change the RAW list below.

import { writeFileSync } from "node:fs";

const API_KEY = process.env.GOOGLE_BOOKS_API_KEY || "";

// Running without a key uses Google's tiny anonymous per-IP quota, which causes
// near-instant 429s. Bail out loudly so this never happens by accident.
if (!API_KEY) {
  console.error(
    "\n  ERROR: No API key found.\n" +
      "  The script would run against Google's anonymous quota and get rate-limited (429).\n\n" +
      "  Set it first, then re-run:\n" +
      '    PowerShell:  $env:GOOGLE_BOOKS_API_KEY = "your_real_key_here"\n' +
      "    then:        node buildPopularBooks.mjs\n\n" +
      "  Verify it's set with:  echo $env:GOOGLE_BOOKS_API_KEY\n"
  );
  process.exit(1);
}

// Show that a key is loaded (masked) so you can confirm it's actually being used.
console.log(
  `Using API key: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)} (length ${API_KEY.length})`
);

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// ---- The curated list. Edit here, then re-run the script. ----
const RAW = [
  // Classics / literary
  ["A Tale of Two Cities", "Charles Dickens"],
  ["Great Expectations", "Charles Dickens"],
  ["Oliver Twist", "Charles Dickens"],
  ["The Little Prince", "Antoine de Saint-Exupéry"],
  ["Don Quixote", "Miguel de Cervantes"],
  ["The Count of Monte Cristo", "Alexandre Dumas"],
  ["The Three Musketeers", "Alexandre Dumas"],
  ["Pride and Prejudice", "Jane Austen"],
  ["Sense and Sensibility", "Jane Austen"],
  ["Emma", "Jane Austen"],
  ["Jane Eyre", "Charlotte Brontë"],
  ["Wuthering Heights", "Emily Brontë"],
  ["To Kill a Mockingbird", "Harper Lee"],
  ["The Great Gatsby", "F. Scott Fitzgerald"],
  ["1984", "George Orwell"],
  ["Animal Farm", "George Orwell"],
  ["Brave New World", "Aldous Huxley"],
  ["Fahrenheit 451", "Ray Bradbury"],
  ["The Catcher in the Rye", "J.D. Salinger"],
  ["Of Mice and Men", "John Steinbeck"],
  ["The Grapes of Wrath", "John Steinbeck"],
  ["East of Eden", "John Steinbeck"],
  ["Moby-Dick", "Herman Melville"],
  ["The Adventures of Huckleberry Finn", "Mark Twain"],
  ["The Adventures of Tom Sawyer", "Mark Twain"],
  ["Crime and Punishment", "Fyodor Dostoevsky"],
  ["The Brothers Karamazov", "Fyodor Dostoevsky"],
  ["War and Peace", "Leo Tolstoy"],
  ["Anna Karenina", "Leo Tolstoy"],
  ["Les Misérables", "Victor Hugo"],
  ["The Hunchback of Notre-Dame", "Victor Hugo"],
  ["Frankenstein", "Mary Shelley"],
  ["Dracula", "Bram Stoker"],
  ["The Picture of Dorian Gray", "Oscar Wilde"],
  ["Heart of Darkness", "Joseph Conrad"],
  ["The Old Man and the Sea", "Ernest Hemingway"],
  ["For Whom the Bell Tolls", "Ernest Hemingway"],
  ["One Hundred Years of Solitude", "Gabriel García Márquez"],
  ["Love in the Time of Cholera", "Gabriel García Márquez"],
  ["The Alchemist", "Paulo Coelho"],
  ["Lord of the Flies", "William Golding"],
  ["Catch-22", "Joseph Heller"],
  ["Slaughterhouse-Five", "Kurt Vonnegut"],
  ["The Bell Jar", "Sylvia Plath"],
  ["Beloved", "Toni Morrison"],
  ["Their Eyes Were Watching God", "Zora Neale Hurston"],
  ["The Color Purple", "Alice Walker"],
  ["A Thousand Splendid Suns", "Khaled Hosseini"],
  ["The Kite Runner", "Khaled Hosseini"],
  ["Life of Pi", "Yann Martel"],
  ["The Book Thief", "Markus Zusak"],
  ["The Handmaid's Tale", "Margaret Atwood"],
  ["Never Let Me Go", "Kazuo Ishiguro"],
  ["The Remains of the Day", "Kazuo Ishiguro"],
  // Fantasy / sci-fi
  ["The Hobbit", "J.R.R. Tolkien"],
  ["The Lord of the Rings", "J.R.R. Tolkien"],
  ["The Silmarillion", "J.R.R. Tolkien"],
  ["Harry Potter and the Philosopher's Stone", "J.K. Rowling"],
  ["Harry Potter and the Chamber of Secrets", "J.K. Rowling"],
  ["Harry Potter and the Prisoner of Azkaban", "J.K. Rowling"],
  ["Harry Potter and the Goblet of Fire", "J.K. Rowling"],
  ["Harry Potter and the Order of the Phoenix", "J.K. Rowling"],
  ["Harry Potter and the Half-Blood Prince", "J.K. Rowling"],
  ["Harry Potter and the Deathly Hallows", "J.K. Rowling"],
  ["The Lion, the Witch and the Wardrobe", "C.S. Lewis"],
  ["A Game of Thrones", "George R.R. Martin"],
  ["A Clash of Kings", "George R.R. Martin"],
  ["A Storm of Swords", "George R.R. Martin"],
  ["The Name of the Wind", "Patrick Rothfuss"],
  ["The Way of Kings", "Brandon Sanderson"],
  ["Mistborn: The Final Empire", "Brandon Sanderson"],
  ["The Eye of the World", "Robert Jordan"],
  ["American Gods", "Neil Gaiman"],
  ["Good Omens", "Neil Gaiman"],
  ["The Color of Magic", "Terry Pratchett"],
  ["Dune", "Frank Herbert"],
  ["Foundation", "Isaac Asimov"],
  ["I, Robot", "Isaac Asimov"],
  ["Ender's Game", "Orson Scott Card"],
  ["The Hitchhiker's Guide to the Galaxy", "Douglas Adams"],
  ["Ready Player One", "Ernest Cline"],
  ["The Martian", "Andy Weir"],
  ["Project Hail Mary", "Andy Weir"],
  ["Neuromancer", "William Gibson"],
  ["Do Androids Dream of Electric Sheep?", "Philip K. Dick"],
  ["The Left Hand of Darkness", "Ursula K. Le Guin"],
  ["A Wizard of Earthsea", "Ursula K. Le Guin"],
  ["The Fellowship of the Ring", "J.R.R. Tolkien"],
  ["Eragon", "Christopher Paolini"],
  ["The Lightning Thief", "Rick Riordan"],
  // Thriller / mystery / crime
  ["The Da Vinci Code", "Dan Brown"],
  ["Angels & Demons", "Dan Brown"],
  ["The Girl with the Dragon Tattoo", "Stieg Larsson"],
  ["Gone Girl", "Gillian Flynn"],
  ["The Girl on the Train", "Paula Hawkins"],
  ["The Silent Patient", "Alex Michaelides"],
  ["And Then There Were None", "Agatha Christie"],
  ["Murder on the Orient Express", "Agatha Christie"],
  ["The Murder of Roger Ackroyd", "Agatha Christie"],
  ["The Hound of the Baskervilles", "Arthur Conan Doyle"],
  ["The Firm", "John Grisham"],
  ["A Time to Kill", "John Grisham"],
  ["The Pelican Brief", "John Grisham"],
  ["The Shining", "Stephen King"],
  ["It", "Stephen King"],
  ["The Stand", "Stephen King"],
  ["Misery", "Stephen King"],
  ["Carrie", "Stephen King"],
  ["The Bourne Identity", "Robert Ludlum"],
  ["The Girl Who Played with Fire", "Stieg Larsson"],
  ["Big Little Lies", "Liane Moriarty"],
  ["The Reversal", "Michael Connelly"],
  ["Along Came a Spider", "James Patterson"],
  ["The Cuckoo's Calling", "Robert Galbraith"],
  // Romance / contemporary
  ["The Notebook", "Nicholas Sparks"],
  ["A Walk to Remember", "Nicholas Sparks"],
  ["Me Before You", "Jojo Moyes"],
  ["Outlander", "Diana Gabaldon"],
  ["It Ends with Us", "Colleen Hoover"],
  ["Verity", "Colleen Hoover"],
  ["The Fault in Our Stars", "John Green"],
  ["Pride and Prejudice and Zombies", "Seth Grahame-Smith"],
  ["The Time Traveler's Wife", "Audrey Niffenegger"],
  ["Where the Crawdads Sing", "Delia Owens"],
  ["Normal People", "Sally Rooney"],
  ["The Seven Husbands of Evelyn Hugo", "Taylor Jenkins Reid"],
  ["Bridget Jones's Diary", "Helen Fielding"],
  // YA / middle-grade
  ["The Hunger Games", "Suzanne Collins"],
  ["Catching Fire", "Suzanne Collins"],
  ["Mockingjay", "Suzanne Collins"],
  ["Twilight", "Stephenie Meyer"],
  ["New Moon", "Stephenie Meyer"],
  ["Divergent", "Veronica Roth"],
  ["The Maze Runner", "James Dashner"],
  ["The Perks of Being a Wallflower", "Stephen Chbosky"],
  ["Looking for Alaska", "John Green"],
  ["The Giver", "Lois Lowry"],
  ["Wonder", "R.J. Palacio"],
  ["Charlotte's Web", "E.B. White"],
  ["Matilda", "Roald Dahl"],
  ["Charlie and the Chocolate Factory", "Roald Dahl"],
  ["The BFG", "Roald Dahl"],
  ["Diary of a Wimpy Kid", "Jeff Kinney"],
  ["The Cat in the Hat", "Dr. Seuss"],
  ["Green Eggs and Ham", "Dr. Seuss"],
  ["Oh, the Places You'll Go!", "Dr. Seuss"],
  // Non-fiction / self-help / memoir
  ["Sapiens: A Brief History of Humankind", "Yuval Noah Harari"],
  ["Homo Deus", "Yuval Noah Harari"],
  ["Atomic Habits", "James Clear"],
  ["The 7 Habits of Highly Effective People", "Stephen R. Covey"],
  ["How to Win Friends and Influence People", "Dale Carnegie"],
  ["Think and Grow Rich", "Napoleon Hill"],
  ["Rich Dad Poor Dad", "Robert T. Kiyosaki"],
  ["The Power of Now", "Eckhart Tolle"],
  ["A New Earth", "Eckhart Tolle"],
  ["The Subtle Art of Not Giving a F*ck", "Mark Manson"],
  ["Thinking, Fast and Slow", "Daniel Kahneman"],
  ["Outliers", "Malcolm Gladwell"],
  ["The Tipping Point", "Malcolm Gladwell"],
  ["Educated", "Tara Westover"],
  ["Becoming", "Michelle Obama"],
  ["The Diary of a Young Girl", "Anne Frank"],
  ["Man's Search for Meaning", "Viktor E. Frankl"],
  ["Quiet: The Power of Introverts", "Susan Cain"],
  ["The Body Keeps the Score", "Bessel van der Kolk"],
  ["The Four Agreements", "Don Miguel Ruiz"],
  ["The Power of Habit", "Charles Duhigg"],
  ["Born a Crime", "Trevor Noah"],
  ["The Gifts of Imperfection", "Brené Brown"],
  ["A Brief History of Time", "Stephen Hawking"],
  ["Steve Jobs", "Walter Isaacson"],
  // Additional widely-searched titles
  ["Siddhartha", "Hermann Hesse"],
  ["Steppenwolf", "Hermann Hesse"],
  ["The Stranger", "Albert Camus"],
  ["The Trial", "Franz Kafka"],
  ["The Metamorphosis", "Franz Kafka"],
  ["A Clockwork Orange", "Anthony Burgess"],
  ["The Road", "Cormac McCarthy"],
  ["Blood Meridian", "Cormac McCarthy"],
  ["No Country for Old Men", "Cormac McCarthy"],
  ["The Secret History", "Donna Tartt"],
  ["The Goldfinch", "Donna Tartt"],
  ["A Little Life", "Hanya Yanagihara"],
  ["The Midnight Library", "Matt Haig"],
  ["Klara and the Sun", "Kazuo Ishiguro"],
  ["Circe", "Madeline Miller"],
  ["The Song of Achilles", "Madeline Miller"],
  ["Dune Messiah", "Frank Herbert"],
  ["The Two Towers", "J.R.R. Tolkien"],
  ["The Return of the King", "J.R.R. Tolkien"],
  ["The Wise Man's Fear", "Patrick Rothfuss"],
  ["Words of Radiance", "Brandon Sanderson"],
  ["The Power of Positive Thinking", "Norman Vincent Peale"],
  ["Can't Hurt Me", "David Goggins"],
  ["Deep Work", "Cal Newport"],
  ["Ikigai", "Héctor García"],
  ["The 48 Laws of Power", "Robert Greene"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Force https so the cover loads on an https site (Google sometimes returns http).
const toHttps = (url) => (url ? url.replace(/^http:\/\//, "https://") : null);

async function fetchCover(title, author, retries = 0) {
  const q = encodeURIComponent(`${title} ${author}`);
  const keyParam = API_KEY ? `&key=${API_KEY}` : "";
  const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1${keyParam}`;
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      // Rate limited. Back off and retry up to 3 times.
      if (retries < 3) {
        const backoffMs = 1500 + retries * 1000; // 1.5s, 2.5s, 3.5s
        console.warn(`  ! 429 rate limit for "${title}" — backing off ${backoffMs}ms, retry ${retries + 1}/3`);
        await sleep(backoffMs);
        return fetchCover(title, author, retries + 1);
      } else {
        console.warn(`  ! 429 (gave up after retries) for "${title}"`);
        return null;
      }
    }
    if (!res.ok) {
      console.warn(`  ! ${res.status} for "${title}"`);
      return null;
    }
    const data = await res.json();
    const img = data.items?.[0]?.volumeInfo?.imageLinks;
    return toHttps(img?.thumbnail || img?.smallThumbnail || null);
  } catch (e) {
    console.warn(`  ! error for "${title}": ${e.message}`);
    return null;
  }
}

async function main() {
  console.log(`Fetching covers for ${RAW.length} books...`);
  const out = [];
  let hit = 0;
  for (let i = 0; i < RAW.length; i++) {
    const [title, author] = RAW[i];
    const cover = await fetchCover(title, author);
    if (cover) hit++;
    out.push({ title, author, cover, key: "pop-" + slug(title + "-" + author) });
    process.stdout.write(`\r  ${i + 1}/${RAW.length} (${hit} covers found)   `);
    await sleep(250); // be polite to the API / avoid rate limits (increased from 120ms)
  }
  console.log("");

  const fileBody = `// popularBooks.js
// AUTO-GENERATED by buildPopularBooks.mjs — do not hand-edit cover URLs.
// Edit the RAW list in buildPopularBooks.mjs and re-run that script instead.
//
// Curated best-selling / popular books with cover URLs baked in, so the app
// shows titles AND covers instantly on load with zero network calls.

const POPULAR_BOOKS = ${JSON.stringify(out, null, 2)};

export default POPULAR_BOOKS;
`;

  writeFileSync("./popularBooks.js", fileBody, "utf8");
  console.log(`Done. ${hit}/${RAW.length} covers found. Wrote popularBooks.js`);
  if (hit < RAW.length) {
    console.log("Books with no cover (will show 📖 placeholder):");
    out.filter((b) => !b.cover).forEach((b) => console.log("  -", b.title));
  }
}

main();
