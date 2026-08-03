"use client";

import { useMemo, useState } from "react";
import type { Bookmark } from "@/lib/data";
import TweetCard from "./TweetCard";

export default function FilteredTweetList({ items }: { items: Bookmark[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (b) =>
        b.text.toLowerCase().includes(needle) ||
        b.screen_name.toLowerCase().includes(needle) ||
        b.name.toLowerCase().includes(needle) ||
        b.summary.toLowerCase().includes(needle) ||
        b.books.some(
          (bk) =>
            bk.title.toLowerCase().includes(needle) ||
            (bk.author || "").toLowerCase().includes(needle)
        )
    );
  }, [q, items]);

  return (
    <>
      <input
        className="filter-input"
        placeholder="Filter by text, author, book…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <p className="stats">
        {filtered.length} / {items.length} bookmarks
      </p>
      <div className="tweet-list">
        {filtered.map((b) => (
          <TweetCard key={b.id} b={b} />
        ))}
      </div>
    </>
  );
}
