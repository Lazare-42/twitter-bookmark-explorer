/**
 * X (Twitter) bookmarks exporter — stealth Chromium (cloakbrowser), persistent
 * profile, self-healing login.
 *
 *   node_modules/.bin/tsx export.ts --out /path/export.json [--known /path/enriched.json] [--max-pages 60] [--full]
 *
 * Flow
 *  1. Open x.com/i/bookmarks with the persistent profile. Session cookie
 *     (auth_token) usually still valid → no login.
 *  2. If logged out: scripted login (username → [unusual-activity check] →
 *     password → [2FA / email code]). TOTP is computed locally when
 *     X_TOTP_SECRET is set; any other code is requested over Signal
 *     (signal-agent /ask-secret) and typed straight into the page.
 *  3. Capture the page's own `Bookmarks` GraphQL responses while scrolling, stop
 *     once a whole response page is already known (--known) or nothing new loads.
 *  4. Write records in the twitter-web-exporter shape (what ingest_prep.py reads).
 *
 * Exit codes: 0 ok · 2 auth failure (needs the human) · 1 other error.
 *
 * Env: X_USERNAME, X_PASSWORD, [X_EMAIL], [X_TOTP_SECRET], [X_PROFILE],
 *      [HEADLESS=1], [ARM_TOKEN_FILE], [SIGNAL_ASK_SECRET_URL]
 */
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER = process.env.X_USERNAME ?? "";
const PASS = process.env.X_PASSWORD ?? "";
const EMAIL = process.env.X_EMAIL ?? "";
const TOTP_SECRET = (process.env.X_TOTP_SECRET ?? "").replace(/\s+/g, "");
const PROFILE = process.env.X_PROFILE ?? join(__dirname, ".profile");
const HEADLESS = /^(1|true)$/i.test(process.env.HEADLESS ?? "");
const ARM_TOKEN_FILE = process.env.ARM_TOKEN_FILE ?? join(homedir(), ".cache/signal-agent/arm.token");
const ASK_SECRET_URL = process.env.SIGNAL_ASK_SECRET_URL ?? "http://127.0.0.1:8116/ask-secret";

function arg(name: string, def = ""): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const OUT = arg("out");
const KNOWN = arg("known");
const MAX_PAGES = Number(arg("max-pages", "60"));
const FULL = process.argv.includes("--full"); // ignore known ids: scroll to the end (catch-up)
const KNOWN_STREAK_STOP = 3; // stop after this many consecutive all-known pages
if (!OUT && process.argv[1] === fileURLToPath(import.meta.url)) { console.error("usage: export.ts --out <file.json> [--known enriched.json] [--max-pages N]"); process.exit(1); }

class AuthError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (a: number, b: number) => a + Math.random() * (b - a);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// cloakbrowser is ESM-only; import dynamically (same trick as the artnet scraper).
const dynamicImport = new Function("s", "return import(s)") as (s: string) => Promise<any>;

// On NixOS cloakbrowser's downloaded generic binary won't run; the unit pins
// CLOAKBROWSER_BINARY_PATH, but fall back to any nix-built one for manual runs.
function resolveNixChrome(): void {
  if (process.env.CLOAKBROWSER_BINARY_PATH) return;
  try {
    const p = execSync("ls -d /nix/store/*cloakbrowser-chromium*/bin/cloakbrowser-chrome 2>/dev/null | head -1", { encoding: "utf8" }).trim();
    if (p) {
      process.env.CLOAKBROWSER_BINARY_PATH = p;
      process.env.CLOAKBROWSER_AUTO_UPDATE = "0";
      process.env.CLOAKBROWSER_SKIP_CHECKSUM = "1";
    }
  } catch { /* fall back to cloakbrowser's own download */ }
}

// ── TOTP (RFC 6238, SHA1/30s/6 digits) ───────────────────────────────────────
function base32Decode(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.toUpperCase().replace(/=+$/, "")) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error("bad base32 in X_TOTP_SECRET");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

// ── code from the human, over Signal (value never logged) ────────────────────
async function askSignal(label: string, prompt: string): Promise<string> {
  const token = readFileSync(ARM_TOKEN_FILE, "utf8").trim();
  const res = await fetch(ASK_SECRET_URL, {
    method: "POST",
    headers: { "X-Arm-Token": token, "content-type": "application/json" },
    body: JSON.stringify({ label, prompt }),
    signal: AbortSignal.timeout(180_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new AuthError(`ask-secret failed: ${data.error ?? res.status}`);
  return String(data.value).trim();
}

// ── launch ───────────────────────────────────────────────────────────────────
async function launch() {
  resolveNixChrome();
  const { launchPersistentContext } = await dynamicImport("cloakbrowser");
  mkdirSync(PROFILE, { recursive: true });
  return launchPersistentContext({
    userDataDir: PROFILE, // persistent → session survives between daily runs
    headless: HEADLESS,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    humanize: true,
    args: ["--window-size=1440,900", "--no-sandbox", "--disable-setuid-sandbox", "--lang=en-US", "--accept-lang=en-US,en", "--disable-blink-features=AutomationControlled"],
    contextOptions: { ignoreHTTPSErrors: true },
  });
}

async function loggedIn(ctx: any): Promise<boolean> {
  const cookies = await ctx.cookies("https://x.com");
  return cookies.some((c: any) => c.name === "auth_token" && c.value);
}

// ── login: a small state machine over whatever X shows next ──────────────────
const SEL = {
  username: 'input[name="username_or_email"], input[autocomplete~="username"]',
  password: 'input[name="password"]',
  challenge: 'input[data-testid="ocfEnterTextTextInput"]', // unusual-activity + 2FA + email-code steps
  twofa: 'input[name="text"][inputmode="numeric"], input[data-testid="LoginVerificationCodeForm-challengeInput"]',
};
async function clickButton(page: any, names: RegExp[]): Promise<boolean> {
  for (const n of names) {
    const b = page.getByRole("button", { name: n }).first();
    if (await b.isVisible().catch(() => false)) { await b.click(); return true; }
  }
  return false;
}
async function fillAndSubmit(page: any, sel: string, value: string, button: RegExp[]) {
  const el = page.locator(sel).first();
  await el.click();
  await el.fill("");
  await el.pressSequentially(value, { delay: jitter(40, 110) });
  await sleep(jitter(400, 900));
  if (!(await clickButton(page, button))) await el.press("Enter");
}

async function login(ctx: any, page: any): Promise<void> {
  if (!USER || !PASS) throw new AuthError("logged out and X_USERNAME/X_PASSWORD not set");
  log("→ logging in");
  await page.goto("https://x.com/i/flow/login", { waitUntil: "domcontentloaded", timeout: 60_000 });
  let codeAttempts = 0, usernameDone = false, passwordDone = false;
  for (let step = 0; step < 14; step++) {
    await sleep(jitter(2200, 3500));
    if (await loggedIn(ctx)) { log("✓ logged in"); return; }
    await clickButton(page, [/^accept all cookies$/i]); // consent banner overlays the form
    const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    const inputs = await page.locator("input:visible").evaluateAll((els: any[]) => els.map((e) => `${e.name || e.type}|${e.autocomplete}|${e.getAttribute("data-testid") || ""}`)).catch(() => []);
    log(`  step ${step}: ${page.url()} inputs=[${inputs.join(", ")}] text="${body.slice(0, 140).replace(/\s+/g, " ")}"`);
    if (step === 0 || step === 13) await page.screenshot({ path: join(dirname(OUT), `login-step${step}.png`) }).catch(() => {});

    const pwVisible = await page.locator(SEL.password).first().isVisible().catch(() => false);
    if (!usernameDone && (await page.locator(SEL.username).first().isVisible().catch(() => false))) {
      await fillAndSubmit(page, SEL.username, USER, [/^(next|continue)$/i]);
      usernameDone = true;
    } else if (usernameDone && !passwordDone && pwVisible) {
      await fillAndSubmit(page, SEL.password, PASS, [/^(log in|continue|sign in)$/i]);
      passwordDone = true;
    } else if (await page.locator(SEL.challenge).first().isVisible().catch(() => false)) {
      // Distinguish by the page copy: identity re-check vs. verification code.
      const wantsCode = /verification code|confirmation code|authentication app|enter code|we sent|sent you/.test(body);
      if (wantsCode) {
        if (++codeAttempts > 2) throw new AuthError("verification code rejected twice");
        let code: string;
        if (TOTP_SECRET && /authentication app|authenticator|two-factor/.test(body) && codeAttempts === 1) {
          code = totp(TOTP_SECRET);
        } else {
          const where = /email/.test(body) ? "emailed" : /authentication app|authenticator/.test(body) ? "from your authenticator app" : "sent to you";
          code = await askSignal("X login code", `X is asking for a verification code (${where}) for the bookmarks sync. Reply with the code.`);
        }
        await fillAndSubmit(page, SEL.challenge, code, [/^next$/i, /^verify$/i, /^confirm$/i]);
      } else {
        // "Enter your phone number or username" — unusual-activity check.
        await fillAndSubmit(page, SEL.challenge, USER || EMAIL, [/^next$/i]);
      }
    } else if (await page.locator(SEL.twofa).first().isVisible().catch(() => false)) {
      const code = TOTP_SECRET ? totp(TOTP_SECRET) : await askSignal("X login code", "X 2FA code for the bookmarks sync.");
      await fillAndSubmit(page, SEL.twofa, code, [/^next$/i, /^verify$/i]);
    } else if (/suspicious|try again later|something went wrong|locked|unusual login/.test(body) && !/password/.test(body)) {
      throw new AuthError(`X blocked the login: ${body.slice(0, 160).replace(/\s+/g, " ")}`);
    } else {
      log("  (waiting for next login step)", page.url());
    }
  }
  await page.screenshot({ path: join(dirname(OUT), "login-failed.png") }).catch(() => {});
  if (!(await loggedIn(ctx))) throw new AuthError("login did not complete in 14 steps");
}

async function ensureSession(ctx: any, page: any): Promise<void> {
  await page.goto("https://x.com/i/bookmarks", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(3500);
  if ((await loggedIn(ctx)) && !/\/(i\/flow\/)?login/.test(page.url())) { log("✓ session still valid"); return; }
  await login(ctx, page);
  await page.goto("https://x.com/i/bookmarks", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(3500);
  if (!(await loggedIn(ctx))) throw new AuthError("no auth_token after login");
}

// ── GraphQL → twitter-web-exporter record ────────────────────────────────────
function parisStamp(twitterDate: string): string {
  const d = new Date(twitterDate); // "Sun Aug 02 13:58:01 +0000 2026" parses natively
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const off = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sign = off >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${sign}${hh}:${mm}`;
}

export function toRecord(t: any): any | null {
  if (t?.__typename === "TweetWithVisibilityResults") t = t.tweet;
  if (!t?.rest_id || !t.legacy) return null; // tombstone / unavailable
  const l = t.legacy;
  const u = t.core?.user_results?.result ?? {};
  const screen = u.core?.screen_name ?? u.legacy?.screen_name ?? "";
  const media = (l.extended_entities?.media ?? l.entities?.media ?? []).map((m: any) => {
    if (m.type === "photo") {
      const ext = /\.png$/i.test(m.media_url_https) ? "png" : "jpg";
      const base = m.media_url_https.replace(/\.(jpg|png)$/i, "");
      return { type: "photo", url: m.url, thumbnail: `${base}?format=${ext}&name=thumb`, original: `${base}?format=${ext}&name=orig` };
    }
    const best = (m.video_info?.variants ?? []).filter((v: any) => v.content_type === "video/mp4").sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    return { type: m.type, url: m.url, thumbnail: `${m.media_url_https}?name=thumb`, original: best?.url ?? null };
  });
  return {
    id: t.rest_id,
    created_at: parisStamp(l.created_at),
    full_text: t.note_tweet?.note_tweet_results?.result?.text ?? l.full_text,
    media,
    screen_name: screen,
    name: u.core?.name ?? u.legacy?.name ?? "",
    profile_image_url: u.avatar?.image_url ?? u.legacy?.profile_image_url_https ?? null,
    user_id: u.rest_id ?? l.user_id_str,
    in_reply_to: l.in_reply_to_status_id_str ?? null,
    retweeted_status: l.retweeted_status_result?.result?.rest_id ?? null,
    quoted_status: l.quoted_status_id_str ?? null,
    favorite_count: l.favorite_count,
    retweet_count: l.retweet_count,
    bookmark_count: l.bookmark_count,
    quote_count: l.quote_count,
    reply_count: l.reply_count,
    views_count: Number(t.views?.count ?? 0),
    bookmarked: true,
    url: `https://twitter.com/${screen}/status/${t.rest_id}`,
    metadata: t,
  };
}

function tweetsOf(body: any): any[] {
  const instr = body?.data?.bookmark_timeline_v2?.timeline?.instructions ?? [];
  const out: any[] = [];
  for (const i of instr) for (const e of i.entries ?? []) {
    const r = e?.content?.itemContent?.tweet_results?.result;
    if (r) out.push(r);
  }
  return out;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const known = new Set<string>(KNOWN && existsSync(KNOWN) ? JSON.parse(readFileSync(KNOWN, "utf8")).map((x: any) => x.id) : []);
  log(`known ids: ${known.size}`);

  const ctx = await launch();
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await ensureSession(ctx, page);

    const records = new Map<string, any>();
    let pagesSeen = 0, knownStreak = 0, allKnownPage = false;
    page.on("response", async (res: any) => {
      if (!/\/i\/api\/graphql\/[^/]+\/Bookmarks(\?|$)/.test(res.url())) return;
      try {
        const body = await res.json();
        const tweets = tweetsOf(body).map(toRecord).filter(Boolean);
        pagesSeen++;
        let fresh = 0;
        for (const r of tweets) { if (!records.has(r.id)) { records.set(r.id, r); if (!known.has(r.id)) fresh++; } }
        log(`  page ${pagesSeen}: ${tweets.length} tweets, ${fresh} new`);
        // a single known page isn't proof we're caught up (a partial earlier
        // run can leave unseen bookmarks behind it) — require a streak
        knownStreak = tweets.length && fresh === 0 ? knownStreak + 1 : 0;
        if (!FULL && knownStreak >= KNOWN_STREAK_STOP) allKnownPage = true;
      } catch { /* non-JSON / aborted */ }
    });

    // First page fires on load; reload so the listener is attached for it.
    await page.reload({ waitUntil: "domcontentloaded" });
    let idle = 0, last = -1;
    for (let i = 0; i < MAX_PAGES * 4 && !allKnownPage && idle < 8; i++) {
      await page.mouse.move(jitter(500, 900), jitter(300, 600)).catch(() => {});
      await page.mouse.wheel(0, jitter(1400, 2400));
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await sleep(jitter(1800, 3200));
      if (records.size === last) idle++; else { idle = 0; last = records.size; }
    }
    if (pagesSeen === 0) throw new AuthError("no Bookmarks API response seen (session invalid or X changed)");

    mkdirSync(dirname(OUT), { recursive: true });
    const tmp = OUT + ".tmp";
    writeFileSync(tmp, JSON.stringify([...records.values()]));
    renameSync(tmp, OUT);
    const fresh = [...records.keys()].filter((id) => !known.has(id)).length;
    log(`✓ exported ${records.size} bookmarks (${fresh} new) → ${OUT}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => {
  console.error(e instanceof AuthError ? `AUTH FAILURE: ${e.message}` : e);
  process.exit(e instanceof AuthError ? 2 : 1);
});
