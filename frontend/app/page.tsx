import Link from "next/link";
import { themeCounts, bookmarks, bookRecs } from "@/lib/data";

export default function Home() {
  const themes = themeCounts();
  const nBooks = bookRecs().length;
  return (
    <main>
      <h2 className="page-title">Themes</h2>
      <p className="page-sub">
        {bookmarks.length} bookmarks, classified by AI (text + images). {nBooks} contain book
        recommendations.
      </p>
      <div className="theme-grid">
        <Link href="/books" className="theme-card books">
          <h2>📚 Books</h2>
          <span className="count">{nBooks} book recommendations</span>
        </Link>
        {themes.map((t) => (
          <Link key={t.theme} href={`/theme/${t.theme}`} className="theme-card">
            <h2>{t.label}</h2>
            <span className="count">{t.count} bookmarks</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
