#!/usr/bin/env node
// Fetch public reels / shorts with yt-dlp (free, open source): Instagram, TikTok, YouTube Shorts.
// Never uses your browser cookies or a login. If a platform blocks the download, it says so and suggests another provider.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { parseReelUrl, ytdlpToReel } from "./lib/schema.mjs";
import { FFMPEG_HINT, PATHS, cli, ensureDir, fmtNum, probeDuration, readJson, rel, which, writeJson } from "./lib/util.mjs";

const USAGE = `Fetch public reels with yt-dlp (free). Instagram, TikTok and YouTube Shorts.

Usage:
  node scripts/ytdlp-reel.mjs <url> [more urls...] [options]

Options:
  --no-video     only fetch the info and cover, skip the video
  -h, --help     show this help

Writes:
  data/raw/ytdlp-<id>.json   yt-dlp info (caption, likes, comments, date; Instagram usually hides views)
  media/<id>/video.mp4       the video (for frames and the Whisper transcript)
  media/<id>/cover.jpg       the cover

Next steps:
  node scripts/transcribe.mjs media/<id>/video.mp4
  node scripts/frames.mjs media/<id>/video.mp4
  node scripts/normalize.mjs data/raw/ytdlp-<id>.json --write

Do not pass your browser cookies to yt-dlp. It can put your account at risk, and this kit never needs them.`;

const { flags, positionals } = cli(USAGE, { boolean: ["no-video"] });
if (!positionals.length) {
  console.error(`Give at least one URL.\n\n${USAGE}`);
  process.exit(2);
}
if (!which("yt-dlp")) {
  console.error("\nyt-dlp is not installed. Install it: macOS `brew install yt-dlp`, anywhere with Python `pipx install yt-dlp` (or `pip install -U yt-dlp`). Then run this again.\n");
  process.exit(2);
}
const hasFfmpeg = Boolean(which("ffmpeg"));
if (!hasFfmpeg) console.log(`note: ${FFMPEG_HINT} Without it the cover may stay .webp and some videos cannot be merged to mp4.`);

const BLOCKED = /login required|log in|rate[- ]?limit|HTTP Error 429|HTTP Error 401|HTTP Error 403|not available|Restricted|private|checkpoint|Please wait a few minutes/i;
const STRIP = ["formats", "requested_formats", "requested_downloads", "requested_subtitles", "http_headers", "thumbnails", "automatic_captions", "subtitles", "comments", "_format_sort_fields", "heatmap", "cookies"];

function run(args) {
  return new Promise((resolve) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "inherit", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d;
      process.stderr.write(d);
    });
    child.on("error", (e) => resolve({ code: 1, err: e.message }));
    child.on("close", (code) => resolve({ code, err }));
  });
}

function moveInto(src, dest) {
  if (existsSync(dest)) rmSync(dest, { force: true, recursive: true });
  renameSync(src, dest);
}

let failed = 0;
for (const url of positionals) {
  const parsed = parseReelUrl(url);
  if (!parsed) {
    console.error(`skip: not an Instagram, TikTok or YouTube Shorts link: ${url}`);
    failed++;
    continue;
  }
  console.log(`\n${parsed.url}`);
  const tmp = ensureDir(path.join(PATHS.media, `.incoming-${process.pid}-${Date.now()}`));
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout", "30",
    "--retries", "3",
    "--write-info-json",
    "--write-thumbnail",
    ...(hasFfmpeg ? ["--convert-thumbnails", "jpg", "--merge-output-format", "mp4"] : []),
    "-f", hasFfmpeg ? "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b" : "b[ext=mp4]/b",
    "-o", path.join(tmp, "video.%(ext)s"),
    ...(flags["no-video"] ? ["--skip-download"] : []),
    parsed.short ? url : parsed.url,
  ];
  const { code, err } = await run(args);
  const files = existsSync(tmp) ? readdirSync(tmp) : [];
  const infoName = files.find((f) => f.endsWith(".info.json"));
  if (code !== 0 || !infoName) {
    failed++;
    rmSync(tmp, { recursive: true, force: true });
    if (BLOCKED.test(err)) {
      console.error(`  blocked: ${parsed.platform} would not hand this reel to yt-dlp (it wants a login or is rate limiting).`);
      console.error("  Try again later, or use another provider for this reel: Sandcastles or Apify (see providers/). Do not add your browser cookies.");
    } else if (/Unsupported URL/i.test(err)) console.error("  yt-dlp does not support this URL.");
    else if (/ffmpeg|ffprobe/i.test(err)) console.error(`  ${FFMPEG_HINT}`);
    else console.error(`  yt-dlp failed${err.trim() ? `: ${err.trim().split("\n").pop()}` : ` (exit ${code})`}. Updating often fixes it: brew upgrade yt-dlp, or pipx upgrade yt-dlp.`);
    continue;
  }
  const info = readJson(path.join(tmp, infoName));
  const entry = ytdlpToReel(info);
  const id = entry.id;
  const dir = ensureDir(path.join(PATHS.media, id));
  const saved = [];
  for (const f of files) {
    if (f === infoName || f.endsWith(".part") || f.endsWith(".ytdl")) continue;
    const ext = path.extname(f).toLowerCase();
    const isImage = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
    const target = isImage ? `cover${ext === ".jpeg" ? ".jpg" : ext}` : `video${ext}`;
    moveInto(path.join(tmp, f), path.join(dir, target));
    saved.push(target);
  }
  rmSync(tmp, { recursive: true, force: true });
  for (const k of STRIP) delete info[k];
  const videoName = saved.find((f) => f.startsWith("video."));
  if (!(typeof info.duration === "number") && videoName) {
    const d = probeDuration(path.join(dir, videoName));
    if (d) info.duration = d;
  }
  const rawFile = path.join(PATHS.raw, `ytdlp-${id}.json`);
  writeJson(rawFile, info);
  console.log(`  saved  ${rel(rawFile)}`);
  for (const f of saved) console.log(`  saved  ${rel(path.join(dir, f))}`);
  const filled = ytdlpToReel(info);
  const s = filled.stats;
  console.log(`  @${filled.creator || "unknown"} | views ${s.views === null ? "hidden" : fmtNum(s.views)} | ${fmtNum(s.likes)} likes | ${fmtNum(s.comments)} comments | ${filled.durationSec ?? "?"}s`);
  if (videoName) {
    console.log(`  next   node scripts/transcribe.mjs ${rel(path.join(dir, videoName))}`);
    console.log(`         node scripts/frames.mjs ${rel(path.join(dir, videoName))}`);
  }
  console.log(`         node scripts/normalize.mjs ${rel(rawFile)} --write`);
}
process.exit(failed ? 1 : 0);
