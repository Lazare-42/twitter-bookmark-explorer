// Server-only data access (node:fs) — keep out of client components; they
// import types/helpers from "./data" instead.
import fs from "node:fs";
import raw from "@/data/enriched.json";
import { THEME_LABELS, purchaseLink, type Bookmark } from "./data";

// Runtime data: when BOOKMARKS_DATA points at a readable file (written by the
// daily sync job), serve it, re-reading whenever its mtime changes — no rebuild
// needed to publish new bookmarks. Falls back to the snapshot bundled at build.
let cache: { mtimeMs: number; data: Bookmark[] } | null = null;

export function getBookmarks(): Bookmark[] {
  const path = process.env.BOOKMARKS_DATA;
  if (path) {
    try {
      const { mtimeMs } = fs.statSync(path);
      if (!cache || cache.mtimeMs !== mtimeMs) {
        cache = { mtimeMs, data: JSON.parse(fs.readFileSync(path, "utf8")) as Bookmark[] };
      }
      return cache.data;
    } catch {
      /* missing/mid-write/corrupt → keep last good copy or bundled snapshot */
      if (cache) return cache.data;
    }
  }
  return raw as Bookmark[];
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
