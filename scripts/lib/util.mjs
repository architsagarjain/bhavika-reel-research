// Shared helpers for every script in this kit. Zero dependencies: only Node built-ins.
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (two levels up from scripts/lib). Every relative path in the kit is resolved against it. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const PATHS = {
  config: path.join(ROOT, "config.json"),
  niche: path.join(ROOT, "niche.json"),
  env: path.join(ROOT, ".env"),
  library: path.join(ROOT, "library", "reels"),
  media: path.join(ROOT, "media"),
  raw: path.join(ROOT, "data", "raw"),
  inboxDone: path.join(ROOT, "data", "inbox-done.txt"),
  reports: path.join(ROOT, "reports"),
  out: path.join(ROOT, "out"),
  samples: path.join(ROOT, "samples"),
};

export const DEFAULT_CONFIG = {
  provider: "sandcastles",
  searchProvider: "sandcastles",
  inboxPath: "~/Library/Mobile Documents/com~apple~CloudDocs/Reel Research/inbox.txt",
  windowHours: 24,
  maxWindowHours: 48,
  minViews: 2000,
  transcription: "auto",
  myHandle: "",
};

/**
 * Tiny argv parser. spec = { boolean: ["open"], string: ["in", "hours"], multi: ["done"] }.
 * Supports --flag, --flag value, --flag=value, and -h / --help. Unknown flags are an error so typos never pass silently.
 */
export function parseArgs(argv, spec = {}) {
  const bools = new Set(["help", ...(spec.boolean ?? [])]);
  const strings = new Set([...(spec.string ?? []), ...(spec.multi ?? [])]);
  const multi = new Set(spec.multi ?? []);
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") { flags.help = true; continue; }
    if (a === "--") { positionals.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith("--")) { positionals.push(a); continue; }
    const eq = a.indexOf("=");
    const name = a.slice(2, eq === -1 ? undefined : eq);
    if (bools.has(name)) {
      flags[name] = eq === -1 ? true : !/^(0|false|no)$/i.test(a.slice(eq + 1));
      continue;
    }
    if (strings.has(name)) {
      let value;
      if (eq !== -1) value = a.slice(eq + 1);
      else {
        value = argv[i + 1];
        if (value === undefined || (value.startsWith("--") && value.length > 2)) throw new UsageError(`--${name} needs a value`);
        i++;
      }
      if (multi.has(name)) (flags[name] ??= []).push(value);
      else flags[name] = value;
      continue;
    }
    throw new UsageError(`unknown option --${name}`);
  }
  return { flags, positionals };
}

export class UsageError extends Error {}

/** Parse args or print usage and exit. Returns { flags, positionals }. */
export function cli(usage, spec) {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2), spec);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`${e.message}\n\n${usage}`);
      process.exit(2);
    }
    throw e;
  }
  if (parsed.flags.help) {
    console.log(usage);
    process.exit(0);
  }
  return parsed;
}

/** Print one clear line and exit. Code 2 = setup problem the user can fix (missing tool, token, file). */
export function die(message, code = 1) {
  console.error(`\n${message}\n`);
  process.exit(code);
}

export function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Resolve a user path: ~ expanded, relative paths against the current directory. */
export function resolvePath(p) {
  return path.resolve(expandHome(p));
}

/** Path relative to the repo root when inside it (for printing), else absolute. */
export function rel(p) {
  const r = path.relative(ROOT, p);
  return r && !r.startsWith("..") && !path.isAbsolute(r) ? r : p;
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file) {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  return JSON.parse(text);
}

/** Read JSON, returning undefined instead of throwing (bad or missing file). */
export function tryReadJson(file) {
  try {
    return readJson(file);
  } catch {
    return undefined;
  }
}

/** Write atomically (tmp file + rename) so a crash never leaves half a file behind. */
export function writeText(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  return file;
}

export function writeJson(file, data) {
  return writeText(file, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Load KEY=VALUE lines from .env into process.env (existing env vars win). No dependency, handles quotes and comments.
 * Set IRT_NO_DOTENV=1 to skip it (the selftest does, so it can never pick up a real token).
 */
export function loadEnv(file = PATHS.env) {
  if (process.env.IRT_NO_DOTENV === "1" || !existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    if (process.env[m[1]] === undefined || process.env[m[1]] === "") process.env[m[1]] = value;
  }
}

export function loadConfig(file = PATHS.config) {
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  let cfg;
  try {
    cfg = readJson(file);
  } catch (e) {
    die(`config.json is not valid JSON (${e.message}). Fix it or copy the default from the README.`, 2);
  }
  return { ...DEFAULT_CONFIG, ...cfg };
}

export function loadNiche(file = PATHS.niche) {
  if (!existsSync(file)) die(`niche file not found: ${file}. Copy niche.json from the repo or run /research-setup.`, 2);
  let niche;
  try {
    niche = readJson(file);
  } catch (e) {
    die(`${rel(file)} is not valid JSON (${e.message}).`, 2);
  }
  if (!Array.isArray(niche.clusters)) die(`${rel(file)} needs a "clusters" array.`, 2);
  return niche;
}

/** Escape any value for HTML text or a quoted attribute. */
export function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON that is safe inside <script type="application/json">: no "<" can close the tag, no line separators break it. */
export function jsonForScript(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Run stamp YYYY-MM-DD-HHmm in local time (same as `date +%Y-%m-%d-%H%M`). */
export function makeStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** "Claude Code" -> "claude-code". Used for raw result file names. */
export function slugify(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Find an executable on PATH (macOS + Linux). Returns its full path or null. */
export function which(cmd) {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const p = path.join(dir, cmd);
    try {
      if (statSync(p).isFile()) {
        accessSync(p, constants.X_OK);
        return p;
      }
    } catch {
      // not here
    }
  }
  return null;
}

/** Open a file in the default browser / app. Never throws. */
export function openFile(p) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", p] : [p];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => console.log(`Open it yourself: ${p}`));
    child.unref();
  } catch {
    console.log(`Open it yourself: ${p}`);
  }
}

export function fmtNum(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "n/a";
  const v = Number(n);
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(Math.abs(v) >= 1e7 ? 0 : 1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(Math.abs(v) >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(v));
}

/** Newest subdirectory of `dir` whose name starts with `prefix` (by name, stamps sort chronologically). */
export function newestDir(dir, prefix) {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir).filter((n) => n.startsWith(prefix) && statSync(path.join(dir, n)).isDirectory()).sort();
  return names.length ? path.join(dir, names[names.length - 1]) : null;
}

/** ffprobe duration in seconds, or null when ffprobe is missing or fails. */
export function probeDuration(file) {
  if (!which("ffprobe")) return null;
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  const d = Number.parseFloat((r.stdout ?? "").trim());
  return Number.isFinite(d) ? Math.round(d * 100) / 100 : null;
}

export const FFMPEG_HINT = "ffmpeg is not installed. Install it: macOS `brew install ffmpeg`, Ubuntu/Debian `sudo apt install ffmpeg`.";

/** Mime type for the few file types the viewers inline. */
export function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif" }[ext] ?? null;
}

/**
 * Turn a cover reference into something an HTML file in `outDir` can show:
 * https URL -> as is; local file under the repo -> inlined data URI (small) or a relative path (large); anything else -> null.
 */
export function coverSrc(cover, outDir, maxInlineBytes = 1_500_000) {
  if (!cover || typeof cover !== "string") return null;
  if (/^https?:\/\//i.test(cover)) return cover;
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(cover)) return cover;
  const abs = path.isAbsolute(cover) ? cover : path.join(ROOT, cover);
  if (!existsSync(abs)) return null;
  const mime = mimeFor(abs);
  if (!mime) return null;
  const size = statSync(abs).size;
  if (size <= maxInlineBytes) return `data:${mime};base64,${readFileSync(abs).toString("base64")}`;
  return path.relative(outDir, abs).split(path.sep).join("/");
}

/** Download a URL to a file (streamed). Returns the byte count. Throws with a readable message on failure. */
export async function downloadTo(url, file) {
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  const { createWriteStream } = await import("node:fs");
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" } });
  } catch (e) {
    throw new Error(`download failed (${e.cause?.code ?? e.message})`);
  }
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status}); the link may have expired, run the fetch again`);
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, file);
  return statSync(file).size;
}

/**
 * Where a video's outputs (transcript, frames) go: its own folder when it already sits in media/<id>/,
 * else media/local-<file slug>/ so a video from ~/Downloads still lands inside the kit.
 */
export function mediaDirFor(videoFile) {
  const abs = path.resolve(videoFile);
  const parent = path.dirname(abs);
  if (path.dirname(parent) === PATHS.media && /^(ig|tt|yt|local)-[a-z0-9_-]+$/.test(path.basename(parent))) return parent;
  const base = path.basename(abs).replace(/\.[^.]+$/, "");
  return path.join(PATHS.media, `local-${slugify(base) || "video"}`);
}
