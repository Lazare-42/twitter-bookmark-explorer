import { amazonSearchLink, purchaseLink, type Bookmark } from "@/lib/data";
import SmartLink from "./SmartLink";

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
