#!/usr/bin/env node
// Transcribe a reel locally with Whisper (free, private, nothing leaves your machine).
// Uses whisper.cpp (`whisper-cli`) when a model file is found, otherwise OpenAI's open source `whisper` command.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FFMPEG_HINT, ROOT, cli, die, mediaDirFor, readJson, rel, resolvePath, which, writeJson } from "./lib/util.mjs";

const USAGE = `Transcribe a video locally with Whisper.

Usage:
  node scripts/transcribe.mjs <video.mp4> [options]

Options:
  --engine E     auto (default) | whisper-cpp | whisper
  --model M      whisper: model name (default base). whisper-cpp: a ggml-*.bin path or a name like base, small
  --language L   language code like en, es, de (default: auto detect)
  --out FILE     output file (default media/<id>/transcript.json)
  -h, --help     show this help

Output: [{ "start": 0.0, "end": 2.1, "text": "..." }, ...]

Install one Whisper (plus ffmpeg):
  whisper.cpp (fast):  macOS brew install whisper-cpp, then download a model, e.g.
                       mkdir -p ~/.cache/whisper-cpp && curl -L -o ~/.cache/whisper-cpp/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
  openai-whisper:      pipx install openai-whisper   (downloads its model on first run)

Where whisper.cpp models are looked for (first match wins, files named ggml-*.bin):
  --model /path/to/ggml-base.bin, then the WHISPER_CPP_MODEL environment variable, then
  ~/.cache/whisper-cpp/  ~/.cache/whisper.cpp/  ./models/ (in this repo)
  /opt/homebrew/share/whisper-cpp/  /usr/local/share/whisper-cpp/  /usr/share/whisper-cpp/
  Preferred order: base, small, medium, large, tiny (English-only .en models are skipped for --language other than en).`;

const { flags, positionals } = cli(USAGE, { string: ["engine", "model", "language", "out"] });
if (positionals.length !== 1) die(`Give one video file.\n\n${USAGE}`, 2);
const video = resolvePath(positionals[0]);
if (!existsSync(video)) die(`Video not found: ${positionals[0]}`, 2);
if (!which("ffmpeg")) die(FFMPEG_HINT, 2);

const engineFlag = flags.engine ?? "auto";
if (!["auto", "whisper-cpp", "whisper"].includes(engineFlag)) die("--engine must be auto, whisper-cpp or whisper", 2);
const language = flags.language && flags.language !== "auto" ? flags.language : null;
const cppBin = which("whisper-cli") ?? which("whisper-cpp");
const pyBin = which("whisper");

/** Find a whisper.cpp ggml model: --model path, WHISPER_CPP_MODEL, or the usual folders. */
function findCppModel() {
  const m = flags.model;
  if (m && /\.bin$/i.test(m)) return existsSync(resolvePath(m)) ? resolvePath(m) : null;
  if (process.env.WHISPER_CPP_MODEL && existsSync(resolvePath(process.env.WHISPER_CPP_MODEL))) return resolvePath(process.env.WHISPER_CPP_MODEL);
  const dirs = [
    path.join(os.homedir(), ".cache", "whisper-cpp"),
    path.join(os.homedir(), ".cache", "whisper.cpp"),
    path.join(ROOT, "models"),
    "/opt/homebrew/share/whisper-cpp",
    "/usr/local/share/whisper-cpp",
    "/usr/share/whisper-cpp",
  ];
  const found = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (/^ggml-.*\.bin$/i.test(f) && !/test/i.test(f)) found.push(path.join(d, f));
  }
  const english = !language || language === "en";
  const usable = found.filter((f) => english || !/\.en\.bin$/i.test(f));
  const order = m ? [m] : ["base", "small", "medium", "large", "tiny"];
  for (const name of order) {
    const hit = usable.find((f) => path.basename(f).toLowerCase().startsWith(`ggml-${name.toLowerCase()}`));
    if (hit) return hit;
  }
  return usable[0] ?? null;
}

const cppModel = cppBin ? findCppModel() : null;
let engine = engineFlag;
if (engine === "auto") engine = cppBin && cppModel ? "whisper-cpp" : pyBin ? "whisper" : cppBin ? "whisper-cpp" : null;
if (!engine) die(`No local Whisper found. Install whisper.cpp (brew install whisper-cpp) or openai-whisper (pipx install openai-whisper). Run with --help for the model download line.`, 2);
if (engine === "whisper-cpp" && !cppBin) die("whisper.cpp is not installed. macOS: brew install whisper-cpp", 2);
if (engine === "whisper-cpp" && !cppModel) die("whisper.cpp needs a model file. Download one (see --help) to ~/.cache/whisper-cpp/ or pass --model /path/to/ggml-base.bin", 2);
if (engine === "whisper" && !pyBin) die("openai-whisper is not installed. Install it: pipx install openai-whisper", 2);

const out = flags.out ? resolvePath(flags.out) : path.join(mediaDirFor(video), "transcript.json");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reel-transcribe-"));
const round = (n) => Math.round(n * 100) / 100;
let segments = [];

try {
  if (engine === "whisper-cpp") {
    console.log(`whisper.cpp with ${path.basename(cppModel)} ...`);
    const wav = path.join(tmp, "audio.wav");
    const ff = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", video, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { encoding: "utf8" });
    if (ff.status !== 0) die(`ffmpeg could not read the audio: ${(ff.stderr || "").trim().split("\n").pop()}`, 1);
    const base = path.join(tmp, "out");
    const r = spawnSync(cppBin, ["-m", cppModel, "-f", wav, "-oj", "-of", base, "-l", language ?? "auto", "-np"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0 || !existsSync(`${base}.json`)) die(`whisper.cpp failed: ${(r.stderr || r.stdout || "").trim().split("\n").pop()}`, 1);
    const json = readJson(`${base}.json`);
    segments = (json.transcription ?? []).map((s) => ({ start: round((s.offsets?.from ?? 0) / 1000), end: round((s.offsets?.to ?? 0) / 1000), text: String(s.text ?? "").trim() }));
  } else {
    const model = flags.model && !/\.bin$/i.test(flags.model) ? flags.model : "base";
    console.log(`openai-whisper with model ${model} (first run downloads the model) ...`);
    const args = [video, "--model", model, "--output_format", "json", "--output_dir", tmp, "--fp16", "False", "--verbose", "False", ...(language ? ["--language", language] : [])];
    const r = spawnSync(pyBin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const jsonFile = readdirSync(tmp).find((f) => f.endsWith(".json"));
    if (r.status !== 0 || !jsonFile) die(`whisper failed: ${(r.stderr || r.stdout || "").trim().split("\n").pop()}`, 1);
    const json = readJson(path.join(tmp, jsonFile));
    segments = (json.segments ?? []).map((s) => ({ start: round(Number(s.start) || 0), end: round(Number(s.end) || 0), text: String(s.text ?? "").trim() }));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

segments = segments.filter((s) => s.text && !/^\[(BLANK_AUDIO|MUSIC|Music)\]$/.test(s.text));
writeJson(out, segments);
const words = segments.reduce((a, s) => a + s.text.split(/\s+/).filter(Boolean).length, 0);
console.log(`saved ${rel(out)}: ${segments.length} segments, ${words} words`);
for (const s of segments.slice(0, 3)) console.log(`  ${s.start.toFixed(1)}s  ${s.text}`);
if (!segments.length) console.log("No speech found (music-only reel?). The analysis can still use frames and the caption.");
