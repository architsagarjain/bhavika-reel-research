#!/usr/bin/env node
// Daily outlier report: merge every search result file from one run, keep the reels that outperformed in the last
// 24 hours (48 at most, or up to 7 days when config.maxWindowHours says so), and write reports/<stamp>.json + reports/<stamp>.html.
// Reads Sandcastles and Apify result files (auto-detected per file) and bring-your-own JSON, all in one folder.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { page } from "./lib/html.mjs";
import {
  HARD_MAX_WINDOW_HOURS,
  HOT_OUTLIER,
  MAX_WINDOW_HOURS,
  MIN_HITS_BEFORE_WIDEN,
  MIN_VIEWS,
  WINDOW_HOURS,
  compareHits,
  detectShape,
  finalizeHit,
  hitBasesFrom,
  isEnglishOrHindi,
  isExcluded,
  isOnTopic,
  nicheQueries,
  slugify,
} from "./lib/schema.mjs";
import { PATHS, cli, coverSrc, die, fmtNum, loadConfig, loadNiche, makeStamp, newestDir, openFile, rel, resolvePath, tryReadJson, writeJson, writeText } from "./lib/util.mjs";

const USAGE = `Build the outlier report from one search run.

Usage:
  node scripts/outliers.mjs [options]

Options:
  --in DIR          folder with the run's result files (default: newest data/raw/search-*)
  --hours N         window in hours, capped at config maxWindowHours (default 24; widens to it by itself when under ${MIN_HITS_BEFORE_WIDEN} reels)
  --min-views N     drop reels under this many views (default: minViews in config.json, ${MIN_VIEWS})
  --out DIR         where to write the report (default reports/)
  --stamp STAMP     report name (default: taken from the folder name, else now)
  --now ISO         pretend it is this time (for old or sample data)
  --niche FILE      niche file for cluster tags (default niche.json)
  --open            open the report in your browser
  -h, --help        show this help

Writes reports/<stamp>.json ({ meta, hits }) and reports/<stamp>.html.`;

const REPORT_CSS = `
.card .over .cap{font-size:13px;color:var(--text);opacity:.92}
.vph{color:var(--lime);font-weight:700}
.found{font-size:12px;color:var(--faint)}
.found b{color:var(--muted);font-weight:600}
.links{display:flex;gap:8px;margin-top:auto;padding-top:4px}
.links .btn{flex:1}
.window{display:inline-flex;align-items:center;gap:8px;margin-top:14px;padding:6px 12px;border-radius:999px;background:var(--card);border:1px solid var(--line2);color:var(--muted);font-size:13px}
.window b{color:var(--champ)}
`;

const REPORT_JS = `
const D=readData();const M=D.meta;
const app=document.getElementById('app');
const state={cluster:null,sort:'outlier',hideSus:false,q:''};
const hot=D.hits.filter(x=>x.outlier!=null&&x.outlier>=D.hot).length;
const sus=D.hits.filter(x=>x.suspicious).length;
const provider=M.provider.split('+').map(p=>p==='sandcastles'?'Sandcastles':p==='apify'?'Apify':p==='any'?'your own data':p).join(' + ');
const wrap=h('div',{class:'wrap'});
wrap.append(
  h('div',{class:'brand'},h('i'),'Instagram Research Tool'),
  h('div',{class:'eyebrow',text:'Outlier report'}),
  h('h1',{text:'What outperformed in the last '+M.windowHours+' hours'}),
  h('div',{class:'sub',text:(D.niche?D.niche+'. ':'')+'Run '+M.stamp+' from '+provider+', '+M.queries+' searches. Generated '+new Date(M.generatedAt).toLocaleString()+'.'}),
  M.widened?h('div',{class:'window'},h('b',{text:'Window widened to '+M.windowHours+'h'}),'only '+M.attempts[0].kept+' reels in the last '+M.attempts[0].windowHours+'h'):'',
  h('div',{class:'tiles'},
    h('div',{class:'tile accent'},h('b',{text:fmt(M.keptCount)}),h('span',{text:'reels kept'})),
    h('div',{class:'tile hot'},h('b',{text:String(hot)}),h('span',{text:D.hot+'x and up'})),
    h('div',{class:'tile'},h('b',{text:fmt(M.rawCount)}),h('span',{text:'raw results'})),
    h('div',{class:'tile'},h('b',{text:String(M.queries)}),h('span',{text:'searches'})),
    h('div',{class:'tile'},h('b',{text:fmt(M.minViews)+'+'}),h('span',{text:'views floor'})),
    h('div',{class:'tile'},h('b',{text:String(sus)}),h('span',{text:'suspicious'}))
  )
);
const counts={};D.hits.forEach(x=>x.clusters.forEach(c=>counts[c]=(counts[c]||0)+1));
const chips=h('div',{class:'chips',role:'group','aria-label':'Filter by cluster'});
function chip(id,label,n){const b=h('button',{class:'chip',type:'button','aria-pressed':String(state.cluster===id)},label,h('small',{text:String(n)}));b.addEventListener('click',()=>{state.cluster=state.cluster===id?null:id;render()});b.dataset.id=id==null?'':id;return b}
function drawChips(){chips.replaceChildren(chip(null,'All',D.hits.length),...Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).map(c=>{const b=chip(c,c.charAt(0).toUpperCase()+c.slice(1),counts[c]);b.title=D.labels[c]||c;return b}))}
const sort=h('select',{class:'ctl','aria-label':'Sort'},h('option',{value:'outlier',text:'Outlier, then views per hour'}),h('option',{value:'vph',text:'Views per hour'}),h('option',{value:'views',text:'Most views'}),h('option',{value:'er',text:'Engagement rate'}),h('option',{value:'new',text:'Newest'}));
sort.addEventListener('change',()=>{state.sort=sort.value;render()});
const q=h('input',{class:'ctl',type:'search',placeholder:'Search caption or creator','aria-label':'Search'});
q.addEventListener('input',()=>{state.q=q.value.trim().toLowerCase();render()});
const tg=h('input',{type:'checkbox'});tg.addEventListener('change',()=>{state.hideSus=tg.checked;render()});
const count=h('span',{class:'count'});
wrap.append(h('div',{class:'bar'},chips,sort,q,h('label',{class:'toggle'},tg,'Hide suspicious'),count));
const grid=h('div',{class:'grid'});wrap.append(grid);
wrap.append(h('div',{class:'note'},
  h('b',{text:'How to read this. '}),'Outlier = views compared with the creator\\'s typical reel (only some providers know it; when it is missing the card shows views per hour). Sorted by outlier, then views per hour. Reels under '+fmt(M.minViews)+' views are dropped. ',
  h('b',{text:'Suspicious'}),' = over 20K views with under 1.5 likes per 1,000 views: reach without engagement, often paid. Flagged, never hidden. ',
  h('b',{text:'Keep the idea, never the words: '}),'research the reel, then rewrite the topic in your own voice.'));
app.append(wrap);
const cmp={outlier:(a,b)=>((b.outlier==null?-1e9:b.outlier)-(a.outlier==null?-1e9:a.outlier))||(b.viewsPerHour-a.viewsPerHour),vph:(a,b)=>b.viewsPerHour-a.viewsPerHour,views:(a,b)=>b.views-a.views,er:(a,b)=>(b.engagementRate||0)-(a.engagementRate||0),new:(a,b)=>a.hoursAgo-b.hoursAgo};
function card(x){
  const isHot=x.outlier!=null&&x.outlier>=D.hot;
  const cov=coverEl(x.coverSrc,x.id,'Cover of a reel by @'+x.creator);
  cov.append(x.outlier!=null?h('span',{class:'pill tl '+(isHot?'hot':x.outlier>=2?'lime':''),title:'Views vs this creator\\'s typical reel',text:(isHot?'HOT ':'')+x.outlier+'x'}):h('span',{class:'pill tl',title:'Views per hour (this provider has no outlier score)',text:fmt(x.viewsPerHour)+'/hr'}));
  cov.append(h('span',{class:'pill tr',text:ago(x.hoursAgo)}));
  if(x.suspicious)cov.append(h('span',{class:'pill bl warn',title:'Over 20K views with under 1.5 likes per 1,000 views',text:'SUSPICIOUS'}));
  return h('article',{class:'card'},cov,h('div',{class:'body'},
    h('div',{class:'who'},h('b',{text:'@'+x.creator}),h('span',{class:'vph',text:fmt(x.viewsPerHour)+'/hr'})),
    h('div',{class:'clamp3 muted',style:'font-size:13.5px',text:x.caption||'(no caption)'}),
    h('div',{class:'stats'},h('span',null,h('b',{text:fmt(x.views)}),' views'),h('span',null,h('b',{text:fmt(x.likes)}),' likes'),h('span',null,h('b',{text:fmt(x.comments)}),' comments'),h('span',null,h('b',{text:pct(x.engagementRate)}),' eng.')),
    x.clusters.length?h('div',{class:'tags'},x.clusters.slice(0,3).map(c=>h('span',{class:'tag',title:D.labels[c]||c,text:c}))):null,
    x.foundBy.length?h('div',{class:'found'},'Found by ',h('b',{text:x.foundBy.slice(0,3).join(', ')+(x.foundBy.length>3?' +'+(x.foundBy.length-3):'')})):null,
    h('div',{class:'links'},h('a',{class:'btn primary',href:x.url,target:'_blank',rel:'noopener noreferrer',text:'Open on Instagram \\u2197'}))
  ));
}
function render(){
  drawChips();
  let rows=D.hits.filter(x=>(!state.cluster||x.clusters.includes(state.cluster))&&(!state.hideSus||!x.suspicious)&&(!state.q||(x.creator+' '+x.caption).toLowerCase().includes(state.q)));
  rows=rows.slice().sort(cmp[state.sort]);
  count.textContent=rows.length+' of '+D.hits.length+' reels';
  grid.replaceChildren(...(rows.length?rows.map(card):[h('div',{class:'empty',text:D.hits.length?'No reels match these filters.':'No reels made the cut in this window.'})]));
}
render();
`;

const { flags } = cli(USAGE, { boolean: ["open"], string: ["in", "hours", "min-views", "out", "stamp", "now", "niche"] });
const config = loadConfig();
const niche = loadNiche(flags.niche ? resolvePath(flags.niche) : PATHS.niche);

const inPath = flags.in ? resolvePath(flags.in) : newestDir(PATHS.raw, "search-");
if (!inPath) die("No search results yet. Run the searches first: /outliers in Claude Code, or node scripts/apify-search.mjs", 2);
if (!existsSync(inPath)) die(`Not found: ${flags.in}`, 2);
const isFile = statSync(inPath).isFile();
const dir = isFile ? path.dirname(inPath) : inPath;
const files = isFile ? [inPath] : readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(dir, f));
if (!files.length) die(`No .json result files in ${rel(dir)}.`, 2);

const now = flags.now ? Date.parse(flags.now) : Date.now();
if (!Number.isFinite(now)) die(`--now must be an ISO date (got ${flags.now})`, 2);
const minViews = Math.max(0, Number(flags["min-views"] ?? config.minViews ?? MIN_VIEWS) || 0);
const maxWindow = Math.min(HARD_MAX_WINDOW_HOURS, Number(config.maxWindowHours) || MAX_WINDOW_HOURS);
const minEngagement = Math.max(0, Number(config.minEngagement) || 0);
const languageFilter = Array.isArray(config.languages) && config.languages.length > 0;
let hoursFlag = null;
if (flags.hours !== undefined) {
  hoursFlag = Number(flags.hours);
  if (!Number.isFinite(hoursFlag) || hoursFlag <= 0) die("--hours must be a positive number", 2);
  if (hoursFlag > maxWindow) {
    console.log(`note: --hours ${hoursFlag} is wider than ${maxWindow}; using ${maxWindow} (older reels are not news anymore).`);
    hoursFlag = maxWindow;
  }
}
const baseWindow = hoursFlag ?? Math.min(maxWindow, Number(config.windowHours) || WINDOW_HOURS);

// Manifest: which query produced which file (queries.jsonl, one JSON object per line).
const manifest = new Map();
const manifestFile = path.join(dir, "queries.jsonl");
if (existsSync(manifestFile)) {
  for (const line of readFileSync(manifestFile, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (m && typeof m.file === "string") {
        const key = path.basename(m.file);
        if (!manifest.has(key)) manifest.set(key, []);
        manifest.get(key).push(m);
      }
    } catch {
      // ignore a broken line
    }
  }
}
const querySlugs = new Map(nicheQueries(niche).map((q) => [q.slug, q.query]));
function queriesFor(file) {
  const fromManifest = (manifest.get(path.basename(file)) ?? []).map((m) => String(m.query ?? "")).filter(Boolean);
  if (fromManifest.length) return fromManifest;
  const slug = path.basename(file, ".json").replace(/^(sandcastles|apify|search|any)-/, "").replace(/-p\d+$/, "");
  return [querySlugs.get(slug) ?? querySlugs.get(slugify(slug)) ?? slug];
}

// Merge every file. One reel found by several queries becomes one hit with every query in foundBy.
const byId = new Map();
const providers = new Set();
const allQueries = new Set();
const skippedFiles = [];
let rawCount = 0;
for (const file of files) {
  const raw = tryReadJson(file);
  if (raw === undefined) {
    skippedFiles.push(`${path.basename(file)} (not valid JSON)`);
    continue;
  }
  const shape = detectShape(raw);
  if (!["sandcastles-search", "sandcastles-video", "apify-items", "generic-items", "empty"].includes(shape)) {
    skippedFiles.push(`${path.basename(file)} (${shape})`);
    continue;
  }
  const { bases, skipped } = hitBasesFrom(raw, shape);
  rawCount += bases.length + skipped;
  const queries = queriesFor(file);
  for (const q of queries) allQueries.add(q);
  for (const b of bases) {
    providers.add(b.provider);
    const cur = byId.get(b.id);
    if (!cur) {
      byId.set(b.id, { base: { ...b }, foundBy: new Set(queries) });
      continue;
    }
    for (const q of queries) cur.foundBy.add(q);
    const keep = cur.base;
    const better = (b.views ?? -1) > (keep.views ?? -1) ? { ...b } : { ...keep };
    // Keep the outlier score from whichever provider knows it (only Sandcastles does).
    if (better.outlier === null) {
      const known = b.outlier ?? keep.outlier;
      if (known !== null) {
        better.outlier = known;
        better.provider = b.outlier !== null ? b.provider : keep.provider;
      }
    }
    better.cover = better.cover ?? b.cover ?? keep.cover;
    better.caption = better.caption || b.caption || keep.caption;
    cur.base = better;
  }
}
for (const m of manifest.values()) for (const line of m) if (line.query) allQueries.add(String(line.query));

// Creator baseline: when a run holds 5+ reels from one creator (a watchlist run), score each reel against that
// creator's median views. A provider's own outlier score always wins.
const byCreator = new Map();
for (const { base } of byId.values()) {
  if (base.views === null || !base.creator) continue;
  if (!byCreator.has(base.creator)) byCreator.set(base.creator, []);
  byCreator.get(base.creator).push(base.views);
}
for (const { base } of byId.values()) {
  const views = byCreator.get(base.creator);
  if (base.outlier !== null || base.views === null || !views || views.length < 5) continue;
  const sorted = [...views].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (median > 0) base.outlier = Math.round((base.views / median) * 10) / 10;
}

function cut(hours) {
  const dropped = { noData: 0, lowViews: 0, tooOld: 0, offTopic: 0, language: 0, excluded: 0, lowEngagement: 0 };
  const hits = [];
  for (const { base, foundBy } of byId.values()) {
    if (!base.postedAt || base.views === null) { dropped.noData++; continue; }
    if (base.views < minViews) { dropped.lowViews++; continue; }
    const hit = finalizeHit(base, { now, niche, foundBy: [...foundBy] });
    if (hit.hoursAgo > hours) { dropped.tooOld++; continue; }
    if (!isOnTopic(hit.caption, hit.clusters, niche)) { dropped.offTopic++; continue; }
    if (languageFilter && !isEnglishOrHindi(hit.caption)) { dropped.language++; continue; }
    if (isExcluded(hit.caption, niche)) { dropped.excluded++; continue; }
    if (minEngagement && hit.likes !== null && hit.engagementRate !== null && hit.engagementRate < minEngagement) { dropped.lowEngagement++; continue; }
    hits.push(hit);
  }
  return { hits: hits.sort(compareHits), dropped };
}

let windowHours = baseWindow;
let result = cut(windowHours);
const attempts = [{ windowHours, kept: result.hits.length }];
let widened = false;
if (hoursFlag === null && result.hits.length < MIN_HITS_BEFORE_WIDEN && windowHours < maxWindow) {
  const wide = cut(maxWindow);
  attempts.push({ windowHours: maxWindow, kept: wide.hits.length });
  windowHours = maxWindow;
  result = wide;
  widened = true;
}

const folderStamp = /^search-(.+)$/.exec(path.basename(dir))?.[1];
const stamp = slugify(flags.stamp ?? folderStamp ?? makeStamp()) || makeStamp();
const meta = {
  stamp,
  provider: providers.size ? [...providers].sort().join("+") : "none",
  windowHours,
  queries: allQueries.size,
  rawCount,
  keptCount: result.hits.length,
  generatedAt: new Date().toISOString(),
  referenceTime: new Date(now).toISOString(),
  minViews,
  minEngagement,
  widened,
  attempts,
  uniqueReels: byId.size,
  dropped: result.dropped,
  inputDir: rel(dir),
  files: files.length,
};

const outDir = flags.out ? resolvePath(flags.out) : PATHS.reports;
const jsonFile = path.join(outDir, `${stamp}.json`);
const htmlFile = path.join(outDir, `${stamp}.html`);
writeJson(jsonFile, { meta, hits: result.hits });
writeText(htmlFile, renderReport(meta, result.hits, outDir));

// Console summary.
const provLabel = meta.provider.replace("+", " + ");
console.log(`\nOutliers ${stamp} | ${provLabel} | window ${windowHours}h${widened ? ` (widened: only ${attempts[0].kept} reels in ${attempts[0].windowHours}h)` : ""}`);
console.log(`${rawCount} results from ${files.length} files, ${byId.size} unique reels, ${result.hits.length} kept | dropped: ${result.dropped.tooOld} older, ${result.dropped.lowViews} under ${fmtNum(minViews)} views, ${result.dropped.offTopic} off topic, ${result.dropped.noData} without date/views, ${result.dropped.language} other language, ${result.dropped.excluded} excluded format, ${result.dropped.lowEngagement} low engagement`);
if (skippedFiles.length) console.log(`skipped files: ${skippedFiles.join(", ")}`);
for (const hit of result.hits.slice(0, 10)) {
  const score = hit.outlier !== null ? `${hit.outlier}x`.padStart(6) : `${fmtNum(hit.viewsPerHour)}/h`.padStart(6);
  console.log(`  ${score} | ${fmtNum(hit.views).padStart(6)} views | ${String(hit.hoursAgo).padStart(4)}h | @${hit.creator.slice(0, 22).padEnd(22)} | ${hit.caption.replace(/\s+/g, " ").slice(0, 60)}${hit.suspicious ? "  [suspicious]" : ""}`);
}
if (!result.hits.length) console.log("\nNo reels made the cut. Older data? Try --now <time of the search>, or check minViews in config.json.");
console.log(`\n${rel(jsonFile)}\n${rel(htmlFile)}`);
if (flags.open) openFile(htmlFile);

// ---------------------------------------------------------------------------------------------------------------

function renderReport(m, hits, outputDir) {
  const labels = Object.fromEntries((niche.clusters ?? []).map((c) => [c.id, c.label ?? c.id]));
  const data = {
    meta: m,
    hot: HOT_OUTLIER,
    labels,
    niche: String(niche.niche ?? ""),
    hits: hits.map((x) => ({ ...x, coverSrc: coverSrc(x.cover, outputDir) })),
  };
  const title = `Outliers ${m.stamp}`;
  return page({ title, description: `Reels that outperformed in the last ${m.windowHours} hours`, css: REPORT_CSS, data, script: REPORT_JS });
}
