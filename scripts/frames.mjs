#!/usr/bin/env node
// Turn a reel into a few contact sheets (5 x 4 frames each) so Claude Code can "watch" it by reading 1 to 3 images
// instead of 60 separate frames. Each tile is one moment; this script prints which second every tile shows.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { FFMPEG_HINT, cli, die, ensureDir, mediaDirFor, probeDuration, rel, resolvePath, which, writeJson } from "./lib/util.mjs";

const USAGE = `Make contact sheets from a video (needs ffmpeg).

Usage:
  node scripts/frames.mjs <video.mp4> [options]

Options:
  --fps N        frames per second to sample (default 1; use 2 for fast-cut reels)
  --cols N       tiles per row (default 5)
  --rows N       rows per sheet (default 4)
  --width N      width of each tile in pixels (default 270)
  --out DIR      output folder (default media/<id>/frames)
  -h, --help     show this help

Output: media/<id>/frames/contact-01.jpg, contact-02.jpg, ... and index.json.
Tiles read left to right, top to bottom. Tile n on sheet k shows second ((k-1) * cols * rows + n - 1) / fps.`;

const { flags, positionals } = cli(USAGE, { string: ["fps", "cols", "rows", "width", "out"] });
if (positionals.length !== 1) die(`Give one video file.\n\n${USAGE}`, 2);
const video = resolvePath(positionals[0]);
if (!existsSync(video)) die(`Video not found: ${positionals[0]}`, 2);
if (!which("ffmpeg")) die(FFMPEG_HINT, 2);

const num = (v, d, min, max) => {
  const n = Number(v ?? d);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const fps = num(flags.fps, 1, 0.1, 10);
const cols = Math.round(num(flags.cols, 5, 1, 10));
const rows = Math.round(num(flags.rows, 4, 1, 10));
const width = Math.round(num(flags.width, 270, 80, 720));
const perSheet = cols * rows;
const outDir = ensureDir(flags.out ? resolvePath(flags.out) : path.join(mediaDirFor(video), "frames"));
for (const f of readdirSync(outDir)) if (/^contact-\d+\.jpg$/.test(f)) rmSync(path.join(outDir, f));

const duration = probeDuration(video);
if (duration && duration * fps > perSheet * 8) console.log(`note: ${Math.ceil(duration * fps)} frames at ${fps} fps. Consider --fps ${Math.max(0.2, Math.floor((perSheet * 4) / duration * 10) / 10)} for fewer sheets.`);

const vf = `fps=${fps},scale=${width}:-2,tile=${cols}x${rows}:padding=4:margin=4`;
const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", vf, "-q:v", "3", path.join(outDir, "contact-%02d.jpg")], { encoding: "utf8" });
if (r.status !== 0) die(`ffmpeg failed: ${(r.stderr || "").trim().split("\n").pop()}`, 1);

const sheets = readdirSync(outDir).filter((f) => /^contact-\d+\.jpg$/.test(f)).sort();
if (!sheets.length) die("ffmpeg made no frames. Is this a video file?", 1);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const index = { video: rel(video), fps, cols, rows, tileWidth: width, durationSec: duration, sheets: [] };
console.log(`${sheets.length} contact sheet(s) in ${rel(outDir)} (${cols}x${rows} tiles, 1 tile = ${1 / fps}s)`);
sheets.forEach((file, k) => {
  const from = (k * perSheet) / fps;
  const toRaw = ((k + 1) * perSheet) / fps;
  const to = duration ? Math.min(duration, toRaw) : toRaw;
  index.sheets.push({ file, from: Math.round(from * 100) / 100, to: Math.round(to * 100) / 100 });
  console.log(`  ${file}  ${mmss(from)} to ${mmss(to)}  (tile 1 = ${mmss(from)}, each next tile +${1 / fps}s)`);
});
writeJson(path.join(outDir, "index.json"), index);
console.log(`Read the sheets with Claude Code, e.g. "look at ${rel(path.join(outDir, sheets[0]))}".`);
