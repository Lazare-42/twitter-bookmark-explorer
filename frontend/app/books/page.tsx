import { aggregatedBooks, amazonSearchLink, bookRecs } from "@/lib/data";
import FilteredTweetList from "@/components/FilteredTweetList";

export default function BooksPage() {
  const books = aggregatedBooks();
  const recs = bookRecs();
  return (
    <main>
      <h2 className="page-title">📚 Books</h2>
      <p className="page-sub">
        {books.length} distinct books extracted from {recs.length} bookmarked tweets (titles read
        from text and cover photos).
      </p>

      <table className="book-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Author</th>
            <th>Mentions</th>
            <th>Source tweets</th>
          </tr>
        </thead>
        <tbody>
          {books.map((bk, i) => (
            <tr key={i}>
              <td className="title">
                <a
                  href={bk.link || amazonSearchLink(bk)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={bk.link ? "Purchase link from tweet" : "Search on amazon.fr"}
                >
                  {bk.title} <span className="buy">🛒</span>
                </a>
              </td>
              <td className="author">{bk.author || "—"}</td>
              <td className="n">{bk.count}</td>
              <td>
                {bk.tweetIds.slice(0, 5).map((id, j) => (
                  <a
                    key={id}
                    className="src"
                    href={`https://twitter.com/i/status/${id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    [{j + 1}]
                  </a>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="section-title">All book-recommendation tweets</h3>
      <FilteredTweetList items={recs} />
    </main>
  );
}
