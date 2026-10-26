#!/usr/bin/env node
// Offline self-test: runs every script on samples/ and checks the results. Zero network, never spends money.
// Run it after any change: node scripts/selftest.mjs (or npm run selftest). Exit 0 = all good.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as S from "./lib/schema.mjs";
import { ROOT, readJson } from "./lib/util.mjs";

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
}
const tmp = mkdtempSync(path.join(os.tmpdir(), "irt-selftest-"));
const env = { ...process.env, IRT_NO_DOTENV: "1", APIFY_TOKEN: "", IRT_CONFIG: "samples/config.example.json", IRT_NICHE: "samples/niche.example.json" };
const EX_NICHE = path.join(ROOT, "samples/niche.example.json");
function run(script, args = [], extraEnv = {}) {
  if ((script === "outliers.mjs" || script === "apify-search.mjs") && !args.includes("--help") && !args.includes("--bogus")) args = [...args, "--niche", EX_NICHE];
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { cwd: ROOT, encoding: "utf8", env: { ...env, ...extraEnv } });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const SAMPLE_NOW = "2026-10-12T06:00:00Z";

try {
  // 1. Config and niche
  const config = readJson(path.join(ROOT, "config.json"));
  check("config.json is valid JSON with a known provider", S.PROVIDERS.includes(config.provider));
  check("config.json searchProvider is sandcastles or apify", S.SEARCH_PROVIDERS.includes(config.searchProvider));
  const niche = readJson(path.join(ROOT, "samples/niche.example.json"));
  const queries = S.nicheQueries(niche);
  check("niche.json has 7 clusters", niche.clusters.length === 7);
  check("niche.json has 71 queries", queries.length === 71, `got ${queries.length}`);
  check("niche queries are unique", new Set(queries.map((q) => q.query.toLowerCase())).size === queries.length);
  check("every cluster has caption terms", niche.clusters.every((c) => Array.isArray(c.captionTerms) && c.captionTerms.length > 0));

  // 2. URL handling
  const p = S.parseReelUrl("https://www.instagram.com/reels/ABCdef123/?igsh=xyz");
  check("instagram /reels/ link -> canonical /reel/ and lowercase id", p?.url === "https://www.instagram.com/reel/ABCdef123/" && p?.id === "ig-abcdef123");
  check("instagram /p/ link parsed", S.parseReelUrl("https://instagram.com/p/XyZ_9abc/")?.id === "ig-xyz_9abc");
  check("tiktok link parsed", S.parseReelUrl("https://www.tiktok.com/@a.b/video/7400000000000000001?lang=en")?.id === "tt-7400000000000000001");
  check("youtube shorts link parsed", S.parseReelUrl("https://youtube.com/shorts/AbCdEfGhIjK?si=1")?.id === "yt-abcdefghijk");
  check("non-reel link rejected", S.parseReelUrl("https://example.com/hello") === null);
  check("url pulled out of a line with extra text", S.extractUrls("Saved https://www.instagram.com/reel/AAAAA1/ (from phone)")[0] === "https://www.instagram.com/reel/AAAAA1/");

  // 3. Numbers and dates
  check("engagement rate uses known counts only", S.engagementRate({ views: 1000, likes: 50, comments: 5, shares: null }) === 0.055);
  check("engagement rate is null without views", S.engagementRate({ views: null, likes: 5 }) === null);
  check("hidden likes (-1) become null", S.cleanCount(-1) === null);
  check("Sandcastles date without zone is UTC", S.toIso("2026-09-13T15:32:37") === "2026-09-13T15:32:37.000Z");
  check("yt-dlp unix timestamp and upload_date", S.toIso(1791280807) === "2026-10-06T10:00:07.000Z" && S.toIso("20261006") === "2026-10-06T00:00:00.000Z");
  check("suspicious rule: 230K views, 140 likes", S.isSuspicious(230000, 140) && !S.isSuspicious(19000, 10) && !S.isSuspicious(50000, 2000));
  check("hashtag from query", S.toHashtag("Claude Code") === "claudecode" && S.toHashtag("GPT-6") === "gpt6");
  check("caption terms match at word start", S.termMatches("top mcps for claude", "mcp") && !S.termMatches("pure magic", "agi") && !S.termMatches("she said", "ai") && S.termMatches("this is ai.", "ai"));

  // 4. Shape detection on every sample
  const sc = readJson(path.join(ROOT, "samples/search/sandcastles-sample.json"));
  const ap = readJson(path.join(ROOT, "samples/search/apify-sample.json"));
  const yt = readJson(path.join(ROOT, "samples/ytdlp/sample.info.json"));
  check("detects Sandcastles search", S.detectShape(sc) === "sandcastles-search");
  check("detects Apify items", S.detectShape(ap) === "apify-items");
  check("detects yt-dlp info", S.detectShape(yt) === "ytdlp-info");
  check("detects MCP-wrapped Sandcastles result", S.detectShape([{ type: "text", text: JSON.stringify(sc) }]) === "sandcastles-search");
  check("detects bring-your-own items", S.detectShape([{ url: "https://www.instagram.com/reel/AAAAA1/", views: 5000, postedAt: SAMPLE_NOW }]) === "generic-items");

  // 5. Library samples are valid ReelEntries
  const libFiles = readdirSync(path.join(ROOT, "samples/library")).filter((f) => f.endsWith(".json"));
  for (const f of libFiles) {
    const errors = S.validateReelEntry(readJson(path.join(ROOT, "samples/library", f)));
    check(`sample ${f} is a valid ReelEntry`, errors.length === 0, errors.join("; "));
  }
  const full = readJson(path.join(ROOT, "samples/library/sample-reel.json"));
  const filled = (v) => v !== null && v !== "" && !(Array.isArray(v) && !v.length);
  const allFilled = (o) => Object.values(o).every((v) => (v && typeof v === "object" && !Array.isArray(v) ? allFilled(v) : filled(v)));
  check("sample-reel.json has every field filled", allFilled(full));

  // 6. normalize.mjs
  let r = run("normalize.mjs", ["samples/ytdlp/sample.info.json"]);
  const ytEntry = r.code === 0 ? JSON.parse(r.out) : null;
  check("normalize: yt-dlp info -> valid ReelEntry", ytEntry && S.validateReelEntry(ytEntry).length === 0, r.err);
  check("normalize: yt-dlp handle from channel, views stay null", ytEntry?.creator === "sample.creator" && ytEntry?.stats.views === null && ytEntry?.source.provider === "ytdlp");
  r = run("normalize.mjs", ["samples/search/sandcastles-sample.json", "--now", SAMPLE_NOW]);
  const scHits = r.code === 0 ? JSON.parse(r.out) : [];
  check("normalize: Sandcastles search -> valid OutlierHit[]", scHits.length === 19 && scHits.every((h) => S.validateOutlierHit(h).length === 0), r.err);
  r = run("normalize.mjs", ["samples/search/apify-sample.json", "--now", SAMPLE_NOW]);
  const apHits = r.code === 0 ? JSON.parse(r.out) : [];
  check("normalize: Apify items -> hits, photo carousel skipped", apHits.length === 5 && apHits.every((h) => h.provider === "apify" && h.outlier === null && h.url.includes("/reel/")), r.err);
  check("normalize: Apify hidden likes -> null", apHits.find((h) => h.creator === "sample.hidden")?.likes === null);
  const scReel = S.sandcastlesToReel({ uuid: "u1", platform_url: "https://www.instagram.com/reel/AAAAA1/", title: "t", channel: { handle: "x" }, view_count: 1000, like_count: 10, comment_count: 1, outlier_score: 3.14, published_at: "2026-10-01T10:00:00", analysis: { spoken_hook: "Hook here", narrative_structure: { structure_sections: [{ transcript_sentences: ["Hook here.", "Then more."], start_second: 0, end_second: 4 }] } } });
  check("Sandcastles detail -> ReelEntry with transcript", S.validateReelEntry(scReel).length === 0 && scReel.transcript.length === 2 && scReel.hook.words === 2);
  const apReel = S.apifyToReel([{ shortCode: "AAAAA2", ownerUsername: "y", caption: "c", videoPlayCount: 5000, likesCount: 100, commentsCount: 5, videoDuration: 10, timestamp: SAMPLE_NOW, transcript: "One two three. Four five six." }]);
  check("Apify reel with transcript -> estimated timings", S.validateReelEntry(apReel).length === 0 && apReel.transcript.length === 2 && apReel.source.transcriptTiming === "estimated");
  r = run("normalize.mjs", ["--validate", "samples/library/sample-reel.json"]);
  check("normalize --validate passes a good entry", r.code === 0);
  const bad = path.join(tmp, "bad.json");
  writeFileSync(bad, JSON.stringify({ id: "nope" }));
  r = run("normalize.mjs", ["--validate", bad]);
  check("normalize --validate rejects a bad entry", r.code === 1 && r.out.includes("INVALID"));

  // 7. outliers.mjs on the samples
  const repDir = path.join(tmp, "reports");
  r = run("outliers.mjs", ["--in", "samples/search", "--now", SAMPLE_NOW, "--stamp", "sample", "--out", repDir]);
  check("outliers: runs on mixed Sandcastles + Apify folder", r.code === 0, r.err);
  const rep = existsSync(path.join(repDir, "sample.json")) ? readJson(path.join(repDir, "sample.json")) : { meta: {}, hits: [] };
  const { meta, hits } = rep;
  check("outliers: meta has the required fields", ["stamp", "provider", "windowHours", "queries", "rawCount", "keptCount", "generatedAt"].every((k) => k in meta));
  check("outliers: provider auto-detected per file", meta.provider === "apify+sandcastles");
  check("outliers: every hit is a valid OutlierHit", hits.length > 0 && hits.every((h) => S.validateOutlierHit(h).length === 0));
  check("outliers: 24h window kept (15+ hits, no widening)", meta.windowHours === 24 && !meta.widened && hits.every((h) => h.hoursAgo <= 24));
  check("outliers: nothing under 2,000 views", hits.every((h) => h.views >= 2000));
  check("outliers: off-topic reel dropped", !hits.some((h) => h.creator === "sample.fitness"));
  check("outliers: duplicate merged, foundBy combined, outlier kept", (() => {
    const d = hits.filter((h) => h.id === "ig-sample02rlc");
    return d.length === 1 && d[0].foundBy.includes("AI agents") && d[0].foundBy.includes("Claude Code") && d[0].outlier === 9.1 && d[0].views === 99000;
  })());
  check("outliers: suspicious flagged, not hidden", hits.some((h) => h.creator === "sample.robotics" && h.suspicious));
  check("outliers: sorted by outlier (null last), then views per hour", hits.every((h, i) => i === 0 || S.compareHits(hits[i - 1], h) <= 0) && hits[hits.length - 1].outlier === null);
  const html = existsSync(path.join(repDir, "sample.html")) ? readFileSync(path.join(repDir, "sample.html"), "utf8") : "";
  check("outliers: html report written with inlined data", html.includes('id="irt-data"') && html.includes("Open on Instagram"));

  // Widening: a folder with few fresh reels widens to 48h, never wider.
  const thin = path.join(tmp, "search-thin");
  mkdirSync(thin, { recursive: true });
  cpSync(path.join(ROOT, "samples/search/sandcastles-sample.json"), path.join(thin, "sandcastles-ai-agents-p1.json"));
  r = run("outliers.mjs", ["--in", thin, "--now", "2026-10-12T20:00:00Z", "--out", repDir]);
  const thinRep = existsSync(path.join(repDir, "thin.json")) ? readJson(path.join(repDir, "thin.json")) : { meta: {} , hits: [] };
  check("outliers: under 15 hits widens 24h -> 48h", thinRep.meta.widened === true && thinRep.meta.windowHours === 48, r.err);
  check("outliers: 48h is the ceiling", thinRep.hits.every((h) => h.hoursAgo <= 48) && !thinRep.hits.some((h) => h.creator === "sample.old"));
  check("outliers: foundBy falls back to the niche query from the file name", thinRep.hits.every((h) => h.foundBy.includes("AI agents")));
  r = run("outliers.mjs", ["--in", thin, "--hours", "200", "--now", SAMPLE_NOW, "--out", repDir, "--stamp", "wide"]);
  check("outliers: --hours above 48 is capped at 48", r.code === 0 && readJson(path.join(repDir, "wide.json")).meta.windowHours === 48);

  // XSS: a hostile caption must never become markup.
  const evil = path.join(tmp, "search-evil");
  mkdirSync(evil, { recursive: true });
  const evilData = structuredClone(sc);
  evilData.videos[0].title = '</script><script>alert(1)</script><img src=x onerror=alert(2)> AI agent';
  evilData.videos[0].thumbnail = "javascript:alert(3)";
  cpSync(path.join(ROOT, "samples/search/sandcastles-sample.json"), path.join(evil, "x.json"));
  writeFileSync(path.join(evil, "x.json"), JSON.stringify(evilData));
  run("outliers.mjs", ["--in", evil, "--now", SAMPLE_NOW, "--out", repDir, "--stamp", "evil"]);
  const evilHtml = readFileSync(path.join(repDir, "evil.html"), "utf8");
  check("report: hostile caption cannot close the script tag", !evilHtml.includes("</script><script>alert(1)") && evilHtml.includes("\\u003c/script>"));
  check("report: client renders text with textContent and allow-lists URLs", evilHtml.includes("function safeImg") && !/innerHTML\s*=/.test(evilHtml));

  // 8. build-library.mjs
  const libOut = path.join(tmp, "library.html");
  r = run("build-library.mjs", ["--dir", "samples/library", "--out", libOut]);
  const libHtml = existsSync(libOut) ? readFileSync(libOut, "utf8") : "";
  check("build-library: builds from samples", r.code === 0 && libHtml.includes('id="irt-data"') && libHtml.includes("ig-samplehook1"), r.err);
  check("build-library: local covers inlined (works from file://)", libHtml.includes("data:image/svg+xml;base64,"));
  const evilLib = path.join(tmp, "lib-evil");
  cpSync(path.join(ROOT, "samples/library"), evilLib, { recursive: true });
  const e = readJson(path.join(evilLib, "sample-reel.json"));
  e.hook.text = "<script>alert(1)</script>";
  e.caption = "</script><img src=x onerror=alert(1)>";
  writeFileSync(path.join(evilLib, "sample-reel.json"), JSON.stringify(e));
  writeFileSync(path.join(evilLib, "broken.json"), "{ not json");
  r = run("build-library.mjs", ["--dir", evilLib, "--out", path.join(tmp, "evil-lib.html")]);
  const evilLibHtml = readFileSync(path.join(tmp, "evil-lib.html"), "utf8");
  check("build-library: hostile text stays escaped", !evilLibHtml.includes("<script>alert(1)") && !evilLibHtml.includes("</script><img"));
  check("build-library: invalid entries skipped with a warning", r.code === 0 && /skip .*broken\.json/.test(r.err));

  // 9. inbox.mjs
  const doneFile = path.join(tmp, "done.txt");
  r = run("inbox.mjs", ["--file", "samples/inbox.txt", "--library", "samples/library", "--done-file", doneFile]);
  const pending = r.out.trim().split("\n").filter(Boolean);
  check("inbox: dedupes, cleans links, skips reels already in the library", pending.length === 2 && pending[0] === "https://www.instagram.com/reel/SAMPLE01rlb/" && pending[1].startsWith("https://www.tiktok.com/"), pending.join(" | "));
  run("inbox.mjs", ["--done", "https://www.instagram.com/reels/SAMPLE01rlb/?x=1", "--done-file", doneFile]);
  r = run("inbox.mjs", ["--file", "samples/inbox.txt", "--library", "samples/library", "--done-file", doneFile]);
  check("inbox: --done marks a URL processed", r.out.trim().split("\n").filter(Boolean).length === 1);
  r = run("inbox.mjs", ["--file", path.join(tmp, "missing.txt")]);
  check("inbox: missing inbox file gives a clear message", r.code === 2 && /Inbox file not found/.test(r.err));

  // 10. Setup errors are one clear line, never a stack trace or a real call
  r = run("apify-reel.mjs", ["https://www.instagram.com/reel/AAAAA1/"]);
  check("apify-reel: missing APIFY_TOKEN points to .env.example", r.code === 2 && r.err.includes(".env.example") && !/\n\s+at /.test(r.err));
  r = run("apify-search.mjs", ["--clusters", "robots", "--limit", "5"]);
  check("apify-search: missing APIFY_TOKEN points to .env.example", r.code === 2 && r.err.includes(".env.example"));
  r = run("apify-search.mjs", ["--dry-run"]);
  check("apify-search --dry-run plans 71 queries and spends nothing", r.code === 0 && /Dry run/.test(r.out) && /up to \$/.test(r.out));
  r = run("ytdlp-reel.mjs", ["https://www.instagram.com/reel/AAAAA1/"], { PATH: "/nonexistent" });
  check("ytdlp-reel: missing yt-dlp gives an install hint", r.code === 2 && /brew install yt-dlp/.test(r.err));
  const fakeVideo = path.join(tmp, "clip.mp4");
  writeFileSync(fakeVideo, "x");
  r = run("frames.mjs", [fakeVideo], { PATH: "/nonexistent" });
  check("frames: missing ffmpeg gives an install hint", r.code === 2 && /brew install ffmpeg/.test(r.err));
  r = run("transcribe.mjs", [fakeVideo], { PATH: "/nonexistent" });
  check("transcribe: missing ffmpeg/whisper gives an install hint", r.code === 2 && /install/i.test(r.err));
  for (const s of ["apify-reel.mjs", "apify-search.mjs", "ytdlp-reel.mjs", "normalize.mjs", "transcribe.mjs", "frames.mjs", "inbox.mjs", "outliers.mjs", "build-library.mjs"]) {
    const h = run(s, ["--help"]);
    if (h.code !== 0 || !h.out.includes("Usage")) check(`${s} --help`, false, h.err);
  }
  check("every script prints --help", true);
  r = run("outliers.mjs", ["--bogus"]);
  check("unknown flags are rejected", r.code === 2 && /unknown option --bogus/.test(r.err));

  // 11. Public repo hygiene: no secrets, no em dashes in the files this kit ships.
  const skip = new Set([".git", "node_modules", "media", "out", "reports", "raw"]);
  const offenders = [];
  const tokenRe = new RegExp(["apify", "_api_", "[A-Za-z0-9]{10,}"].join(""));
  const emDash = String.fromCharCode(0x2014);
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const fp = path.join(dir, name);
      if (statSync(fp).isDirectory()) walk(fp);
      else if (/\.(mjs|js|json|jsonl|md|txt|svg|html|example)$|^\.(gitignore|env\.example)$/.test(name)) {
        const text = readFileSync(fp, "utf8");
        if (tokenRe.test(text)) offenders.push(`${path.relative(ROOT, fp)} (token-like string)`);
        if (text.includes(emDash)) offenders.push(`${path.relative(ROOT, fp)} (em dash)`);
      }
    }
  })(ROOT);
  check("no token-like strings or em dashes in the repo", offenders.length === 0, offenders.join(", "));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nselftest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
