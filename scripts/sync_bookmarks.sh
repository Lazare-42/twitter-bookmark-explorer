#!/usr/bin/env bash
# Daily bookmarks sync: log into X (stealth Chromium) → export → incremental
# ingest into the RUNTIME data file the site serves. No rebuild/redeploy needed.
#
#   scripts/sync_bookmarks.sh
#
# Env (set by the systemd unit; sensible defaults for manual runs):
#   X_USERNAME / X_PASSWORD [/ X_EMAIL / X_TOTP_SECRET]   from sops bookmarks-sync-env
#   BOOKMARKS_DATA_DIR   default /data/lazrossi/bookmarks-data (holds enriched.json + browser profile)
#   SYNC_FULL=1   scroll the whole list instead of stopping at known pages (catch-up)
# Auth trouble (exit 2 from the exporter) pings Signal.
set -euo pipefail
cd "$(dirname "$0")/.."

DATA_DIR="${BOOKMARKS_DATA_DIR:-/data/lazrossi/bookmarks-data}"
export ENRICHED_PATH="$DATA_DIR/enriched.json"
export COMPACT_PATH="$DATA_DIR/compact.json" STATE_PATH="$DATA_DIR/state.json"  # keep the git checkout clean
export X_PROFILE="${X_PROFILE:-$DATA_DIR/x-profile}"
mkdir -p "$DATA_DIR"
# one browser at a time on the shared X profile (the thread backfill takes this lock too)
exec 9>"$DATA_DIR/.browser.lock"
flock -w 43200 9
export BROWSER_LOCK_HELD=1
# first run: seed the runtime file from the snapshot bundled in the repo
[ -f "$ENRICHED_PATH" ] || cp frontend/data/enriched.json "$ENRICHED_PATH"
[ -f "$COMPACT_PATH" ] || cp data/compact.json "$COMPACT_PATH"

notify() {
  local tok="$HOME/.cache/signal-agent/arm.token"
  [ -r "$tok" ] || return 0
  curl -s -m 15 -X POST http://127.0.0.1:8116/notify -H "X-Arm-Token: $(cat "$tok")" \
    -H 'content-type: application/json' -d "$(printf '{"message":"%s"}' "$1")" >/dev/null || true
}

[ -d exporter/node_modules ] || (cd exporter && npm install --no-audit --no-fund)

export_file="$DATA_DIR/exports/export-$(date +%Y%m%d-%H%M%S).json"
mkdir -p "$DATA_DIR/exports"

# headful Chromium under a virtual display is the stealthy mode
set +e
(cd exporter && xvfb-run -a ./node_modules/.bin/tsx export.ts --out "$export_file" --known "$ENRICHED_PATH" ${SYNC_FULL:+--full})
rc=$?
set -e
if [ $rc -eq 2 ]; then
  notify "⚠️ bookmarks sync: X login failed and needs you (check journalctl --user -u bookmarks-sync). Re-run: systemctl --user start bookmarks-sync"
  exit 2
elif [ $rc -ne 0 ]; then
  notify "⚠️ bookmarks sync: export failed (exit $rc). journalctl --user -u bookmarks-sync"
  exit $rc
fi

scripts/ingest.sh "$export_file" || {
  rc=$?
  notify "⚠️ bookmarks sync: classification failed (exit $rc) — new bookmarks not merged yet, next run retries. journalctl --user -u bookmarks-sync"
  exit $rc
}

# threads for the new bookmarks (+ trickle through any backfill backlog); never fatal
THREADS_LIMIT="${THREADS_DAILY_LIMIT:-300}" scripts/fetch_threads.sh || \
  notify "⚠️ bookmarks sync: thread fetch failed/stopped early (journalctl --user -u bookmarks-sync)"
# keep only the 7 newest raw exports (each is tens of MB)
ls -1t "$DATA_DIR"/exports/export-*.json 2>/dev/null | tail -n +8 | xargs -r rm -f
echo "sync done: $(python3 -c "import json;print(len(json.load(open('$ENRICHED_PATH'))))") bookmarks in $ENRICHED_PATH"
