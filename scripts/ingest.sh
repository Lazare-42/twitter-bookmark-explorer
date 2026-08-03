#!/usr/bin/env bash
# Incremental ingest of a new Twitter bookmarks export.
#
#   scripts/ingest.sh <export.json>
#
# Only bookmarks not already in frontend/data/enriched.json are processed:
# extract → download media → AI pass 1 (theme + books, text + images) →
# AI pass 2 (book-only sweep of unflagged) → merge → data/state.json watermark.
# Idempotent: re-running with the same export is a no-op. Per-run artifacts in
# data/runs/<timestamp>/ so runs never collide.
#
# Afterwards (deploy):
#   git add -A && git commit
#   cd ~/nixos-config && nix flake update bookmarks-lazare
#   sudo nixos-rebuild switch --flake ~/nixos-config#nixos
set -euo pipefail
cd "$(dirname "$0")/.."

export_file="${1:?usage: ingest.sh <export.json>}"
run_dir="data/runs/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$run_dir"

python3 scripts/ingest_prep.py "$export_file" "$run_dir" || {
  rc=$?
  [ $rc -eq 3 ] && { rmdir "$run_dir/batches" "$run_dir/cls" "$run_dir" 2>/dev/null || true; exit 0; }
  exit $rc
}

if [ -s "$run_dir/curl_cfg.txt" ]; then
  curl --parallel --parallel-max 12 -s --config "$run_dir/curl_cfg.txt" || true
fi

python3 scripts/ingest_batches.py "$run_dir"

run_batches() {
  local bdir="$1" cdir="$2" script="$3"
  local n total tries
  total=$(ls "$bdir" 2>/dev/null | wc -l)
  [ "$total" -eq 0 ] && return 0
  for tries in 1 2 3; do
    ls "$bdir" | sed 's/\.json$//' \
      | BATCH_DIR="$bdir" CLS_DIR="$cdir" xargs -P 6 -I{} "$script" {}
    n=$(ls "$cdir" | wc -l)
    [ "$n" -eq "$total" ] && return 0
    echo "retry: $n/$total done"
  done
  echo "ERROR: only $n/$total batches classified" >&2
  return 1
}

echo "— pass 1: theme + book classification"
run_batches "$run_dir/batches" "$run_dir/cls" scripts/classify_batch.sh

python3 scripts/ingest_merge.py pass1 "$run_dir"

echo "— pass 2: book-only sweep"
run_batches "$run_dir/batches2" "$run_dir/cls2" scripts/booksweep_batch.sh

python3 scripts/ingest_merge.py sweep "$run_dir"

echo "Done. Next: commit, then 'nix flake update bookmarks-lazare' in ~/nixos-config, then rebuild switch."
