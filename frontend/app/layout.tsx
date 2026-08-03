import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bookmarks — lazare.ai",
  description: "Twitter bookmarks, extracted by theme",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <header className="site-header">
            <h1>
              <Link href="/">📑 Bookmarks</Link>
            </h1>
            <nav className="site-nav">
              <Link href="/books">📚 Books</Link>
              <Link href="/">Themes</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
