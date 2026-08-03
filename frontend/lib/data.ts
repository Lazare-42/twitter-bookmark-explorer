import raw from "@/data/enriched.json";

export type Media = { type: string; thumb: string | null; orig: string | null };
export type Book = { title: string; author: string | null };
export type Bookmark = {
  id: string;
  created_at: string;
  text: string;
  screen_name: string;
  name: string;
  avatar: string | null;
  url: string;
  media: Media[];
  likes: number;
  views: number;
  theme: string;
  is_book: boolean;
  books: Book[];
  summary: string;
  links?: string[];
  book_link?: string; // AI-judged: URL where the book itself can be bought/read
};

// Purchase-shaped domains — a tweet linking one of these is offering the buy
// link itself; prefer it over a generated amazon.fr search.
const PURCHASE_RE =
  /amazon\.|amzn\.|fnac\.com|gumroad\.com|kobo\.com|audible\.|goodreads\.com|leslibraires\.fr|placedeslibraires\.fr|cultura\.com/i;

export function purchaseLink(b: Bookmark): string | null {
  return b.book_link || (b.links || []).find((u) => PURCHASE_RE.test(u)) || null;
}

export function amazonSearchLink(bk: Book): string {
  const q = [bk.title, bk.author].filter(Boolean).join(" ");
  return `https://www.amazon.fr/s?k=${encodeURIComponent(q)}&i=stripbooks`;
}

export const bookmarks = raw as Bookmark[];

export const THEME_LABELS: Record<string, string> = {
  books: "Books",
  ai: "AI & LLMs",
  dev: "Dev & Tools",
  investing: "Investing",
  business: "Business & Startups",
  geopolitics: "Geopolitics & Macro",
  france: "France",
  health: "Health & Fitness",
  culture: "Culture & History",
  humor: "Humor & Memes",
  career: "Career & Productivity",
  travel: "Travel & Lifestyle",
  science: "Science & Hardware",
  other: "Other",
};

export function themeCounts(): { theme: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of bookmarks) counts.set(b.theme, (counts.get(b.theme) || 0) + 1);
  return Object.keys(THEME_LABELS)
    .filter((t) => counts.has(t))
    .map((t) => ({ theme: t, label: THEME_LABELS[t], count: counts.get(t)! }));
}

export function byTheme(theme: string): Bookmark[] {
  return bookmarks
    .filter((b) => b.theme === theme)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function bookRecs(): Bookmark[] {
  return bookmarks
    .filter((b) => b.is_book)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export type AggBook = {
  title: string;
  author: string | null;
  count: number;
  tweetIds: string[];
  link: string | null; // purchase link from a source tweet, when one had it
};

// Aggregate extracted books across tweets, deduped by normalized title.
export function aggregatedBooks(): AggBook[] {
  const map = new Map<string, AggBook>();
  for (const b of bookmarks) {
    for (const bk of b.books || []) {
      if (!bk.title) continue;
      const key = bk.title.toLowerCase().replace(/[^a-z0-9à-ÿ]+/gi, " ").trim();
      if (!key) continue;
      const existing = map.get(key);
      const link = purchaseLink(b);
      if (existing) {
        existing.count += 1;
        existing.tweetIds.push(b.id);
        if (!existing.author && bk.author) existing.author = bk.author;
        if (!existing.link && link) existing.link = link;
      } else {
        map.set(key, {
          title: bk.title,
          author: bk.author,
          count: 1,
          tweetIds: [b.id],
          link,
        });
      }
    }
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.title.localeCompare(b.title)
  );
}
