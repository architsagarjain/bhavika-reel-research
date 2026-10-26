// The data contract of the kit: ReelEntry (one analyzed reel) and OutlierHit (one reel in an outlier report),
// plus the adapters that turn each provider's raw output into them. Field reference: docs/schema.md.
// Pure functions only (no file or network access), so every script and the selftest share one source of truth.

export const SCHEMA_VERSION = 1;
export const PROVIDERS = ["sandcastles", "apify", "ytdlp", "any"];
export const SEARCH_PROVIDERS = ["sandcastles", "apify"];
export const HIT_PROVIDERS = ["sandcastles", "apify", "any"];
export const PLATFORMS = ["instagram", "tiktok", "youtube"];

/** Reels under this many views are dropped from outlier reports. */
export const MIN_VIEWS = 2000;
/** Default outlier window. */
export const WINDOW_HOURS = 24;
/** The window may widen to this, never wider (unless config.maxWindowHours raises it). */
export const MAX_WINDOW_HOURS = 48;
/** config.maxWindowHours can raise the ceiling up to this (7 days), never further. */
export const HARD_MAX_WINDOW_HOURS = 168;
/** Under this many hits in the 24h window, the report widens to 48h (unless --hours is given). */
export const MIN_HITS_BEFORE_WIDEN = 15;
/** Outlier score at or above this is "hot" (champagne badge). */
export const HOT_OUTLIER = 5;
/** Reach without engagement: over 20K views with under 1.5 likes per 1,000 views. Flagged, never hidden. */
export const SUSPICIOUS = { minViews: 20000, maxLikesPer1k: 1.5 };
/** ReelEntry ids: ig-<shortcode>, tt-<video id>, yt-<shorts id>, local-<file slug>, all lowercase. */
export const ID_RE = /^(ig|tt|yt|local)-[a-z0-9_-]+$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v) => v === null || isNum(v);
const isIso = (v) => isStr(v) && v.length >= 10 && Number.isFinite(Date.parse(v));
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/** "Claude Code" -> "claude-code" (same rule as util.slugify; duplicated so this module has no imports). */
export function slugify(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ---------------------------------------------------------------------------------------------------------------
// URLs and ids
// ---------------------------------------------------------------------------------------------------------------

/**
 * Parse a reel / short URL from Instagram, TikTok or YouTube.
 * Returns { platform, code, id, url } with a canonical URL, or null when it is not a recognisable reel link.
 */
export function parseReelUrl(input) {
  if (!isStr(input)) return null;
  let s = input.trim().replace(/[)\].,;!?'"]+$/, "");
  if (!/^https?:\/\//i.test(s)) {
    if (/^((www|m)\.)?(instagram|tiktok|youtube)\.com\//i.test(s) || /^(youtu\.be|vm\.tiktok\.com|vt\.tiktok\.com)\//i.test(s)) s = `https://${s}`;
    else return null;
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const i = parts.findIndex((p) => ["reel", "reels", "p", "tv"].includes(p.toLowerCase()));
    const code = i >= 0 ? parts[i + 1] : undefined;
    if (!code || !/^[A-Za-z0-9_-]{5,}$/.test(code)) return null;
    return { platform: "instagram", code, id: `ig-${code.toLowerCase()}`, url: `https://www.instagram.com/reel/${code}/` };
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const i = parts.indexOf("video");
    const vid = i >= 0 ? parts[i + 1] : undefined;
    if (vid && /^\d{6,}$/.test(vid)) {
      const user = i > 0 && parts[i - 1].startsWith("@") ? parts[i - 1] : null;
      return { platform: "tiktok", code: vid, id: `tt-${vid}`, url: user ? `https://www.tiktok.com/${user}/video/${vid}` : `https://www.tiktok.com/video/${vid}` };
    }
    if ((host === "vm.tiktok.com" || host === "vt.tiktok.com") && parts[0] && /^[A-Za-z0-9_-]{4,}$/.test(parts[0])) {
      // Short share link: the real video id is only known after resolving it (yt-dlp does that).
      return { platform: "tiktok", code: parts[0], id: `tt-${parts[0].toLowerCase()}`, url: `https://${host}/${parts[0]}/`, short: true };
    }
    return null;
  }
  if (host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com") {
    let vid = null;
    if (host === "youtu.be") vid = parts[0];
    else if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") vid = parts[1];
    else if (parts[0] === "watch") vid = u.searchParams.get("v");
    if (!vid || !/^[A-Za-z0-9_-]{6,}$/.test(vid)) return null;
    return { platform: "youtube", code: vid, id: `yt-${vid.toLowerCase()}`, url: `https://www.youtube.com/shorts/${vid}` };
  }
  return null;
}

/** Normalize a URL for the inbox: canonical reel URL when recognised (query stripped, /reels/ -> /reel/), else the URL without query/hash. */
export function normalizeUrl(input) {
  const parsed = parseReelUrl(input);
  if (parsed) return parsed.url;
  if (!isStr(input)) return null;
  try {
    const u = new URL(input.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname}`;
  } catch {
    return null;
  }
}

/** Every http(s) URL in a block of text (a Shortcut may append a title or emoji after the link). */
export function extractUrls(text) {
  return (String(text ?? "").match(/https?:\/\/[^\s<>"'`]+/gi) ?? []).map((u) => u.replace(/[)\].,;!?'"]+$/, ""));
}

// ---------------------------------------------------------------------------------------------------------------
// Numbers and dates
// ---------------------------------------------------------------------------------------------------------------

/** A count or null. Instagram reports -1 when a creator hides likes; that becomes null (unknown), never 0. */
export function cleanCount(v) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return isNum(n) && n >= 0 ? Math.round(n) : null;
}

/** (likes + comments + shares + saves, whichever are known) / views, 4 decimals. Null when views are unknown or 0. */
export function engagementRate({ views, likes, comments, shares, saves } = {}) {
  const v = cleanCount(views);
  if (!v) return null;
  const parts = [likes, comments, shares, saves].map(cleanCount).filter((n) => n !== null);
  if (!parts.length) return null;
  return Math.round((parts.reduce((a, b) => a + b, 0) / v) * 10000) / 10000;
}

/**
 * Any provider date -> ISO string (UTC) or null.
 * Accepts ISO with or without zone (no zone = UTC, which is what Sandcastles sends), unix seconds or ms, and yt-dlp's "YYYYMMDD".
 */
export function toIso(v) {
  if (v === null || v === undefined || v === "") return null;
  if (isNum(v)) {
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (!isStr(v)) return null;
  const s = v.trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00.000Z`;
  if (/^\d{10,13}$/.test(s)) return toIso(Number(s));
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  const withZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !hasZone ? `${s}Z` : s;
  const ms = Date.parse(withZone);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Niche clusters (niche.json)
// ---------------------------------------------------------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matcherCache = new Map();

/**
 * Caption term matcher. Terms match at the start of a word ("mcp" matches "MCPs", "agi" does not match "magic");
 * terms of 1-2 characters ("ai", "ia", "ki") must be the whole word.
 */
export function termMatches(text, term) {
  const t = String(term ?? "").toLowerCase().trim();
  if (!t) return false;
  let re = matcherCache.get(t);
  if (!re) {
    const tail = t.length <= 2 ? "(?=$|[^\\p{L}\\p{N}])" : "";
    re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(t)}${tail}`, "iu");
    matcherCache.set(t, re);
  }
  return re.test(text);
}

/** Cluster ids whose captionTerms appear in the caption. */
export function tagClusters(caption, niche) {
  const text = String(caption ?? "").toLowerCase();
  return (niche?.clusters ?? []).filter((c) => (c.captionTerms ?? []).some((t) => termMatches(text, t))).map((c) => c.id);
}

/**
 * Keyword search is fuzzy (a football reel can come back for "AI agent"). With niche.dropOffTopic, a reel stays only when
 * its caption hits a cluster that stands on its own, or one of niche.topicTerms. Clusters marked needsTopicTerm
 * (money, news) are not enough alone: "side hustle" without AI is off topic.
 */
export function isOnTopic(caption, clusterIds, niche) {
  if (!niche?.dropOffTopic) return true;
  const strong = new Set((niche.clusters ?? []).filter((c) => !c.needsTopicTerm).map((c) => c.id));
  if (clusterIds.some((id) => strong.has(id))) return true;
  const text = String(caption ?? "").toLowerCase();
  return (niche.topicTerms ?? []).some((t) => termMatches(text, t));
}

/** All niche queries as [{ query, cluster, slug }]. */
export function nicheQueries(niche) {
  return (niche?.clusters ?? []).flatMap((c) => (c.queries ?? []).map((query) => ({ query, cluster: c.id, slug: slugify(query) })));
}

/** "Claude Code" -> "claudecode", "GPT-6" -> "gpt6" (Apify hashtag input: one tag, no spaces or symbols). */
export function toHashtag(query) {
  return String(query ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}_]+/gu, "");
}

// ---------------------------------------------------------------------------------------------------------------
// Shape detection (which provider produced this file?)
// ---------------------------------------------------------------------------------------------------------------

/** MCP results are sometimes saved wrapped as [{ type: "text", text: "<json>" }] or { content: [...] }. Unwrap them. */
export function unwrap(raw) {
  let cur = raw;
  for (let depth = 0; depth < 3; depth++) {
    const blocks = Array.isArray(cur) ? cur : isObj(cur) && Array.isArray(cur.content) && Object.keys(cur).length <= 3 ? cur.content : null;
    if (blocks && blocks.length && blocks.every((b) => isObj(b) && b.type === "text" && isStr(b.text))) {
      try {
        cur = JSON.parse(blocks.map((b) => b.text).join(""));
        continue;
      } catch {
        return cur;
      }
    }
    if (isObj(cur) && isObj(cur.result) && Object.keys(cur).length <= 3 && (Array.isArray(cur.result.videos) || isObj(cur.result.video))) {
      cur = cur.result;
      continue;
    }
    break;
  }
  return cur;
}

export const isSandcastlesVideo = (o) => isObj(o) && isStr(o.uuid) && isStr(o.platform_url);
export const isApifyItem = (o) => isObj(o) && (isStr(o.shortCode) || isStr(o.ownerUsername)) && ("likesCount" in o || "videoPlayCount" in o || "caption" in o || "timestamp" in o);
export const isYtdlpInfo = (o) => isObj(o) && (isStr(o.extractor) || isStr(o.extractor_key)) && (isStr(o.webpage_url) || isStr(o.original_url)) && "id" in o;
export const isReelEntryLike = (o) => isObj(o) && isStr(o.id) && isObj(o.stats) && isObj(o.hook);
export const isGenericItem = (o) => isObj(o) && isStr(o.url) && ("views" in o) && ("postedAt" in o || "timestamp" in o || "published_at" in o);

/**
 * Detect the shape of a raw file:
 * "sandcastles-search" ({ videos: [...] } or a bare array of Sandcastles videos), "sandcastles-video" (one video, e.g. get_video_details),
 * "apify-items" (Apify dataset items), "ytdlp-info" (yt-dlp --write-info-json), "reel-entry" (this kit's own format),
 * "generic-items" (bring-your-own: [{ url, creator, caption, views, likes, comments, postedAt, cover, outlier }]), "empty" or "unknown".
 */
export function detectShape(input) {
  const raw = unwrap(input);
  if (Array.isArray(raw)) {
    const first = raw.find((x) => isObj(x));
    if (!first) return raw.length === 0 ? "empty" : "unknown";
    if (isSandcastlesVideo(first)) return "sandcastles-search";
    if (isApifyItem(first)) return "apify-items";
    if (isGenericItem(first)) return "generic-items";
    if (isReelEntryLike(first)) return "reel-entry";
    return "unknown";
  }
  if (isObj(raw)) {
    if (Array.isArray(raw.videos)) return raw.videos.length ? "sandcastles-search" : "empty";
    if (Array.isArray(raw.items)) return detectShape(raw.items);
    if (isSandcastlesVideo(raw)) return "sandcastles-video";
    if (isSandcastlesVideo(raw.video)) return "sandcastles-video";
    if (isYtdlpInfo(raw)) return "ytdlp-info";
    if (isReelEntryLike(raw)) return "reel-entry";
    if (isApifyItem(raw)) return "apify-items";
  }
  return "unknown";
}

/** The list of items inside a search-shaped file. */
export function itemsOf(input) {
  const raw = unwrap(input);
  if (Array.isArray(raw)) return raw.filter(isObj);
  if (isObj(raw) && Array.isArray(raw.videos)) return raw.videos.filter(isObj);
  if (isObj(raw) && Array.isArray(raw.items)) return raw.items.filter(isObj);
  if (isObj(raw)) return [raw];
  return [];
}

export function providerOfShape(shape) {
  if (shape.startsWith("sandcastles")) return "sandcastles";
  if (shape === "apify-items") return "apify";
  if (shape === "ytdlp-info") return "ytdlp";
  return "any";
}

// ---------------------------------------------------------------------------------------------------------------
// Outlier hits
// ---------------------------------------------------------------------------------------------------------------

/** Sandcastles search_all_videos item -> hit base (no window math yet). Null when it has no usable reel URL. */
export function sandcastlesToHitBase(v) {
  const parsed = parseReelUrl(v.platform_url);
  if (!parsed) return null;
  return {
    id: parsed.id,
    url: parsed.url,
    creator: String(v.channel?.handle ?? "").replace(/^@/, ""),
    caption: String(v.title ?? v.description ?? "").trim(),
    cover: isStr(v.thumbnail) && v.thumbnail ? v.thumbnail : null,
    views: cleanCount(v.view_count),
    likes: cleanCount(v.like_count),
    comments: cleanCount(v.comment_count),
    shares: null,
    postedAt: toIso(v.published_at),
    outlier: isNum(v.outlier_score) ? round(v.outlier_score, 1) : null,
    provider: "sandcastles",
  };
}

/** Apify dataset item (hashtag or reel scraper) -> hit base. Null for photos, carousels and failed items. */
export function apifyToHitBase(it) {
  if (isStr(it.type) && it.type !== "Video") return null;
  const parsed = parseReelUrl(isStr(it.shortCode) ? `https://www.instagram.com/reel/${it.shortCode}/` : it.url ?? it.inputUrl);
  if (!parsed) return null;
  return {
    id: parsed.id,
    url: parsed.url,
    creator: String(it.ownerUsername ?? "").replace(/^@/, ""),
    caption: String(it.caption ?? "").trim(),
    cover: isStr(it.displayUrl) && it.displayUrl ? it.displayUrl : null,
    views: cleanCount(it.videoPlayCount ?? it.igPlayCount ?? it.videoViewCount),
    likes: cleanCount(it.likesCount),
    comments: cleanCount(it.commentsCount),
    shares: cleanCount(it.sharesCount),
    postedAt: toIso(it.timestamp),
    outlier: null,
    provider: "apify",
  };
}

/** Bring-your-own item -> hit base. */
export function genericToHitBase(it) {
  const parsed = parseReelUrl(it.url);
  if (!parsed) return null;
  return {
    id: parsed.id,
    url: parsed.url,
    creator: String(it.creator ?? it.handle ?? "").replace(/^@/, ""),
    caption: String(it.caption ?? "").trim(),
    cover: isStr(it.cover) && it.cover ? it.cover : null,
    views: cleanCount(it.views),
    likes: cleanCount(it.likes),
    comments: cleanCount(it.comments),
    shares: cleanCount(it.shares),
    postedAt: toIso(it.postedAt ?? it.timestamp ?? it.published_at),
    outlier: isNum(it.outlier) ? round(it.outlier, 1) : null,
    provider: "any",
  };
}

/** Hit bases from any search-shaped file. */
export function hitBasesFrom(raw, shape = detectShape(raw)) {
  const items = itemsOf(raw);
  const fn = shape === "sandcastles-search" || shape === "sandcastles-video" ? sandcastlesToHitBase : shape === "apify-items" ? apifyToHitBase : shape === "generic-items" ? genericToHitBase : null;
  if (!fn) return { bases: [], skipped: items.length };
  const bases = [];
  let skipped = 0;
  for (const it of items) {
    const b = fn(it);
    if (b) bases.push(b);
    else skipped++;
  }
  return { bases, skipped };
}

/** True when likes per 1,000 views is under 1.5 on a reel with over 20K views. */
export function isSuspicious(views, likes) {
  if (!isNum(views) || !isNum(likes) || views <= SUSPICIOUS.minViews) return false;
  return (likes / views) * 1000 < SUSPICIOUS.maxLikesPer1k;
}

/** Finish a hit: hours ago, views per hour, engagement, clusters, suspicious flag. Field order matches docs/schema.md. */
export function finalizeHit(base, { now, niche, foundBy = [] }) {
  const postedMs = Date.parse(base.postedAt);
  const hoursAgo = Math.max(0, (now - postedMs) / 36e5);
  const clusters = tagClusters(base.caption, niche);
  return {
    id: base.id,
    url: base.url,
    creator: base.creator,
    caption: base.caption,
    cover: base.cover,
    views: base.views,
    likes: base.likes,
    comments: base.comments,
    postedAt: base.postedAt,
    hoursAgo: round(hoursAgo, 1),
    viewsPerHour: Math.round(base.views / Math.max(hoursAgo, 0.5)),
    outlier: base.outlier,
    engagementRate: engagementRate(base),
    clusters,
    foundBy: [...new Set(foundBy)],
    suspicious: isSuspicious(base.views, base.likes),
    provider: base.provider,
  };
}

/** Report order: outlier high to low (unknown last), then views per hour, then views. */
export function compareHits(a, b) {
  const ao = isNum(a.outlier) ? a.outlier : -Infinity;
  const bo = isNum(b.outlier) ? b.outlier : -Infinity;
  if (ao !== bo) return bo - ao;
  if (a.viewsPerHour !== b.viewsPerHour) return b.viewsPerHour - a.viewsPerHour;
  return (b.views ?? 0) - (a.views ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------
// ReelEntry
// ---------------------------------------------------------------------------------------------------------------

/** A blank ReelEntry with every field present. */
export function emptyReelEntry(now = new Date().toISOString()) {
  return {
    id: "",
    platform: "instagram",
    url: "",
    creator: "",
    addedAt: now,
    postedAt: null,
    durationSec: null,
    cover: null,
    caption: "",
    stats: { views: null, likes: null, comments: null, shares: null, saves: null, outlierScore: null, engagementRate: null },
    transcript: [],
    hook: { text: "", words: 0, seconds: 0, template: "", category: "", whyItWorks: "", powerWords: [] },
    format: { category: "", type: "", visualLayout: "", pacing: "", reasoning: "" },
    angle: { topic: "", angle: "", commonBelief: "", contrarianTake: "" },
    visualBreakdown: [],
    scrollStoppers: [],
    myVersion: { hook: "", script: "" },
    source: { provider: "any", fetchedAt: now, transcriptTiming: "none" },
  };
}

/** Lowercase id fragment: keeps letters, digits, "_" and "-". */
const idPart = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

const wordCount = (s) => (String(s ?? "").trim().match(/\S+/g) ?? []).length;

/** Split plain text into sentences. */
export function splitSentences(text) {
  return (String(text ?? "").replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** Spread sentences over [start, end] by word count. Used when a provider gives text without timestamps. */
export function spreadSentences(sentences, start, end) {
  const total = sentences.reduce((a, s) => a + Math.max(1, wordCount(s)), 0);
  if (!total || !(end > start)) return [];
  const out = [];
  let t = start;
  for (const s of sentences) {
    const dur = ((end - start) * Math.max(1, wordCount(s))) / total;
    out.push({ start: round(t, 2), end: round(t + dur, 2), text: s });
    t += dur;
  }
  return out;
}

/** Plain transcript text -> segments. Without a duration it assumes ~2.6 spoken words per second. */
export function transcriptFromText(text, durationSec) {
  const sentences = splitSentences(text);
  if (!sentences.length) return [];
  const words = sentences.reduce((a, s) => a + wordCount(s), 0);
  const end = isNum(durationSec) && durationSec > 0 ? durationSec : words / 2.6;
  return spreadSentences(sentences, 0, end);
}

/** Fill hook.words and hook.seconds from hook.text and the transcript (seconds = when the hook's last word is spoken). */
export function measureHook(entry) {
  const text = entry.hook?.text ?? "";
  const words = wordCount(text);
  entry.hook.words = words;
  if (!words || !entry.transcript?.length) return entry;
  let seen = 0;
  for (const seg of entry.transcript) {
    const n = wordCount(seg.text);
    if (seen + n >= words) {
      const frac = n ? (words - seen) / n : 1;
      entry.hook.seconds = round(seg.start + (seg.end - seg.start) * frac, 1);
      return entry;
    }
    seen += n;
  }
  entry.hook.seconds = round(entry.transcript[entry.transcript.length - 1].end, 1);
  return entry;
}

function finishEntry(e) {
  e.stats.engagementRate = engagementRate(e.stats);
  return measureHook(e);
}

/** Sandcastles video (search item or get_video_details) -> ReelEntry. Sandcastles' own analysis pre-fills hook, format and angle. */
export function sandcastlesToReel(input, now = new Date().toISOString()) {
  const raw = unwrap(input);
  const v = isSandcastlesVideo(raw) ? raw : raw?.video ?? raw;
  const e = emptyReelEntry(now);
  const parsed = parseReelUrl(v.platform_url);
  const a = isObj(v.analysis) ? v.analysis : {};
  e.id = parsed?.id ?? `ig-${slugify(v.uuid)}`;
  e.platform = parsed?.platform ?? (v.channel?.platform === "tiktok" ? "tiktok" : v.channel?.platform === "youtube" ? "youtube" : "instagram");
  e.url = parsed?.url ?? v.platform_url;
  e.creator = String(v.channel?.handle ?? "").replace(/^@/, "");
  e.postedAt = toIso(v.published_at);
  e.cover = isStr(v.thumbnail) && v.thumbnail ? v.thumbnail : null;
  e.caption = String(v.title ?? v.description ?? "").trim();
  e.stats.views = cleanCount(v.view_count);
  e.stats.likes = cleanCount(v.like_count);
  e.stats.comments = cleanCount(v.comment_count);
  e.stats.outlierScore = isNum(v.outlier_score) ? round(v.outlier_score, 1) : null;
  const sections = Array.isArray(a.narrative_structure?.structure_sections) ? a.narrative_structure.structure_sections : [];
  for (const s of sections) {
    const sentences = (Array.isArray(s.transcript_sentences) ? s.transcript_sentences : []).filter(isStr);
    e.transcript.push(...spreadSentences(sentences, Number(s.start_second) || 0, Number(s.end_second) || 0));
  }
  if (e.transcript.length) e.source.transcriptTiming = "estimated";
  const ends = sections.map((s) => Number(s.end_second)).filter(isNum);
  e.durationSec = isNum(v.duration) ? v.duration : ends.length ? Math.max(...ends) : null;
  e.hook.text = String(a.spoken_hook ?? "").trim();
  e.hook.template = String(a.spoken_hook_madlib ?? "").trim();
  e.hook.category = String(a.spoken_hook_category ?? v.spoken_hook_category ?? "").trim();
  e.hook.whyItWorks = String(a.hook_alignment ?? "").trim();
  e.format.category = String(a.format_category ?? v.format_category ?? "").trim();
  e.format.type = String(a.format_type ?? "").trim();
  e.format.visualLayout = [a.visual_layout_category, a.visual_layout_type].filter((x) => isStr(x) && x).join(" / ");
  e.format.reasoning = String(a.format_reasoning ?? "").trim();
  e.angle.topic = String(a.topic ?? v.topic ?? "").trim();
  e.angle.angle = String(a.angle ?? "").trim();
  e.angle.commonBelief = String(a.common_belief ?? "").trim();
  e.angle.contrarianTake = String(a.contrarian_reality ?? "").trim();
  e.source.provider = "sandcastles";
  return finishEntry(e);
}

/** Apify reel scraper item -> ReelEntry. Apify's transcript (paid add-on) is plain text, so its timing is estimated. */
export function apifyToReel(input, now = new Date().toISOString()) {
  const items = itemsOf(input);
  const it = items.find((x) => isApifyItem(x)) ?? items[0] ?? {};
  const e = emptyReelEntry(now);
  const parsed = parseReelUrl(isStr(it.shortCode) ? `https://www.instagram.com/reel/${it.shortCode}/` : it.url ?? it.inputUrl);
  e.id = parsed?.id ?? "";
  e.url = parsed?.url ?? String(it.url ?? "");
  e.creator = String(it.ownerUsername ?? "").replace(/^@/, "");
  e.postedAt = toIso(it.timestamp);
  e.durationSec = isNum(it.videoDuration) ? round(it.videoDuration, 2) : null;
  e.cover = isStr(it.displayUrl) && it.displayUrl ? it.displayUrl : null;
  e.caption = String(it.caption ?? "").trim();
  e.stats.views = cleanCount(it.videoPlayCount ?? it.igPlayCount ?? it.videoViewCount);
  e.stats.likes = cleanCount(it.likesCount);
  e.stats.comments = cleanCount(it.commentsCount);
  e.stats.shares = cleanCount(it.sharesCount);
  if (isStr(it.transcript) && it.transcript.trim()) {
    e.transcript = transcriptFromText(it.transcript, e.durationSec);
    e.source.transcriptTiming = "estimated";
  }
  e.source.provider = "apify";
  return finishEntry(e);
}

/** yt-dlp info json -> ReelEntry. Works for Instagram, TikTok and YouTube Shorts. */
export function ytdlpToReel(info, now = new Date().toISOString()) {
  const e = emptyReelEntry(now);
  const key = String(info.extractor_key ?? info.extractor ?? "").toLowerCase();
  const platform = key.includes("instagram") ? "instagram" : key.includes("tiktok") ? "tiktok" : key.includes("youtube") ? "youtube" : null;
  const url = info.webpage_url ?? info.original_url ?? "";
  const parsed = parseReelUrl(url);
  const prefix = { instagram: "ig", tiktok: "tt", youtube: "yt" }[platform ?? parsed?.platform] ?? "local";
  e.platform = parsed?.platform ?? platform ?? "instagram";
  e.id = parsed && !parsed.short ? parsed.id : `${prefix}-${idPart(info.id ?? info.display_id) || "unknown"}`;
  e.url = parsed && !parsed.short ? parsed.url : String(url);
  const clean = (s) => String(s ?? "").replace(/^@/, "").trim();
  if (e.platform === "instagram") e.creator = clean(info.channel || info.uploader_id || info.uploader);
  else if (e.platform === "tiktok") e.creator = clean(info.uploader || info.channel || info.uploader_id);
  else e.creator = clean((isStr(info.uploader_id) && info.uploader_id.startsWith("@") ? info.uploader_id : "") || info.channel || info.uploader);
  e.postedAt = toIso(info.timestamp) ?? toIso(info.upload_date);
  e.durationSec = isNum(info.duration) ? round(info.duration, 2) : null;
  e.cover = isStr(info.thumbnail) && info.thumbnail ? info.thumbnail : null;
  e.caption = String(info.description ?? "").trim() || (isStr(info.title) && !/^Video by /i.test(info.title) ? info.title : "");
  e.stats.views = cleanCount(info.view_count);
  e.stats.likes = cleanCount(info.like_count);
  e.stats.comments = cleanCount(info.comment_count);
  e.stats.shares = cleanCount(info.repost_count);
  e.source.provider = "ytdlp";
  return finishEntry(e);
}

/** Local video file with no provider data -> ReelEntry skeleton (id local-<file slug>). */
export function localVideoToReel(fileName, { url = "", durationSec = null, now = new Date().toISOString() } = {}) {
  const e = emptyReelEntry(now);
  const parsed = url ? parseReelUrl(url) : null;
  const base = String(fileName).split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
  e.id = parsed && !parsed.short ? parsed.id : `local-${slugify(base) || "video"}`;
  e.platform = parsed?.platform ?? "instagram";
  e.url = parsed?.url ?? url;
  e.durationSec = isNum(durationSec) ? durationSec : null;
  e.source.provider = "any";
  return finishEntry(e);
}

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------

function checkStrings(obj, keys, where, errors) {
  if (!isObj(obj)) {
    errors.push(`${where} must be an object`);
    return;
  }
  for (const k of keys) if (!isStr(obj[k])) errors.push(`${where}.${k} must be a string`);
}

/** Validate a ReelEntry. Returns a list of problems (empty = valid). Unknown numbers must be null, never guessed. */
export function validateReelEntry(e) {
  const errors = [];
  if (!isObj(e)) return ["entry must be a JSON object"];
  if (!isStr(e.id) || !ID_RE.test(e.id)) errors.push(`id must look like ig-abc123, tt-123, yt-abc or local-name (got ${JSON.stringify(e.id)})`);
  if (!PLATFORMS.includes(e.platform)) errors.push(`platform must be one of ${PLATFORMS.join(", ")}`);
  if (!isStr(e.url)) errors.push("url must be a string");
  else if (e.url && !/^https?:\/\//i.test(e.url)) errors.push("url must start with https://");
  else if (!e.url && !String(e.id).startsWith("local-")) errors.push("url is required (only local- entries may have an empty url)");
  if (!isStr(e.creator)) errors.push("creator must be a string");
  if (!isIso(e.addedAt)) errors.push("addedAt must be an ISO date");
  if (!(e.postedAt === null || isIso(e.postedAt))) errors.push("postedAt must be an ISO date or null");
  if (!(e.durationSec === null || (isNum(e.durationSec) && e.durationSec >= 0))) errors.push("durationSec must be a number or null");
  if (!(e.cover === null || isStr(e.cover))) errors.push("cover must be a string or null");
  if (!isStr(e.caption)) errors.push("caption must be a string");
  if (!isObj(e.stats)) errors.push("stats must be an object");
  else {
    for (const k of ["views", "likes", "comments", "shares", "saves", "outlierScore", "engagementRate"]) {
      if (!(k in e.stats)) errors.push(`stats.${k} is missing (use null when unknown)`);
      else if (!isNumOrNull(e.stats[k]) || (isNum(e.stats[k]) && e.stats[k] < 0)) errors.push(`stats.${k} must be a number >= 0 or null`);
    }
  }
  if (!Array.isArray(e.transcript)) errors.push("transcript must be an array");
  else e.transcript.forEach((s, i) => {
    if (!isObj(s) || !isNum(s.start) || !isNum(s.end) || !isStr(s.text)) errors.push(`transcript[${i}] needs start (number), end (number), text (string)`);
    else if (s.end < s.start) errors.push(`transcript[${i}] ends before it starts`);
  });
  if (!isObj(e.hook)) errors.push("hook must be an object");
  else {
    checkStrings(e.hook, ["text", "template", "category", "whyItWorks"], "hook", errors);
    if (!isNum(e.hook.words)) errors.push("hook.words must be a number");
    if (!isNum(e.hook.seconds)) errors.push("hook.seconds must be a number");
    if (!Array.isArray(e.hook.powerWords) || !e.hook.powerWords.every(isStr)) errors.push("hook.powerWords must be an array of strings");
  }
  checkStrings(e.format, ["category", "type", "visualLayout", "pacing", "reasoning"], "format", errors);
  checkStrings(e.angle, ["topic", "angle", "commonBelief", "contrarianTake"], "angle", errors);
  if (!Array.isArray(e.visualBreakdown)) errors.push("visualBreakdown must be an array");
  else e.visualBreakdown.forEach((b, i) => {
    if (!isObj(b) || !isNum(b.t) || !isStr(b.shot) || !isStr(b.onScreenText) || !isStr(b.why)) errors.push(`visualBreakdown[${i}] needs t (number), shot, onScreenText, why (strings)`);
  });
  if (!Array.isArray(e.scrollStoppers)) errors.push("scrollStoppers must be an array");
  else e.scrollStoppers.forEach((s, i) => {
    if (!isObj(s) || !isNum(s.t) || !isStr(s.moment) || !isStr(s.why)) errors.push(`scrollStoppers[${i}] needs t (number), moment, why (strings)`);
  });
  checkStrings(e.myVersion, ["hook", "script"], "myVersion", errors);
  if (!isObj(e.source)) errors.push("source must be an object");
  else {
    if (!PROVIDERS.includes(e.source.provider)) errors.push(`source.provider must be one of ${PROVIDERS.join(", ")}`);
    if (!isIso(e.source.fetchedAt)) errors.push("source.fetchedAt must be an ISO date");
  }
  return errors;
}

/** Validate an OutlierHit. Returns a list of problems (empty = valid). */
export function validateOutlierHit(h) {
  const errors = [];
  if (!isObj(h)) return ["hit must be an object"];
  if (!isStr(h.id) || !ID_RE.test(h.id)) errors.push("id must look like ig-abc123");
  if (!isStr(h.url) || !/^https?:\/\//.test(h.url)) errors.push("url must be an https URL");
  for (const k of ["creator", "caption"]) if (!isStr(h[k])) errors.push(`${k} must be a string`);
  if (!(h.cover === null || isStr(h.cover))) errors.push("cover must be a string or null");
  if (!isNum(h.views) || h.views < 0) errors.push("views must be a number");
  for (const k of ["likes", "comments", "outlier", "engagementRate"]) if (!isNumOrNull(h[k])) errors.push(`${k} must be a number or null`);
  if (!isIso(h.postedAt)) errors.push("postedAt must be an ISO date");
  for (const k of ["hoursAgo", "viewsPerHour"]) if (!isNum(h[k])) errors.push(`${k} must be a number`);
  for (const k of ["clusters", "foundBy"]) if (!Array.isArray(h[k]) || !h[k].every(isStr)) errors.push(`${k} must be an array of strings`);
  if (typeof h.suspicious !== "boolean") errors.push("suspicious must be true or false");
  if (!HIT_PROVIDERS.includes(h.provider)) errors.push(`provider must be one of ${HIT_PROVIDERS.join(", ")}`);
  return errors;
}

const EN_HI_WORDS = new Set("the and you your is are to of for this that it in on with my me i we not do how why what if or but be can hai ka ki ke ko se mein nahi kya aur toh bhi hi tum aap ye yeh woh hota karo kar".split(" "));
const OTHER_WORDS = new Set("yang dan ini itu untuk tidak dengan kamu ada aku saya boleh tak nak kena sangat juga lagi de la el que los las para por con una del est les des und der die das ist ve bir bu ile için ne da je".split(" "));

/** True when a caption reads as English or Hindi (Devanagari or Hinglish). Other scripts and other Latin-script languages fail. */
export function isEnglishOrHindi(caption) {
  const text = String(caption ?? "").replace(/[#@][\p{L}\p{N}_.]+/gu, " ");
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  if (!letters.length) return true;
  const other = letters.filter((ch) => !(/[A-Za-z\u00C0-\u024F]/.test(ch) || (ch >= "\u0900" && ch <= "\u097F"))).length;
  if (other / letters.length > 0.2) return false;
  const words = text.toLowerCase().replace(/#\S+/g, " ").match(/[a-z\u00C0-\u024F']+/g) ?? [];
  let enHi = 0;
  let foreign = 0;
  for (const w of words) {
    if (EN_HI_WORDS.has(w)) enHi++;
    else if (OTHER_WORDS.has(w)) foreign++;
  }
  return foreign <= enHi;
}

/** True when the caption contains one of niche.excludeTerms (formats the user can't shoot, e.g. recipes or workouts). */
export function isExcluded(caption, niche) {
  const terms = niche?.excludeTerms ?? [];
  if (!terms.length) return false;
  const text = String(caption ?? "").toLowerCase();
  return terms.some((t) => termMatches(text, t));
}
