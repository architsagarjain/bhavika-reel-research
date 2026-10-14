#!/usr/bin/env node
// Run your niche searches (niche.json) through Apify's Instagram Hashtag Scraper, newest reels only.
// One raw file per query + a queries.jsonl manifest, ready for scripts/outliers.mjs. No Instagram login is ever used.
import { appendFileSync } from "node:fs";
import path from "node:path";
import { ACTORS, ApifyError, requireToken, runActor } from "./lib/apify.mjs";
import { nicheQueries, slugify, toHashtag } from "./lib/schema.mjs";
import { PATHS, cli, ensureDir, loadNiche, makeStamp, rel, resolvePath, writeJson } from "./lib/util.mjs";

const PRICE_PER_RESULT_FREE = 0.0026; // Free plan rate, verified 2026-10 (paid plans pay less)

const USAGE = `Search your niche on Instagram through Apify (needs APIFY_TOKEN in .env).

Usage:
  node scripts/apify-search.mjs [options]

Options:
  --limit N          reels per query (default 10). 71 queries x 10 = up to 710 results.
  --clusters a,b     only these cluster ids from niche.json (default: all)
  --keyword          search the query as a keyword phrase instead of a hashtag ("Claude Code" instead of #claudecode)
  --max-usd N        total spend cap for this search, split across runs (default 5)
  --batch N          queries per Apify run (default 10)
  --niche <file>     niche file (default niche.json)
  --stamp <stamp>    folder stamp (default now, YYYY-MM-DD-HHmm)
  --dry-run          print the plan and cost estimate, spend nothing
  -h, --help         show this help

Writes data/raw/search-<stamp>/apify-<query>.json + queries.jsonl.
Next step: node scripts/outliers.mjs --in data/raw/search-<stamp>`;

const { flags } = cli(USAGE, { boolean: ["keyword", "dry-run"], string: ["limit", "clusters", "max-usd", "batch", "niche", "stamp"] });
const limit = Math.max(1, Math.min(200, Number.parseInt(flags.limit ?? "10", 10) || 10));
const batchSize = Math.max(1, Math.min(50, Number.parseInt(flags.batch ?? "10", 10) || 10));
const maxUsd = Math.max(0.1, Number(flags["max-usd"] ?? 5) || 5);
const niche = loadNiche(flags.niche ? resolvePath(flags.niche) : PATHS.niche);
const wanted = flags.clusters ? new Set(flags.clusters.split(",").map((s) => s.trim()).filter(Boolean)) : null;
if (wanted) {
  const known = new Set(niche.clusters.map((c) => c.id));
  const unknown = [...wanted].filter((c) => !known.has(c));
  if (unknown.length) {
    console.error(`Unknown cluster id: ${unknown.join(", ")}. niche.json has: ${[...known].join(", ")}`);
    process.exit(2);
  }
}

// One search term per query; two queries that make the same hashtag share one term.
const terms = new Map();
for (const q of nicheQueries(niche)) {
  if (wanted && !wanted.has(q.cluster)) continue;
  const term = flags.keyword ? q.query.trim() : toHashtag(q.query);
  if (!term) continue;
  const key = flags.keyword ? term.toLowerCase() : term;
  if (!terms.has(key)) terms.set(key, { term, queries: [] });
  terms.get(key).queries.push(q);
}
const list = [...terms.values()];
if (!list.length) {
  console.error("No queries to run. Check niche.json and --clusters.");
  process.exit(2);
}

const estimate = list.length * limit * PRICE_PER_RESULT_FREE;
console.log(`Apify ${flags.keyword ? "keyword" : "hashtag"} search: ${list.length} terms x ${limit} reels = up to ${list.length * limit} results.`);
console.log(`Estimated cost: up to $${estimate.toFixed(2)} on the Free plan (less on paid plans). Cap: $${maxUsd.toFixed(2)}.`);
if (flags["dry-run"]) {
  for (const t of list) console.log(`  ${flags.keyword ? t.term : `#${t.term}`}  <- ${t.queries.map((q) => `${q.query} (${q.cluster})`).join(", ")}`);
  console.log("\nDry run: nothing was spent.");
  process.exit(0);
}

const token = requireToken();
const stamp = flags.stamp ?? makeStamp();
const outDir = ensureDir(path.join(PATHS.raw, `search-${stamp}`));
const manifest = path.join(outDir, "queries.jsonl");
const batches = [];
for (let i = 0; i < list.length; i += batchSize) batches.push(list.slice(i, i + batchSize));
const perRunUsd = Math.max(0.05, Math.round((maxUsd / batches.length) * 100) / 100);

/** Which of this batch's terms produced the item (Apify reports the hashtag page or keyword it came from). */
function termOf(item, batch) {
  let raw = "";
  try {
    const u = new URL(item.inputUrl ?? "");
    raw = u.searchParams.get("q") ?? u.pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    raw = item.searchTerm ?? "";
  }
  const norm = toHashtag(decodeURIComponent(raw));
  return batch.find((t) => toHashtag(t.term) === norm) ?? null;
}

let total = 0;
let fatal = null;
async function runBatch(batch, n) {
  if (fatal) return;
  const input = { hashtags: batch.map((t) => t.term), resultsType: "reels", resultsLimit: limit, ...(flags.keyword ? { keywordSearch: true } : {}) };
  try {
    const { items, status } = await runActor(ACTORS.hashtag, input, { token, maxUsd: perRunUsd, timeoutSec: 900 });
    const byTerm = new Map(batch.map((t) => [t, []]));
    const unmatched = [];
    for (const it of items) {
      if (!it || it.error) continue;
      const t = termOf(it, batch);
      if (t) byTerm.get(t).push(it);
      else unmatched.push(it);
    }
    for (const [t, its] of byTerm) {
      const first = t.queries[0];
      const file = `apify-${slugify(first.query)}.json`;
      writeJson(path.join(outDir, file), its);
      for (const q of t.queries) appendFileSync(manifest, `${JSON.stringify({ query: q.query, cluster: q.cluster, file, page: 1, provider: "apify", [flags.keyword ? "keyword" : "hashtag"]: t.term })}\n`);
    }
    if (unmatched.length) writeJson(path.join(outDir, `apify-batch-${n}-unmatched.json`), unmatched);
    total += items.length;
    console.log(`  run ${n}/${batches.length}: ${items.length} reels (${status}) ${batch.map((t) => (flags.keyword ? t.term : `#${t.term}`)).join(" ")}`);
  } catch (e) {
    console.error(`  run ${n}/${batches.length} failed: ${e.message}`);
    if (e instanceof ApifyError && (e.status === 401 || e.status === 402)) fatal = e;
  }
}

console.log(`Writing to ${rel(outDir)}`);
const CONCURRENCY = 2;
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
    while (next < batches.length && !fatal) {
      const i = next++;
      await runBatch(batches[i], i + 1);
    }
  }),
);
if (fatal) {
  console.error(`\nStopped: ${fatal.message}`);
  process.exit(1);
}
console.log(`\nDone: ${total} reels from ${list.length} terms in ${rel(outDir)}`);
console.log(`Next: node scripts/outliers.mjs --in ${rel(outDir)} --open`);
