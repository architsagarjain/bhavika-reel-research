#!/usr/bin/env node
// Fetch one or more Instagram reels through Apify's Instagram Reel Scraper.
// Saves the raw result, the cover and the video so Claude Code can analyze them. No Instagram login is ever used.
import path from "node:path";
import { ACTORS, ApifyError, requireToken, runActor } from "./lib/apify.mjs";
import { parseReelUrl, apifyToReel } from "./lib/schema.mjs";
import { PATHS, cli, downloadTo, fmtNum, rel, writeJson } from "./lib/util.mjs";

const USAGE = `Fetch Instagram reels with Apify (needs APIFY_TOKEN in .env).

Usage:
  node scripts/apify-reel.mjs <reel url> [more urls...] [options]

Options:
  --transcript     also ask Apify for a transcript (paid add-on, about 1 to 5 cents per started minute).
                   Leave it off to transcribe for free with local Whisper: node scripts/transcribe.mjs
  --no-video       skip downloading the video (frames + local transcript need it)
  --max-usd N      cost cap for each Apify run (default 1)
  -h, --help       show this help

Writes:
  data/raw/apify-reel-<id>.json   raw Apify result
  media/<id>/cover.jpg            cover image
  media/<id>/video.mp4            the reel video

Next step: node scripts/normalize.mjs data/raw/apify-reel-<id>.json --write`;

const { flags, positionals } = cli(USAGE, { boolean: ["transcript", "no-video"], string: ["max-usd"] });
if (!positionals.length) {
  console.error(`Give at least one reel URL.\n\n${USAGE}`);
  process.exit(2);
}

const targets = [];
for (const u of positionals) {
  const parsed = parseReelUrl(u);
  if (!parsed) console.error(`skip: not a reel link: ${u}`);
  else if (parsed.platform !== "instagram") console.error(`skip: ${u} is ${parsed.platform}, and this Apify actor is Instagram only. Use: node scripts/ytdlp-reel.mjs ${u}`);
  else targets.push(parsed);
}
if (!targets.length) process.exit(2);

const token = requireToken();
const maxUsd = Number(flags["max-usd"] ?? 1);
let failed = 0;

for (const t of targets) {
  console.log(`\n${t.url}`);
  try {
    const input = { username: [t.url], resultsLimit: 1, includeTranscript: Boolean(flags.transcript) };
    const { items, status, runId } = await runActor(ACTORS.reel, input, { token, maxUsd, timeoutSec: 600 });
    const item = items.find((x) => x && !x.error && (x.shortCode || x.url));
    if (!item) {
      const why = items.find((x) => x?.errorDescription || x?.error);
      throw new Error(`Apify returned no data for this reel (run ${runId}, ${status})${why ? `: ${why.errorDescription ?? why.error}` : ""}. Is it public and still online?`);
    }
    const rawFile = path.join(PATHS.raw, `apify-reel-${t.id}.json`);
    writeJson(rawFile, items);
    console.log(`  saved  ${rel(rawFile)}`);
    const dir = path.join(PATHS.media, t.id);
    if (item.displayUrl) {
      try {
        const n = await downloadTo(item.displayUrl, path.join(dir, "cover.jpg"));
        console.log(`  saved  ${rel(path.join(dir, "cover.jpg"))} (${fmtNum(n)} bytes)`);
      } catch (e) {
        console.log(`  cover  not saved: ${e.message}`);
      }
    }
    const videoUrl = item.downloadedVideo || item.videoUrl;
    if (!flags["no-video"] && videoUrl) {
      try {
        const n = await downloadTo(videoUrl, path.join(dir, "video.mp4"));
        console.log(`  saved  ${rel(path.join(dir, "video.mp4"))} (${(n / 1e6).toFixed(1)} MB)`);
      } catch (e) {
        console.log(`  video  not saved: ${e.message}`);
      }
    } else if (!flags["no-video"]) console.log("  video  Apify returned no video URL for this reel");
    const entry = apifyToReel(items);
    const s = entry.stats;
    console.log(`  @${entry.creator || "unknown"} | ${fmtNum(s.views)} views | ${fmtNum(s.likes)} likes | ${fmtNum(s.comments)} comments | ${entry.durationSec ?? "?"}s | transcript: ${entry.transcript.length ? "from Apify" : "none (run transcribe.mjs)"}`);
    console.log(`  next   node scripts/normalize.mjs ${rel(rawFile)} --write`);
  } catch (e) {
    failed++;
    console.error(`  error  ${e instanceof ApifyError || e instanceof Error ? e.message : String(e)}`);
    if (e instanceof ApifyError && (e.status === 401 || e.status === 402)) break;
  }
}
process.exit(failed ? 1 : 0);
