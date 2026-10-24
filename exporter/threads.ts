/**
 * Thread fetcher — for each bookmarked post, open its status page in the logged-in
 * persistent profile, capture the page's own `TweetDetail` GraphQL response, and
 * extract the AUTHOR'S thread (self-reply chain through the bookmarked post).
 *
 *   tsx threads.ts --ids-file ids.txt --out threads.json [--limit N] [--delay-min 3 --delay-max 7]
 *
 * threads.json: { "<bookmarkId>": { "checked": "<iso>", "thread": [post…] | null } }
 *   thread = null  → standalone post (or unavailable); fetched, nothing to show
 *   post = { id, created_at, text, media[], links[] } in thread order (includes the bookmarked post)
 * Resumable: ids already in the out file are skipped; checkpoints every 10 posts.
 * Exit codes: 0 ok · 2 auth failure / rate-limited out · 1 other.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthError, ensureSession, jitter, launch, log, sleep, toRecord } from "./export.ts";

function arg(name: string, def = ""): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

type ThreadPost = { id: string; created_at: string; text: string; media: any[]; links: string[] };

// ── TweetDetail → author's thread ────────────────────────────────────────────
function unwrap(t: any): any {
  return t?.__typename === "TweetWithVisibilityResults" ? t.tweet : t;
}
function collectTweets(node: any, out: Map<string, any>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const x of node) collectTweets(x, out); return; }
  const r = node.tweet_results?.result;
  if (r) { const t = unwrap(r); if (t?.rest_id && t.legacy) out.set(t.rest_id, t); }
  for (const k of Object.keys(node)) if (k !== "tweet_results") collectTweets(node[k], out);
}
function linksOf(t: any): string[] {
  const urls = [...(t.legacy?.entities?.urls ?? [])];
  const es = t.note_tweet?.note_tweet_results?.result?.entity_set?.urls ?? [];
  return [...urls, ...es].map((u: any) => u.expanded_url).filter(Boolean);
}
function toPost(t: any): ThreadPost {
  const r = toRecord(t)!;
  return { id: r.id, created_at: r.created_at, text: r.full_text, media: r.media.map((m: any) => ({ type: m.type, thumb: m.thumbnail, orig: m.original })), links: linksOf(t) };
}

/** Pure: given the TweetDetail body and the bookmarked id, return the author's thread (≥2 posts) or null. */
export function extractThread(body: any, focalId: string): ThreadPost[] | null {
  const all = new Map<string, any>();
  collectTweets(body?.data?.threaded_conversation_with_injections_v2 ?? body?.data, all);
  const focal = all.get(focalId);
  if (!focal) return null;
  const author = focal.legacy.user_id_str;
  const mine = (t: any) => t.legacy.user_id_str === author;
  // up: walk to the root of the author's own self-reply chain
  let root = focal;
  for (;;) {
    const pid = root.legacy.in_reply_to_status_id_str;
    const parent = pid ? all.get(pid) : null;
    if (parent && mine(parent)) root = parent; else break;
  }
  // down: author's replies to the author's own posts, breadth-first, by time
  const chain = [root];
  const inChain = new Set([root.rest_id]);
  const children = [...all.values()].filter((t) => mine(t) && t.legacy.in_reply_to_status_id_str);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of children) {
      if (!inChain.has(c.rest_id) && inChain.has(c.legacy.in_reply_to_status_id_str)) { chain.push(c); inChain.add(c.rest_id); grew = true; }
    }
  }
  if (chain.length < 2) return null;
  chain.sort((a, b) => new Date(a.legacy.created_at).getTime() - new Date(b.legacy.created_at).getTime());
  return chain.map(toPost);
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const idsFile = arg("ids-file"), outFile = arg("out");
  const limit = Number(arg("limit", "0"));
  const dMin = Number(arg("delay-min", "3")) * 1000, dMax = Number(arg("delay-max", "7")) * 1000;
  if (!idsFile || !outFile) { console.error("usage: threads.ts --ids-file f --out threads.json [--limit N]"); process.exit(1); }

  const done: Record<string, { checked: string; thread: ThreadPost[] | null }> = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};
  let todo = readFileSync(idsFile, "utf8").split(/\s+/).filter((x) => x && !(x in done));
  if (limit) todo = todo.slice(0, limit);
  log(`threads: ${todo.length} to fetch (${Object.keys(done).length} already done)`);
  if (!todo.length) return;

  const save = () => { mkdirSync(dirname(outFile), { recursive: true }); writeFileSync(outFile + ".tmp", JSON.stringify(done)); renameSync(outFile + ".tmp", outFile); };

  const ctx = await launch();
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await ensureSession(ctx, page);
    let n = 0, found = 0, throttled = 0;
    for (const id of todo) {
      let body: any = null, status = 0;
      const wait = page.waitForResponse((r: any) => /\/i\/api\/graphql\/[^/]+\/TweetDetail/.test(r.url()), { timeout: 25_000 }).catch(() => null);
      await page.goto(`https://x.com/i/status/${id}`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
      const res = await wait;
      if (res) { status = res.status(); body = await res.json().catch(() => null); }
      if (status === 429 || (!res && (await page.locator("text=/rate limit/i").count().catch(() => 0)))) {
        if (++throttled >= 3) { save(); throw new AuthError("rate-limited by X (3x) — resume later"); }
        log(`  429 on ${id} — backing off 15 min (${throttled}/3)`);
        await sleep(15 * 60_000);
        continue; // retry later run; not marked done
      }
      if (!res) { log(`  no TweetDetail for ${id} — skipped (retry next run)`); await sleep(jitter(dMin, dMax)); continue; }
      throttled = 0;
      const thread = body ? extractThread(body, id) : null;
      done[id] = { checked: new Date().toISOString(), thread };
      if (thread) found++;
      if (++n % 10 === 0) { save(); log(`  ${n}/${todo.length} fetched, ${found} threads`); }
      await sleep(jitter(dMin, dMax));
    }
    save();
    log(`✓ threads: ${n} fetched, ${found} with threads`);
  } finally {
    await ctx.close().catch(() => {});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => {
  console.error(e instanceof AuthError ? `AUTH/RATE FAILURE: ${e.message}` : e);
  process.exit(e instanceof AuthError ? 2 : 1);
});
