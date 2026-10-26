#!/usr/bin/env node
// Pull the latest reels from every creator on the watchlist (niche.json "watchlist") through Apify's Instagram Reel
// Scraper. Writes one raw file per creator into a search folder, so scripts/outliers.mjs can score each reel against
// that creator's own median views (a real outlier score). No Instagram login is ever used.
import { appendFileSync } from "node:fs";
import path from "node:path";
import { ACTORS, requireToken, runActor } from "./lib/apify.mjs";
import { slugify } from "./lib/schema.mjs";
import { PATHS, cli, ensureDir, loadNiche, makeStamp, rel, resolvePath, writeJson } from "./lib/util.mjs";

const PRICE_PER_RESULT_FREE = 0.0026; // Free plan rate, verified 2026-10 (paid plans pay less)

const USAGE = `Pull the latest reels from your watchlist creators through Apify (needs APIFY_TOKEN).

Usage:
  node scripts/apify-creators.mjs [options]

Options:
  --limit N          latest reels per creator (default 12; 5+ are needed for an outlier score)
  --only a,b         only these handles (default: every handle in niche.json "watchlist")
  --max-usd N        total spend cap for this pull (default 2)
  --niche <file>     niche file (default niche.json)
  --stamp <stamp>    folder stamp (default now, YYYY-MM-DD-HHmm); reuse a search stamp to mix with hashtag results
  --dry-run          print the plan and cost estimate, spend nothing
  -h, --help         show this help

Writes data/raw/search-<stamp>/apify-creator-<handle>.json + queries.jsonl.
Next step: node scripts/outliers.mjs --in data/raw/search-<stamp>`;

const { flags } = cli(USAGE, { boolean: ["dry-run"], string: ["limit", "only", "max-usd", "niche", "stamp"] });
const limit = Math.max(1, Math.min(50, Number.parseInt(flags.limit ?? "12", 10) || 12));
const maxUsd = Math.max(0.1, Number(flags["max-usd"] ?? 2) || 2);
const niche = loadNiche(flags.niche ? resolvePath(flags.niche) : PATHS.niche);
const clean = (h) => String(h ?? "").trim().replace(/^@/, "").toLowerCase();
let handles = [...new Set((niche.watchlist ?? []).map(clean).filter(Boolean))];
if (flags.only) handles = [...new Set(flags.only.split(",").map(clean).filter(Boolean))];
if (!handles.length) {
  console.error('No creators to pull. Add handles to "watchlist" in niche.json, or pass --only handle1,handle2.');
  process.exit(2);
}

const estimate = handles.length * limit * PRICE_PER_RESULT_FREE + 0.001;
console.log(`Apify creator pull: ${handles.length} creators x ${limit} reels = up to ${handles.length * limit} results.`);
console.log(`Estimated cost: up to $${estimate.toFixed(2)} on the Free plan (less on paid plans). Cap: $${maxUsd.toFixed(2)}.`);
if (flags["dry-run"]) {
  for (const h of handles) console.log(`  @${h}`);
  console.log("\nDry run: nothing was spent.");
  process.exit(0);
}

const token = requireToken();
const stamp = flags.stamp ?? makeStamp();
const outDir = ensureDir(path.join(PATHS.raw, `search-${stamp}`));
const manifest = path.join(outDir, "queries.jsonl");
console.log(`Writing to ${rel(outDir)}`);
try {
  const input = { username: handles, resultsLimit: limit };
  const { items, status } = await runActor(ACTORS.reel, input, { token, maxUsd, timeoutSec: 900 });
  const byHandle = new Map(handles.map((h) => [h, []]));
  for (const it of items) {
    if (!it || it.error) continue;
    const h = clean(it.ownerUsername);
    if (byHandle.has(h)) byHandle.get(h).push(it);
  }
  for (const [h, its] of byHandle) {
    const file = `apify-creator-${slugify(h)}.json`;
    writeJson(path.join(outDir, file), its);
    appendFileSync(manifest, `${JSON.stringify({ query: `@${h}`, cluster: "watchlist", file, page: 1, provider: "apify", creator: h })}\n`);
    console.log(`  @${h}: ${its.length} reels`);
  }
  console.log(`\nDone: ${items.length} reels (${status}) in ${rel(outDir)}`);
  console.log(`Next: node scripts/outliers.mjs --in ${rel(outDir)} --open`);
} catch (e) {
  console.error(`Stopped: ${e.message}`);
  process.exit(1);
}
