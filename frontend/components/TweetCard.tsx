"use client";

import { useState } from "react";
import { amazonSearchLink, decodeEntities, purchaseLink, type Bookmark, type Media } from "@/lib/data";
import SmartLink from "./SmartLink";

function MediaRow({ media }: { media: Media[] }) {
  if (media.length === 0) return null;
  return (
    <div className="tweet-media">
      {media.slice(0, 4).map((m, i) =>
        m.thumb ? (
          <a key={i} href={m.orig || m.thumb} target="_blank" rel="noopener noreferrer">
            <img src={m.thumb.replace("name=thumb", "name=small")} alt="" loading="lazy" />
          </a>
        ) : null
      )}
    </div>
  );
}

// Thread view: the author's whole thread, with the bookmarked post highlighted.
// Long threads start collapsed to the opening post + the bookmarked one.
function Thread({ b }: { b: Bookmark }) {
  const posts = b.thread!;
  const focal = posts.findIndex((p) => p.id === b.id);
  const long = posts.length > 4;
  const [open, setOpen] = useState(!long);
  const shown = open ? posts.map((p, i) => ({ p, i })) : posts.map((p, i) => ({ p, i })).filter(({ i }) => i === 0 || i === focal);
  return (
    <div className="thread">
      <div className="thread-badge">
        🧵 Thread · {posts.length} posts · bookmarked #{focal + 1}
      </div>
      {shown.map(({ p, i }, k) => (
        <div key={p.id}>
          {!open && k > 0 && i > 1 && <div className="thread-gap">⋮ {i - 1} more</div>}
          <div className={"thread-post" + (i === focal ? " focal" : "")}>
            <div className="thread-n">{i + 1}/{posts.length}</div>
            <div className="tweet-text">{decodeEntities(p.text)}</div>
            <MediaRow media={p.media} />
          </div>
        </div>
      ))}
      {!open && focal < posts.length - 1 && (
        <div className="thread-gap">⋮ {posts.length - 1 - focal} more after</div>
      )}
      {long && (
        <button className="thread-toggle" onClick={() => setOpen(!open)}>
          {open ? "Collapse thread" : `Show all ${posts.length} posts`}
        </button>
      )}
    </div>
  );
}

export default function TweetCard({ b }: { b: Bookmark }) {
  const date = b.created_at.slice(0, 10);
  return (
    <article className="tweet-card">
      <div className="tweet-head">
        {b.avatar ? <img src={b.avatar} alt="" loading="lazy" /> : null}
        <div className="who">
          <span className="name">{b.name}</span>
          <span className="handle">@{b.screen_name}</span>
        </div>
        <div className="meta">
          <div>{date}</div>
          <SmartLink href={b.url}>open on X ↗</SmartLink>
        </div>
      </div>
      {b.thread ? (
        <Thread b={b} />
      ) : (
        <>
          <div className="tweet-text">{decodeEntities(b.text)}</div>
          <MediaRow media={b.media} />
        </>
      )}
      {b.books.length > 0 && (
        <div className="tweet-books">
          {b.books.map((bk, i) => (
            <SmartLink
              key={i}
              className="book-chip"
              href={purchaseLink(b) || amazonSearchLink(bk)}
              title={purchaseLink(b) ? "Purchase link from tweet" : "Search on amazon.fr"}
            >
              {bk.title}
              {bk.author ? ` — ${bk.author}` : ""} 🛒
            </SmartLink>
          ))}
        </div>
      )}
      {b.summary ? <div className="tweet-summary">{b.summary}</div> : null}
    </article>
  );
}
