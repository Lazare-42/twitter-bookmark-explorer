#!/usr/bin/env bash
# Second pass: book-only detection sweep over previously unflagged tweets.
set -u
n="$1"
in="${BATCH_DIR:-data/batches2}/${n}.json"
out="${CLS_DIR:-data/cls2}/${n}.json"
[ -s "$out" ] && exit 0

PROMPT='You are hunting for BOOK references that a first classification pass may have missed. Input: JSON array of tweets with id, text, "images" (local file paths of attached photos), and optionally "links" (URLs the tweet contained).

For EVERY tweet with image paths, use the Read tool on each image. Look carefully for: book covers, stacks/shelves of books, screenshots of book pages or Kindle/Goodreads, reading lists.
In text, look for recommended/discussed book titles (any language).

is_book=true ONLY if a specific identifiable book (or explicit reading list of books) is shown or named. General talk about reading, articles, papers, docs, or newsletters does NOT count.
For each is_book tweet, extract books: [{"title":"...","author":"..."}] (author null if unknown; read titles off covers).
If is_book and one of the tweet'"'"'s links points to WHERE THE BOOK ITSELF can be bought, read, or downloaded (bookstore, publisher catalog page, archive.org book page, goodreads), set "book_link" to that URL; articles ABOUT the book do NOT count — then null.

Output: ONLY raw JSON array, same order, one object per input tweet:
[{"id":"...","is_book":false,"books":[],"book_link":null}]
No markdown fences, no prose.'

result=$(cat "$in" | claude -p "$PROMPT" --model claude-haiku-4-5-20251001 --allowedTools "Read" --output-format text 2>/dev/null)
result=$(printf '%s' "$result" | sed -e 's/^```json//' -e 's/^```//' -e 's/```$//')
printf '%s' "$result" | python3 -c '
import json,sys
raw=sys.stdin.read()
s=raw[raw.find("["):raw.rfind("]")+1]
data=json.loads(s)
assert isinstance(data,list) and all("id" in x for x in data)
print(json.dumps(data,ensure_ascii=False))
' > "$out.tmp" 2>/dev/null && mv "$out.tmp" "$out" || { rm -f "$out.tmp"; echo "FAIL $n"; exit 1; }
echo "OK $n"
