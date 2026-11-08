// Server-only data access (node:fs) — keep out of client components; they
// import types/helpers from "./data" instead.
import fs from "node:fs";
import { THEME_LABELS, purchaseLink, type Bookmark } from "./data";

// Runtime data: BOOKMARKS_DATA (default ./data/enriched.json, relative to the
// server's cwd) is the file the daily sync job writes. It is re-read whenever its
// mtime changes — no rebuild needed to publish new bookmarks. No data is bundled
// into the build.
let cache: { key: string; data: Bookmark[] } | null = null;

function mtime(path: string | undefined): number {
  try {
    return path ? fs.statSync(path).mtimeMs : 0;
  } catch {
    return 0;
  }
}

// threads.json (BOOKMARKS_THREADS): { "<bookmarkId>": { checked, thread: ThreadPost[] | null } }
function readThreads(path: string | undefined): Record<string, { thread: Bookmark["thread"] | null }> {
  try {
    return path ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
  } catch {
    return {};
  }
}

export function getBookmarks(): Bookmark[] {
  const path = process.env.BOOKMARKS_DATA || "data/enriched.json";
  const threadsPath = process.env.BOOKMARKS_THREADS;
  const key = `${mtime(path)}:${mtime(threadsPath)}`;
  if (cache && cache.key === key) return cache.data;
  let base: Bookmark[] = [];
  try {
    base = JSON.parse(fs.readFileSync(path, "utf8")) as Bookmark[];
  } catch {
    /* missing/mid-write/corrupt → keep last good copy, else serve nothing */
    if (cache) return cache.data;
  }
  const threads = readThreads(threadsPath);
  const data = base.map((b) => {
    const t = threads[b.id]?.thread;
    return t && t.length > 1 ? { ...b, thread: t } : b;
  });
  cache = { key, data };
  return data;
}

export function themeCounts(): { theme: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of getBookmarks()) counts.set(b.theme, (counts.get(b.theme) || 0) + 1);
  return Object.keys(THEME_LABELS)
    .filter((t) => counts.has(t))
    .map((t) => ({ theme: t, label: THEME_LABELS[t], count: counts.get(t)! }));
}

export function byTheme(theme: string): Bookmark[] {
  return getBookmarks()
    .filter((b) => b.theme === theme)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function bookRecs(): Bookmark[] {
  return getBookmarks()
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
  for (const b of getBookmarks()) {
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
