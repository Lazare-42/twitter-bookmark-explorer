import { notFound } from "next/navigation";
import { byTheme, themeCounts, THEME_LABELS } from "@/lib/data";
import FilteredTweetList from "@/components/FilteredTweetList";

export function generateStaticParams() {
  return themeCounts().map((t) => ({ theme: t.theme }));
}

export default async function ThemePage({
  params,
}: {
  params: Promise<{ theme: string }>;
}) {
  const { theme } = await params;
  const label = THEME_LABELS[theme];
  if (!label) notFound();
  const items = byTheme(theme);
  if (items.length === 0) notFound();
  return (
    <main>
      <h2 className="page-title">{label}</h2>
      <p className="page-sub">{items.length} bookmarks</p>
      <FilteredTweetList items={items} />
    </main>
  );
}
