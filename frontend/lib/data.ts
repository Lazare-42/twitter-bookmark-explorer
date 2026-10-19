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
