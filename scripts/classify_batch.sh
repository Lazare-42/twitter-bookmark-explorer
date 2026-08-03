#!/usr/bin/env bash
# Classify one batch file with headless claude (haiku, multimodal via Read).
set -u
n="$1"
in="data/batches/${n}.json"
out="data/cls/${n}.json"
[ -s "$out" ] && exit 0

PROMPT='You classify Twitter bookmarks into themes. Input: a JSON array of tweets, each with id, author, text, and "images" (local file paths of the tweet'"'"'s attached photos).

For EVERY tweet that has image paths, use the Read tool to look at each image — images often contain the real content (book covers, charts, screenshots, memes).

Themes (pick exactly ONE primary per tweet): ai, dev, investing, business, geopolitics, france, health, culture, humor, career, travel, science, books, other.
- "books" as primary theme = tweet is mainly about books/reading.
- Separately, is_book=true whenever the tweet recommends, praises, or shows any specific book(s) — including a photo of a book cover or a stack of books — even if the primary theme is something else.
- If is_book, extract books: [{"title":"...","author":"..."}] with the author null when unknown. Read titles off the covers in images.
- Also give each tweet a "summary": one short sentence (max 15 words, same language as tweet) saying what it is.

Output: ONLY a raw JSON array, one object per input tweet, same order:
[{"id":"...","theme":"...","is_book":false,"books":[],"summary":"..."}]
No markdown fences, no prose.'

result=$(cat "$in" | claude -p "$PROMPT" --model claude-haiku-4-5-20251001 --allowedTools "Read" --output-format text 2>/dev/null)
# strip possible fences
result=$(printf '%s' "$result" | sed -e 's/^```json//' -e 's/^```//' -e 's/```$//')
printf '%s' "$result" | python3 -c '
import json,sys
raw=sys.stdin.read()
s=raw[raw.find("["):raw.rfind("]")+1]
data=json.loads(s)
assert isinstance(data,list) and all("id" in x and "theme" in x for x in data)
print(json.dumps(data,ensure_ascii=False))
' > "$out.tmp" 2>/dev/null && mv "$out.tmp" "$out" || { rm -f "$out.tmp"; echo "FAIL $n"; exit 1; }
echo "OK $n"
