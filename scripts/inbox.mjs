#!/usr/bin/env node
// Read the inbox your iPhone Shortcut fills (one reel URL per line) and print the reels not researched yet.
// A URL counts as done when it is listed in data/inbox-done.txt or library/reels/<id>.json exists.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractUrls, normalizeUrl, parseReelUrl } from "./lib/schema.mjs";
import { PATHS, cli, die, ensureDir, expandHome, loadConfig, rel, resolvePath, tryReadJson } from "./lib/util.mjs";

const USAGE = `Show the reels in your inbox that are not researched yet.

Usage:
  node scripts/inbox.mjs                  print unprocessed URLs, one per line
  node scripts/inbox.mjs --done <url>     mark a URL as processed (repeat --done for several)

Options:
  --file PATH        inbox file (default: inboxPath in config.json)
  --done-file PATH   where processed URLs are kept (default data/inbox-done.txt)
  --library DIR      library folder (default library/reels)
  --json             print a JSON array instead of plain lines
  -h, --help         show this help

Lines can hold extra text: the first link on each line is used. Links are cleaned (tracking query removed,
/reels/ becomes /reel/) and duplicates are dropped.`;

const { flags } = cli(USAGE, { boolean: ["json"], string: ["file", "done-file", "library"], multi: ["done"] });
const doneFile = flags["done-file"] ? resolvePath(flags["done-file"]) : PATHS.inboxDone;
const libraryDir = flags.library ? resolvePath(flags.library) : PATHS.library;

const readDone = () => new Set(existsSync(doneFile) ? readFileSync(doneFile, "utf8").split(/\r?\n/).map((l) => normalizeUrl(l.trim())).filter(Boolean) : []);

if (flags.done?.length) {
  const done = readDone();
  ensureDir(path.dirname(doneFile));
  let added = 0;
  for (const u of flags.done) {
    const n = normalizeUrl(extractUrls(u)[0] ?? u);
    if (!n) {
      console.error(`skip: not a URL: ${u}`);
      continue;
    }
    if (!done.has(n)) {
      appendFileSync(doneFile, `${n}\n`);
      done.add(n);
      added++;
    }
    console.log(`done ${n}`);
  }
  if (!added) console.error("(already marked done)");
  process.exit(0);
}

const config = loadConfig();
const inboxPath = flags.file ? resolvePath(flags.file) : resolvePath(expandHome(config.inboxPath ?? ""));
if (!inboxPath || !existsSync(inboxPath)) {
  die(`Inbox file not found: ${inboxPath || "(inboxPath is empty)"}\nSet "inboxPath" in config.json, or build the iPhone Shortcut first (docs/iphone-shortcut.md).`, 2);
}

const done = readDone();
// Library ids: the "id" inside each entry (files are normally named <id>.json, but the id field is what counts).
const inLibrary = new Set();
if (existsSync(libraryDir)) {
  for (const f of readdirSync(libraryDir).filter((n) => n.endsWith(".json"))) {
    inLibrary.add(f.slice(0, -5));
    const id = tryReadJson(path.join(libraryDir, f))?.id;
    if (typeof id === "string") inLibrary.add(id);
  }
}
const seen = new Set();
const pending = [];
let total = 0;
for (const line of readFileSync(inboxPath, "utf8").split(/\r?\n/)) {
  const first = extractUrls(line)[0];
  if (!first) continue;
  const url = normalizeUrl(first);
  if (!url || seen.has(url)) continue;
  seen.add(url);
  total++;
  const id = parseReelUrl(url)?.id;
  if (done.has(url) || (id && inLibrary.has(id))) continue;
  pending.push(url);
}

if (flags.json) console.log(JSON.stringify(pending, null, 2));
else for (const u of pending) console.log(u);
console.error(`${pending.length} to research, ${total - pending.length} already done (${rel(inboxPath)})`);
