#!/usr/bin/env bash
# Fetch the author's full thread for every bookmark not yet checked.
# Results → $BOOKMARKS_DATA_DIR/threads.json (resumable; the site merges it at runtime).
#
#   scripts/fetch_threads.sh                  # all pending (the retro-active backfill)
#   THREADS_LIMIT=300 scripts/fetch_threads.sh   # at most 300 (what the daily sync does)
#
# Shares the X browser profile with the exporter → takes the same lock.
set -euo pipefail
cd "$(dirname "$0")/.."

DATA_DIR="${BOOKMARKS_DATA_DIR:-/data/lazrossi/bookmarks-data}"
ENRICHED="${ENRICHED_PATH:-$DATA_DIR/enriched.json}"
export X_PROFILE="${X_PROFILE:-$DATA_DIR/x-profile}"
mkdir -p "$DATA_DIR"

if [ -z "${BROWSER_LOCK_HELD:-}" ]; then
  exec 9>"$DATA_DIR/.browser.lock"
  flock -w 43200 9
fi

# pending = bookmarks with no threads.json entry, newest first
python3 - "$ENRICHED" "$DATA_DIR/threads.json" > "$DATA_DIR/thread-ids.txt" <<'PY'
import json, os, sys
enriched = json.load(open(sys.argv[1]))
done = json.load(open(sys.argv[2])) if os.path.exists(sys.argv[2]) else {}
for b in sorted(enriched, key=lambda x: x['created_at'], reverse=True):
    if b['id'] not in done:
        print(b['id'])
PY
echo "pending thread checks: $(wc -l < "$DATA_DIR/thread-ids.txt")"

[ -d exporter/node_modules ] || (cd exporter && npm install --no-audit --no-fund)
cd exporter
NODE_OPTIONS="--max-old-space-size=768 ${NODE_OPTIONS:-}" xvfb-run -a ./node_modules/.bin/tsx threads.ts --ids-file "$DATA_DIR/thread-ids.txt" \
  --out "$DATA_DIR/threads.json" ${THREADS_LIMIT:+--limit "$THREADS_LIMIT"}
