#!/usr/bin/env node
// Turn any provider's raw output into this kit's format: a ReelEntry skeleton (one reel) or OutlierHit[] (a search).
// Auto-detects Sandcastles, Apify, yt-dlp and bring-your-own JSON. Claude Code then fills in the analysis fields.
import { existsSync } from "node:fs";
import path from "node:path";
import {
  apifyToReel,
  compareHits,
  detectShape,
  finalizeHit,
  hitBasesFrom,
  localVideoToReel,
  measureHook,
  providerOfShape,
  sandcastlesToReel,
  validateReelEntry,
  ytdlpToReel,
} from "./lib/schema.mjs";
import { PATHS, ROOT, cli, die, loadNiche, probeDuration, readJson, rel, resolvePath, tryReadJson, writeJson } from "./lib/util.mjs";

const USAGE = `Normalize raw provider output into the kit's format.

Usage:
  node scripts/normalize.mjs <raw.json> [options]        raw file -> ReelEntry skeleton or OutlierHit[]
  node scripts/normalize.mjs --video <file.mp4> [--url <link>] [--write]   local video -> ReelEntry skeleton
  node scripts/normalize.mjs --validate <entry.json> [more.json...]       check ReelEntry files

Options:
  --provider P   auto (default) | sandcastles | apify | ytdlp | any
  --as KIND      reel | hits (default: picked from the file shape)
  --write        save the ReelEntry to library/reels/<id>.json (Claude fills in the analysis next)
  --force        with --write, replace an existing entry (its analysis is lost)
  --now ISO      reference time for hoursAgo in hits (default: now)
  --niche FILE   niche file for cluster tags (default niche.json)
  -h, --help     show this help

Recognised inputs: Sandcastles search_all_videos ({ videos: [...] }) and get_video_details, Apify dataset items,
yt-dlp info json, and your own JSON list of { url, creator, caption, views, likes, comments, postedAt, cover }.
If media/<id>/transcript.json (Whisper) or media/<id>/cover.jpg exist, the ReelEntry uses them.`;

const { flags, positionals } = cli(USAGE, {
  boolean: ["write", "force", "validate"],
  string: ["provider", "as", "now", "niche", "video", "url"],
});

// --validate: check one or more ReelEntry files.
if (flags.validate) {
  if (!positionals.length) die(`Give at least one file to validate.\n\n${USAGE}`, 2);
  let bad = 0;
  for (const f of positionals) {
    const data = tryReadJson(resolvePath(f));
    const errors = data === undefined ? ["not readable JSON"] : validateReelEntry(data);
    if (errors.length) {
      bad++;
      console.log(`INVALID  ${f}`);
      for (const e of errors) console.log(`  - ${e}`);
    } else console.log(`OK       ${f}`);
  }
  process.exit(bad ? 1 : 0);
}

const now = flags.now ? Date.parse(flags.now) : Date.now();
if (!Number.isFinite(now)) die(`--now must be an ISO date (got ${flags.now})`, 2);
const nowIso = new Date().toISOString();

/** Use local media when present: Whisper transcript (exact timings), downloaded cover, probed duration. */
function withLocalMedia(entry) {
  const dir = path.join(PATHS.media, entry.id);
  const cover = ["cover.jpg", "cover.png", "cover.webp"].map((f) => path.join(dir, f)).find((f) => existsSync(f));
  if (cover) entry.cover = path.relative(ROOT, cover).split(path.sep).join("/");
  const tFile = path.join(dir, "transcript.json");
  const t = existsSync(tFile) ? tryReadJson(tFile) : undefined;
  const segs = Array.isArray(t) ? t : Array.isArray(t?.segments) ? t.segments : null;
  if (segs?.length) {
    entry.transcript = segs.filter((s) => s && typeof s.text === "string").map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: s.text.trim() }));
    entry.source.transcriptTiming = "exact";
  }
  const video = path.join(dir, "video.mp4");
  if (entry.durationSec === null && existsSync(video)) entry.durationSec = probeDuration(video);
  return measureHook(entry);
}

function save(entry) {
  const errors = validateReelEntry(entry);
  if (errors.length) die(`The entry is not valid yet:\n  - ${errors.join("\n  - ")}`, 1);
  const file = path.join(PATHS.library, `${entry.id}.json`);
  if (existsSync(file) && !flags.force) die(`${rel(file)} already exists. Add --force to replace it (its analysis would be lost).`, 1);
  writeJson(file, entry);
  console.error(`saved ${rel(file)}`);
}

// --video: a local file with no provider data.
if (flags.video) {
  const file = resolvePath(flags.video);
  if (!existsSync(file)) die(`Video not found: ${flags.video}`, 2);
  const entry = withLocalMedia(localVideoToReel(file, { url: flags.url ?? "", durationSec: probeDuration(file), now: nowIso }));
  if (flags.write) save(entry);
  console.log(JSON.stringify(entry, null, 2));
  process.exit(0);
}

if (positionals.length !== 1) die(`Give exactly one raw JSON file.\n\n${USAGE}`, 2);
const file = resolvePath(positionals[0]);
if (!existsSync(file)) die(`File not found: ${positionals[0]}`, 2);
let raw;
try {
  raw = readJson(file);
} catch (e) {
  die(`${positionals[0]} is not valid JSON (${e.message})`, 2);
}

const shape = detectShape(raw);
const forced = flags.provider && flags.provider !== "auto" ? flags.provider : null;
if (forced && !["sandcastles", "apify", "ytdlp", "any"].includes(forced)) die(`--provider must be auto, sandcastles, apify, ytdlp or any`, 2);
if (shape === "unknown" || shape === "empty") die(`Could not recognise ${positionals[0]} (${shape}). See docs/schema.md for the shapes this kit reads.`, 1);
const provider = forced ?? providerOfShape(shape);

let as = flags.as;
if (as && !["reel", "hits"].includes(as)) die("--as must be reel or hits", 2);
if (!as) {
  if (shape === "sandcastles-search" || shape === "generic-items") as = "hits";
  else if (shape === "apify-items") as = path.basename(file).startsWith("apify-reel-") ? "reel" : "hits";
  else as = "reel";
}

if (as === "hits") {
  if (provider === "ytdlp") die("yt-dlp info is a single reel; use --as reel.", 2);
  const niche = loadNiche(flags.niche ? resolvePath(flags.niche) : PATHS.niche);
  const effectiveShape = forced === "sandcastles" ? "sandcastles-search" : forced === "apify" ? "apify-items" : forced === "any" ? "generic-items" : shape;
  const { bases, skipped } = hitBasesFrom(raw, effectiveShape);
  const usable = bases.filter((b) => b.postedAt && b.views !== null);
  const hits = usable.map((b) => finalizeHit(b, { now, niche, foundBy: [] })).sort(compareHits);
  const dropped = skipped + bases.length - usable.length;
  if (dropped) console.error(`note: ${dropped} item(s) skipped (no reel URL, not a video, or no date/views)`);
  console.log(JSON.stringify(hits, null, 2));
  process.exit(0);
}

let entry;
if (shape === "reel-entry") entry = raw;
else if (provider === "sandcastles") entry = sandcastlesToReel(raw, nowIso);
else if (provider === "apify") entry = apifyToReel(raw, nowIso);
else if (provider === "ytdlp") entry = ytdlpToReel(raw, nowIso);
else die(`Cannot build a ReelEntry from ${shape} with provider ${provider}.`, 1);
entry = withLocalMedia(entry);
if (flags.write) save(entry);
console.log(JSON.stringify(entry, null, 2));
