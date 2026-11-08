# twitter-bookmark-explorer

Turn a pile of X (Twitter) bookmarks into a browsable, searchable site,
organized by theme and kept up to date automatically.

- **Daily sync, no manual export.** A stealth Chromium logs into your X account,
  scrolls your bookmarks and captures them.
- **AI classification.** Each new bookmark gets a theme (AI, dev, investing,
  books, …), a one-line summary and, when relevant, the books it mentions.
  Images are read too: book covers, charts and screenshots count.
- **Whole threads, not just one post.** If you bookmarked post 5 of a 13-post
  thread, you see all 13, with your post highlighted.
- **Book list.** Every book recommended across your bookmarks, deduplicated and
  ranked by how often it comes up, with purchase or search links.
- **No rebuild per update.** The site reads a data file at runtime, so new
  bookmarks show up as soon as the sync writes them.

Your bookmarks never go into this repository. All data lives in a separate
directory at runtime (see [Data](#data)).

## How it works

```
                 daily timer
                      │
          scripts/sync_bookmarks.sh
                      │
   ┌──────────────────┼────────────────────────┐
   ▼                  ▼                        ▼
exporter/export.ts   scripts/ingest.sh         exporter/threads.ts
log in, scroll       new bookmarks only:       open each new bookmark,
bookmarks, capture   download media →          keep the author's own
Bookmarks GraphQL    pass 1: theme + books →   reply chain through it
                     pass 2: book sweep →
                     merge (atomic)
   │                  │                        │
   └──► export.json   └──► enriched.json       └──► threads.json
                               │                        │
                               └──── frontend (Next.js) ┘
                                     re-reads on mtime change
```

### Exporter (`exporter/`)

- `export.ts` drives [CloakBrowser](https://www.npmjs.com/package/cloakbrowser),
  a patched Chromium, headful under `xvfb`, with a persistent profile, so the X
  session survives between runs.
- If the session has expired, it logs in with your credentials. It handles X's
  single-page login, the cookie banner and TOTP 2FA (from `X_TOTP_SECRET`).
- It scrolls the bookmarks page and records the `Bookmarks` GraphQL responses
  the page itself makes. Scrolling stops after 3 consecutive pages with no new
  bookmark. `--full` scrolls to the end.
- On failure it saves a screenshot at each login step, next to the export. Exit
  code `2` means the login needs a human.
- `threads.ts` opens `x.com/i/status/<id>` for each bookmark not checked yet and
  captures `TweetDetail`. It keeps the author's self-reply chain, from the root
  through every reply the author added below it.
  - Paced at 3–7 s per post, with a 15 min back-off on HTTP 429.
  - Resumable: it checkpoints every 10 posts.

### Ingest (`scripts/`)

- `ingest.sh <export.json>` diffs the export against `enriched.json` and
  processes only new bookmarks:
  - `ingest_prep.py` extracts the bookmarks and downloads their images.
  - `classify_batch.sh` (pass 1) classifies them with headless
    [Claude Code](https://claude.com/claude-code) (`claude -p`, Haiku), which
    reads the images through its `Read` tool.
  - `booksweep_batch.sh` (pass 2) re-checks bookmarks pass 1 didn't flag, to
    catch book mentions it missed.
  - `ingest_merge.py` merges the results.
- Re-running on the same export does nothing new. Failed batches are retried 3
  times. Each run keeps its intermediate files in `data/runs/<timestamp>/`.
- `fetch_threads.sh` lists the bookmarks with no thread check yet, newest first,
  and runs `threads.ts` on them.
- `sync_bookmarks.sh` runs export → ingest → threads. It holds a `flock` on the
  shared browser profile so two browsers never run at once. It can send a
  notification when something needs attention.

### Frontend (`frontend/`)

- Next.js 15 (App Router), built as a standalone server.
- Pages: home (themes with counts), `/theme/<name>`, and `/books`.
- Client-side filtering searches thread text too.
- `lib/store.ts` reads `BOOKMARKS_DATA` and `BOOKMARKS_THREADS` and caches them
  by mtime.
- Optional HTTP basic auth: set `BASIC_AUTH_PASSWORD` and, optionally,
  `BASIC_AUTH_USER`.

## Requirements

- Node 22, Python 3, `curl`, `xvfb-run`, `flock`
- [Claude Code](https://claude.com/claude-code) logged in. The classification
  passes shell out to `claude -p`, so they run on your Claude subscription or
  API key.
- An X account. Unofficial automation of your own account may break when X
  changes its web app, and may go against X's terms. Use at your own risk.

## Running it

```bash
# 1. Frontend
cd frontend && npm install
BOOKMARKS_DATA=/path/to/data/enriched.json \
BOOKMARKS_THREADS=/path/to/data/threads.json npm run dev    # http://localhost:3220

# 2. Sync (export → classify → threads)
cd exporter && npm install && cd ..
export X_USERNAME=… X_PASSWORD=…          # optional: X_EMAIL, X_TOTP_SECRET
export BOOKMARKS_DATA_DIR=/path/to/data
scripts/sync_bookmarks.sh                 # SYNC_FULL=1 for the first, full scroll
```

The first run starts from an empty dataset and fills it from your export. You
can also ingest an export you made yourself, in the
[twitter-web-exporter](https://github.com/prinsss/twitter-web-exporter) JSON
format:

```bash
ENRICHED_PATH=/path/to/data/enriched.json scripts/ingest.sh export.json
```

### Environment

| Variable | Used by | Meaning |
|---|---|---|
| `X_USERNAME`, `X_PASSWORD` | exporter | X login |
| `X_EMAIL` | exporter | answers X's "confirm your email" challenge |
| `X_TOTP_SECRET` | exporter | base32 TOTP secret, for automatic 2FA |
| `BOOKMARKS_DATA_DIR` | sync | data directory (enriched.json, threads.json, browser profile, exports) |
| `SYNC_FULL=1` | sync | scroll the whole bookmark list |
| `THREADS_DAILY_LIMIT` | sync | maximum thread fetches per sync (default 300) |
| `ENRICHED_PATH`, `COMPACT_PATH`, `STATE_PATH` | ingest | override individual data files |
| `CLOAKBROWSER_BINARY_PATH` | exporter | use a pre-installed CloakBrowser Chromium |
| `BOOKMARKS_DATA`, `BOOKMARKS_THREADS` | frontend | data files to serve |
| `BASIC_AUTH_PASSWORD`, `BASIC_AUTH_USER` | frontend | enable basic auth |

## Deploying (NixOS)

`flake.nix` packages the frontend (`packages.<system>.bookmarks-lazare`, plus an
overlay). The author runs it as a systemd user service, with the sync on a
daily timer: a oneshot unit that runs `scripts/sync_bookmarks.sh` from a
checkout, with secrets coming from sops. No such module is published here, but
any timer that runs `sync_bookmarks.sh` with the environment above works.

## Data

Everything personal stays out of git. `data/`, `frontend/data/` and raw exports
are ignored. At runtime the data directory holds:

- `enriched.json`: bookmarks with theme, summary, books and media
- `threads.json`: `{ "<bookmark id>": { checked, thread | null } }`
- `compact.json`, `state.json`: ingest bookkeeping
- `x-profile/`: the browser profile. It contains your X session cookies, so
  treat it like a password.
- `exports/`: the 7 newest raw exports, plus login screenshots
