import type { Bookmark } from "@/lib/data";

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
          <a href={b.url} target="_blank" rel="noopener noreferrer">
            open on X ↗
          </a>
        </div>
      </div>
      <div className="tweet-text">{b.text}</div>
      {b.media.length > 0 && (
        <div className="tweet-media">
          {b.media.slice(0, 4).map((m, i) =>
            m.thumb ? (
              <a key={i} href={m.orig || m.thumb} target="_blank" rel="noopener noreferrer">
                <img src={m.thumb.replace("name=thumb", "name=small")} alt="" loading="lazy" />
              </a>
            ) : null
          )}
        </div>
      )}
      {b.books.length > 0 && (
        <div className="tweet-books">
          {b.books.map((bk, i) => (
            <a
              key={i}
              className="book-chip"
              href={`https://www.amazon.fr/s?k=${encodeURIComponent(
                [bk.title, bk.author].filter(Boolean).join(" ")
              )}&i=stripbooks`}
              target="_blank"
              rel="noopener noreferrer"
              title="Search on amazon.fr"
            >
              {bk.title}
              {bk.author ? ` — ${bk.author}` : ""} 🛒
            </a>
          ))}
        </div>
      )}
      {b.summary ? <div className="tweet-summary">{b.summary}</div> : null}
    </article>
  );
}
