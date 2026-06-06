// buildPopularBooks.mjs
//
// ONE-TIME / OCCASIONAL build script. Run this LOCALLY (not in the app).
// It reads the curated [title, author] list below, fetches a cover thumbnail
// for each from Google Books, and writes a finished popularBooks.js with the
// cover URLs baked in — so the app never has to fetch covers for these books.
//
// INCREMENTAL: on re-runs, it LOADS the existing popularBooks.js and ONLY
// fetches covers for books that are either new in the RAW list OR still
// missing a cover. Books that already have a cover are skipped entirely.
// This way you can re-run safely without burning quota on books you've
// already covered.
//
// Usage:
//   1. Put your Google Books API key in the env var (optional but avoids rate limits):
//        export GOOGLE_BOOKS_API_KEY=your_key_here
//   2. node buildPopularBooks.mjs
//   3. It overwrites ./popularBooks.js with covers included.
//   4. Commit the new popularBooks.js and push. Done.
//
// Force a full re-fetch (ignore existing covers) by passing --force:
//   node buildPopularBooks.mjs --force

import { writeFileSync } from "node:fs";

const API_KEY = process.env.GOOGLE_BOOKS_API_KEY || "AIzaSyCQ_xLMfBVPDQKc1K7ou4RAysFzndBX_3c";
const FORCE = process.argv.includes("--force");

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

// ---- Load existing popularBooks.js so we can reuse already-fetched covers ----
// We import dynamically — if the file doesn't exist yet (first run), we just
// start with an empty map and fetch everything.
let existingCovers = new Map();
if (!FORCE) {
  try {
    const mod = await import("./popularBooks.js");
    const prev = mod.default || [];
    for (const b of prev) {
      if (b?.cover && b?.key) existingCovers.set(b.key, b.cover);
    }
    console.log(`Loaded ${existingCovers.size} existing covers from popularBooks.js`);
  } catch {
    console.log("No existing popularBooks.js found — fetching all from scratch.");
  }
} else {
  console.log("--force passed — re-fetching ALL covers, ignoring existing ones.");
}

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

  // ============================================================
  // EXPANSION SET — added to broaden cache coverage.
  // ============================================================

  // ---- Newer bestsellers (2015-2026) ----
  ["A Little Life", "Hanya Yanagihara"],
  ["Lessons in Chemistry", "Bonnie Garmus"],
  ["Tomorrow, and Tomorrow, and Tomorrow", "Gabrielle Zevin"],
  ["Demon Copperhead", "Barbara Kingsolver"],
  ["The Covenant of Water", "Abraham Verghese"],
  ["Trust", "Hernan Diaz"],
  ["The Lincoln Highway", "Amor Towles"],
  ["A Gentleman in Moscow", "Amor Towles"],
  ["The Overstory", "Richard Powers"],
  ["Pachinko", "Min Jin Lee"],
  ["Little Fires Everywhere", "Celeste Ng"],
  ["Everything I Never Told You", "Celeste Ng"],
  ["The Vanishing Half", "Brit Bennett"],
  ["An American Marriage", "Tayari Jones"],
  ["The Nightingale", "Kristin Hannah"],
  ["The Four Winds", "Kristin Hannah"],
  ["The Great Alone", "Kristin Hannah"],
  ["All the Light We Cannot See", "Anthony Doerr"],
  ["The Underground Railroad", "Colson Whitehead"],
  ["The Nickel Boys", "Colson Whitehead"],
  ["Hamnet", "Maggie O'Farrell"],
  ["The Dutch House", "Ann Patchett"],
  ["Bel Canto", "Ann Patchett"],
  ["The Goldfinch", "Donna Tartt"],
  ["Klara and the Sun", "Kazuo Ishiguro"],
  ["The Sympathizer", "Viet Thanh Nguyen"],
  ["A Brief History of Seven Killings", "Marlon James"],
  ["Shuggie Bain", "Douglas Stuart"],
  ["The Seven Moons of Maali Almeida", "Shehan Karunatilaka"],
  ["Prophet Song", "Paul Lynch"],
  ["The Bee Sting", "Paul Murray"],
  ["Yellowface", "R.F. Kuang"],
  ["Babel", "R.F. Kuang"],
  ["The Thursday Murder Club", "Richard Osman"],
  ["The Man Who Died Twice", "Richard Osman"],
  ["Anxious People", "Fredrik Backman"],
  ["A Man Called Ove", "Fredrik Backman"],
  ["Beartown", "Fredrik Backman"],
  ["The Maid", "Nita Prose"],
  ["Eleanor Oliphant Is Completely Fine", "Gail Honeyman"],
  ["The Midnight Library", "Matt Haig"],
  ["The Humans", "Matt Haig"],
  ["Project Hail Mary", "Andy Weir"],
  ["Cloud Cuckoo Land", "Anthony Doerr"],
  ["Sea of Tranquility", "Emily St. John Mandel"],
  ["Station Eleven", "Emily St. John Mandel"],
  ["The Glass Hotel", "Emily St. John Mandel"],

  // ---- Romance / BookTok favorites ----
  ["It Ends with Us", "Colleen Hoover"],
  ["It Starts with Us", "Colleen Hoover"],
  ["Verity", "Colleen Hoover"],
  ["Ugly Love", "Colleen Hoover"],
  ["November 9", "Colleen Hoover"],
  ["Reminders of Him", "Colleen Hoover"],
  ["Fourth Wing", "Rebecca Yarros"],
  ["Iron Flame", "Rebecca Yarros"],
  ["A Court of Thorns and Roses", "Sarah J. Maas"],
  ["A Court of Mist and Fury", "Sarah J. Maas"],
  ["A Court of Wings and Ruin", "Sarah J. Maas"],
  ["A Court of Silver Flames", "Sarah J. Maas"],
  ["House of Earth and Blood", "Sarah J. Maas"],
  ["Throne of Glass", "Sarah J. Maas"],
  ["The Love Hypothesis", "Ali Hazelwood"],
  ["Love on the Brain", "Ali Hazelwood"],
  ["Beach Read", "Emily Henry"],
  ["People We Meet on Vacation", "Emily Henry"],
  ["Book Lovers", "Emily Henry"],
  ["Happy Place", "Emily Henry"],
  ["Funny Story", "Emily Henry"],
  ["The Spanish Love Deception", "Elena Armas"],
  ["Icebreaker", "Hannah Grace"],
  ["The Hating Game", "Sally Thorne"],
  ["Red, White & Royal Blue", "Casey McQuiston"],
  ["One Last Stop", "Casey McQuiston"],
  ["The Seven Husbands of Evelyn Hugo", "Taylor Jenkins Reid"],
  ["Daisy Jones & The Six", "Taylor Jenkins Reid"],
  ["Malibu Rising", "Taylor Jenkins Reid"],
  ["Carrie Soto Is Back", "Taylor Jenkins Reid"],
  ["The Song of Achilles", "Madeline Miller"],
  ["Circe", "Madeline Miller"],
  ["A Little Life", "Hanya Yanagihara"],
  ["The Cruel Prince", "Holly Black"],
  ["The Wicked King", "Holly Black"],
  ["Twisted Love", "Ana Huang"],
  ["Haunting Adeline", "H.D. Carlton"],

  // ---- World classics (translated / non-English origin) ----
  ["The Master and Margarita", "Mikhail Bulgakov"],
  ["Doctor Zhivago", "Boris Pasternak"],
  ["Notes from Underground", "Fyodor Dostoevsky"],
  ["The Idiot", "Fyodor Dostoevsky"],
  ["Fathers and Sons", "Ivan Turgenev"],
  ["Dead Souls", "Nikolai Gogol"],
  ["Madame Bovary", "Gustave Flaubert"],
  ["The Red and the Black", "Stendhal"],
  ["Germinal", "Émile Zola"],
  ["Candide", "Voltaire"],
  ["The Plague", "Albert Camus"],
  ["The Fall", "Albert Camus"],
  ["Nausea", "Jean-Paul Sartre"],
  ["The Tin Drum", "Günter Grass"],
  ["Death in Venice", "Thomas Mann"],
  ["The Magic Mountain", "Thomas Mann"],
  ["Buddenbrooks", "Thomas Mann"],
  ["The Name of the Rose", "Umberto Eco"],
  ["If on a Winter's Night a Traveler", "Italo Calvino"],
  ["The Leopard", "Giuseppe Tomasi di Lampedusa"],
  ["My Brilliant Friend", "Elena Ferrante"],
  ["The Story of a New Name", "Elena Ferrante"],
  ["The Shadow of the Wind", "Carlos Ruiz Zafón"],
  ["The House of the Spirits", "Isabel Allende"],
  ["Pedro Páramo", "Juan Rulfo"],
  ["The Trial", "Franz Kafka"],
  ["The Unbearable Lightness of Being", "Milan Kundera"],
  ["Kafka on the Shore", "Haruki Murakami"],
  ["Norwegian Wood", "Haruki Murakami"],
  ["The Wind-Up Bird Chronicle", "Haruki Murakami"],
  ["1Q84", "Haruki Murakami"],
  ["Colorless Tsukuru Tazaki and His Years of Pilgrimage", "Haruki Murakami"],
  ["Convenience Store Woman", "Sayaka Murata"],
  ["The Vegetarian", "Han Kang"],
  ["Snow Country", "Yasunari Kawabata"],
  ["Things Fall Apart", "Chinua Achebe"],
  ["The God of Small Things", "Arundhati Roy"],
  ["Midnight's Children", "Salman Rushdie"],

  // ---- Scandinavian / Nordic ----
  ["The Girl Who Kicked the Hornet's Nest", "Stieg Larsson"],
  ["The Snowman", "Jo Nesbø"],
  ["The Bat", "Jo Nesbø"],
  ["The Redbreast", "Jo Nesbø"],
  ["The Leopard", "Jo Nesbø"],
  ["Smilla's Sense of Snow", "Peter Høeg"],
  ["The Hundred-Year-Old Man Who Climbed Out the Window and Disappeared", "Jonas Jonasson"],
  ["My Struggle: Book 1", "Karl Ove Knausgård"],
  ["Out Stealing Horses", "Per Petterson"],
  ["Kristin Lavransdatter", "Sigrid Undset"],
  ["Growth of the Soil", "Knut Hamsun"],
  ["Hunger", "Knut Hamsun"],
  ["Doppler", "Erlend Loe"],
  ["Naive. Super", "Erlend Loe"],
  ["The Half Brother", "Lars Saabye Christensen"],
  ["Beatles", "Lars Saabye Christensen"],
  ["Sophie's World", "Jostein Gaarder"],
  ["The Ice Palace", "Tarjei Vesaas"],
  ["The Birds", "Tarjei Vesaas"],
  ["Doctor Glas", "Hjalmar Söderberg"],
  ["The Emigrants", "Vilhelm Moberg"],
  ["A Death in the Family", "Karl Ove Knausgård"],
  ["The Consequences of Love", "Sulaiman Addonia"],
  ["Let the Right One In", "John Ajvide Lindqvist"],
  ["Roseanna", "Maj Sjöwall"],
  ["The Laughing Policeman", "Maj Sjöwall"],
  ["Faceless Killers", "Henning Mankell"],
  ["The Dogs of Riga", "Henning Mankell"],
  ["The Dinner", "Herman Koch"],
  ["The Unit", "Ninni Holmqvist"],

  // ---- More fantasy / sci-fi series ----
  ["The Two Towers", "J.R.R. Tolkien"],
  ["The Return of the King", "J.R.R. Tolkien"],
  ["A Feast for Crows", "George R.R. Martin"],
  ["A Dance with Dragons", "George R.R. Martin"],
  ["The Wise Man's Fear", "Patrick Rothfuss"],
  ["The Final Empire", "Brandon Sanderson"],
  ["The Well of Ascension", "Brandon Sanderson"],
  ["The Hero of Ages", "Brandon Sanderson"],
  ["Oathbringer", "Brandon Sanderson"],
  ["Rhythm of War", "Brandon Sanderson"],
  ["Elantris", "Brandon Sanderson"],
  ["Warbreaker", "Brandon Sanderson"],
  ["The Great Hunt", "Robert Jordan"],
  ["The Dragon Reborn", "Robert Jordan"],
  ["Assassin's Apprentice", "Robin Hobb"],
  ["Royal Assassin", "Robin Hobb"],
  ["The Lies of Locke Lamora", "Scott Lynch"],
  ["The Blade Itself", "Joe Abercrombie"],
  ["The Fifth Season", "N.K. Jemisin"],
  ["The Obelisk Gate", "N.K. Jemisin"],
  ["Gardens of the Moon", "Steven Erikson"],
  ["The Black Prism", "Brent Weeks"],
  ["The Way of Shadows", "Brent Weeks"],
  ["Mistborn: The Alloy of Law", "Brandon Sanderson"],
  ["The Priory of the Orange Tree", "Samantha Shannon"],
  ["The Poppy War", "R.F. Kuang"],
  ["The Bear and the Nightingale", "Katherine Arden"],
  ["Uprooted", "Naomi Novik"],
  ["Spinning Silver", "Naomi Novik"],
  ["Jonathan Strange & Mr Norrell", "Susanna Clarke"],
  ["Piranesi", "Susanna Clarke"],
  ["The Atlas Six", "Olivie Blake"],
  ["A Darker Shade of Magic", "V.E. Schwab"],
  ["The Invisible Life of Addie LaRue", "V.E. Schwab"],
  ["Children of Time", "Adrian Tchaikovsky"],
  ["Hyperion", "Dan Simmons"],
  ["Snow Crash", "Neal Stephenson"],
  ["The Three-Body Problem", "Liu Cixin"],
  ["The Dark Forest", "Liu Cixin"],
  ["Death's End", "Liu Cixin"],
  ["Leviathan Wakes", "James S.A. Corey"],
  ["A Fire Upon the Deep", "Vernor Vinge"],
  ["The Dispossessed", "Ursula K. Le Guin"],
  ["Rendezvous with Rama", "Arthur C. Clarke"],
  ["2001: A Space Odyssey", "Arthur C. Clarke"],
  ["Childhood's End", "Arthur C. Clarke"],
  ["Stranger in a Strange Land", "Robert A. Heinlein"],
  ["Starship Troopers", "Robert A. Heinlein"],
  ["The Forever War", "Joe Haldeman"],
  ["Red Rising", "Pierce Brown"],
  ["Golden Son", "Pierce Brown"],
  ["The Blade Itself", "Joe Abercrombie"],

  // ---- More non-fiction / business / self-help ----
  ["The Lean Startup", "Eric Ries"],
  ["Zero to One", "Peter Thiel"],
  ["Good to Great", "Jim Collins"],
  ["Built to Last", "Jim Collins"],
  ["The Hard Thing About Hard Things", "Ben Horowitz"],
  ["Shoe Dog", "Phil Knight"],
  ["The Innovator's Dilemma", "Clayton M. Christensen"],
  ["Start with Why", "Simon Sinek"],
  ["Leaders Eat Last", "Simon Sinek"],
  ["Dare to Lead", "Brené Brown"],
  ["Daring Greatly", "Brené Brown"],
  ["Grit", "Angela Duckworth"],
  ["Mindset", "Carol S. Dweck"],
  ["Drive", "Daniel H. Pink"],
  ["Range", "David Epstein"],
  ["Freakonomics", "Steven D. Levitt"],
  ["Nudge", "Richard H. Thaler"],
  ["Predictably Irrational", "Dan Ariely"],
  ["The Psychology of Money", "Morgan Housel"],
  ["The Intelligent Investor", "Benjamin Graham"],
  ["A Random Walk Down Wall Street", "Burton G. Malkiel"],
  ["The Millionaire Next Door", "Thomas J. Stanley"],
  ["I Will Teach You to Be Rich", "Ramit Sethi"],
  ["The Almanack of Naval Ravikant", "Eric Jorgenson"],
  ["Atomic Habits", "James Clear"],
  ["The Compound Effect", "Darren Hardy"],
  ["Essentialism", "Greg McKeown"],
  ["So Good They Can't Ignore You", "Cal Newport"],
  ["Digital Minimalism", "Cal Newport"],
  ["The 4-Hour Workweek", "Timothy Ferriss"],
  ["Tools of Titans", "Timothy Ferriss"],
  ["Sapiens: A Brief History of Humankind", "Yuval Noah Harari"],
  ["21 Lessons for the 21st Century", "Yuval Noah Harari"],
  ["Guns, Germs, and Steel", "Jared Diamond"],
  ["The Selfish Gene", "Richard Dawkins"],
  ["Cosmos", "Carl Sagan"],
  ["The Gene", "Siddhartha Mukherjee"],
  ["The Emperor of All Maladies", "Siddhartha Mukherjee"],
  ["Why We Sleep", "Matthew Walker"],
  ["Breath", "James Nestor"],
  ["Outlive", "Peter Attia"],
  ["The Immortal Life of Henrietta Lacks", "Rebecca Skloot"],
  ["When Breath Becomes Air", "Paul Kalanithi"],
  ["Bad Blood", "John Carreyrou"],
  ["The Devil in the White City", "Erik Larson"],
  ["In Cold Blood", "Truman Capote"],
  ["The Wright Brothers", "David McCullough"],
  ["Team of Rivals", "Doris Kearns Goodwin"],
  ["The Power Broker", "Robert A. Caro"],
  ["Just Mercy", "Bryan Stevenson"],
  ["The Warmth of Other Suns", "Isabel Wilkerson"],
  ["Caste", "Isabel Wilkerson"],
  ["Between the World and Me", "Ta-Nehisi Coates"],
  ["The Body", "Bill Bryson"],
  ["A Short History of Nearly Everything", "Bill Bryson"],
  ["Talking to Strangers", "Malcolm Gladwell"],
  ["Blink", "Malcolm Gladwell"],
  ["David and Goliath", "Malcolm Gladwell"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Force https so the cover loads on an https site (Google sometimes returns http).
const toHttps = (url) => (url ? url.replace(/^http:\/\//, "https://") : null);

// Pull the first cover image from a list of Google Books items. Many top
// results are odd editions (audiobooks, study guides, foreign re-issues) that
// have no imageLinks, so we walk the list until we find one that does.
function firstCoverFromItems(items) {
  for (const it of items || []) {
    const links = it?.volumeInfo?.imageLinks;
    const c = links?.thumbnail || links?.smallThumbnail;
    if (c) return toHttps(c);
  }
  return null;
}

// Run a single Google Books query with rate-limit retry. Returns the items
// array (possibly empty) or null on a hard failure.
async function queryGoogleBooks(queryString, label, retries = 0) {
  const keyParam = API_KEY ? `&key=${API_KEY}` : "";
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(queryString)}&maxResults=5${keyParam}`;
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      if (retries < 3) {
        const backoffMs = 1500 + retries * 1000;
        console.warn(`  ! 429 rate limit for "${label}" — backing off ${backoffMs}ms, retry ${retries + 1}/3`);
        await sleep(backoffMs);
        return queryGoogleBooks(queryString, label, retries + 1);
      }
      console.warn(`  ! 429 (gave up after retries) for "${label}"`);
      return null;
    }
    if (!res.ok) {
      console.warn(`  ! ${res.status} for "${label}"`);
      return null;
    }
    const data = await res.json();
    return data.items || [];
  } catch (e) {
    console.warn(`  ! error for "${label}": ${e.message}`);
    return null;
  }
}

async function fetchCover(title, author) {
  // Strategy 1: strict intitle/inauthor query — usually returns canonical editions.
  let items = await queryGoogleBooks(`intitle:${title} inauthor:${author}`, title);
  let cover = firstCoverFromItems(items);
  if (cover) return cover;

  // Strategy 2: looser plain-text query — same query the app uses, catches
  // books where the catalog title varies slightly from our RAW list.
  items = await queryGoogleBooks(`${title} ${author}`, title);
  cover = firstCoverFromItems(items);
  if (cover) return cover;

  return null;
}

async function main() {
  // Dedupe the RAW list by computed key first — the curated list spans several
  // category sections and the same book can legitimately appear in two of them
  // (e.g. a literary title that's also a BookTok favorite). Keep first occurrence.
  const seenKeys = new Set();
  const dedupedRaw = [];
  let dupCount = 0;
  for (const [title, author] of RAW) {
    const key = "pop-" + slug(title + "-" + author);
    if (seenKeys.has(key)) {
      dupCount++;
      continue;
    }
    seenKeys.add(key);
    dedupedRaw.push([title, author]);
  }
  if (dupCount > 0) {
    console.log(`Removed ${dupCount} duplicate title(s) from RAW (${dedupedRaw.length} unique).`);
  }

  // First pass: figure out which books need fetching vs. which we can reuse.
  // We compute the key the same way as the final output so we can look up
  // existing covers without re-fetching.
  const plan = dedupedRaw.map(([title, author]) => {
    const key = "pop-" + slug(title + "-" + author);
    const existing = existingCovers.get(key);
    return { title, author, key, existing: existing || null };
  });

  const toFetch = plan.filter((p) => !p.existing);
  const reused = plan.length - toFetch.length;

  console.log(
    `\n${plan.length} books total: reusing ${reused} cached cover(s), ` +
      `fetching ${toFetch.length} from Google Books.\n`
  );

  if (toFetch.length === 0) {
    console.log("Nothing to fetch — popularBooks.js is already complete. Skipping write.");
    return;
  }

  const out = [];
  let hit = reused;
  let fetched = 0;
  for (const p of plan) {
    if (p.existing) {
      out.push({ title: p.title, author: p.author, cover: p.existing, key: p.key });
      continue;
    }
    const cover = await fetchCover(p.title, p.author);
    if (cover) hit++;
    out.push({ title: p.title, author: p.author, cover, key: p.key });
    fetched++;
    process.stdout.write(
      `\r  fetched ${fetched}/${toFetch.length} (${hit}/${plan.length} total covers)   `
    );
    await sleep(250); // be polite to the API / avoid rate limits
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
  console.log(`Done. ${hit}/${plan.length} covers found (${fetched} new fetches). Wrote popularBooks.js`);
  if (hit < plan.length) {
    console.log("Books with no cover (will show 📖 placeholder):");
    out.filter((b) => !b.cover).forEach((b) => console.log("  -", b.title));
  }
}

main();
