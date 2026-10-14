# Data schema

Everything the kit saves is plain JSON. Two shapes matter:

- **ReelEntry**: one analyzed reel, saved as `library/reels/<id>.json`.
- **OutlierHit**: one reel in a daily outlier report, saved in `reports/<stamp>.json` as `{ "meta": {...}, "hits": [...] }`.

The code that builds and checks these lives in `scripts/lib/schema.mjs`. Check any entry with:

```bash
node scripts/normalize.mjs --validate library/reels/<id>.json
```

**Rule for numbers:** when a number is unknown, it is `null`. Never `0`, never a guess. Some sources hide views (yt-dlp on Instagram) or likes (creators can hide them), and the viewers show those as "n/a".

## Ids

| Source | Id | Example |
| --- | --- | --- |
| Instagram | `ig-` + shortcode, lowercased | `ig-abc123xyz` |
| TikTok | `tt-` + video id | `tt-7400000000000000001` |
| YouTube Shorts | `yt-` + video id, lowercased | `yt-abcdefghijk` |
| Local video with no link | `local-` + file name slug | `local-my-clip` |

Downloaded media for a reel goes in `media/<id>/` (`video.mp4`, `cover.jpg`, `transcript.json`, `frames/`).

## ReelEntry

```json
{
  "id": "ig-abc123",
  "platform": "instagram",
  "url": "https://www.instagram.com/reel/ABC123/",
  "creator": "sample.creator",
  "addedAt": "2026-10-11T09:12:00.000Z",
  "postedAt": "2026-10-10T17:40:00.000Z",
  "durationSec": 31,
  "cover": "media/ig-abc123/cover.jpg",
  "caption": "",
  "stats": { "views": 0, "likes": 0, "comments": 0, "shares": null, "saves": null, "outlierScore": null, "engagementRate": 0 },
  "transcript": [ { "start": 0.0, "end": 2.1, "text": "" } ],
  "hook": { "text": "", "words": 0, "seconds": 0, "template": "", "category": "", "whyItWorks": "", "powerWords": [] },
  "format": { "category": "", "type": "", "visualLayout": "", "pacing": "", "reasoning": "" },
  "angle": { "topic": "", "angle": "", "commonBelief": "", "contrarianTake": "" },
  "visualBreakdown": [ { "t": 0, "shot": "", "onScreenText": "", "why": "" } ],
  "scrollStoppers": [ { "t": 0, "moment": "", "why": "" } ],
  "myVersion": { "hook": "", "script": "" },
  "source": { "provider": "sandcastles", "fetchedAt": "2026-10-11T09:12:00.000Z", "transcriptTiming": "exact" }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | See Ids above. Also the file name. |
| `platform` | `instagram` / `tiktok` / `youtube` | Where the reel lives. |
| `url` | string | Canonical link (`/reel/<code>/` for Instagram). Empty only for `local-` entries. |
| `creator` | string | Handle without `@`. |
| `addedAt` | ISO date | When you added it to the library. |
| `postedAt` | ISO date or null | When the creator posted it. |
| `durationSec` | number or null | Length in seconds. |
| `cover` | string or null | Local path (relative to the repo, e.g. `media/<id>/cover.jpg`) or an https URL. Local covers are embedded into `out/library.html`. |
| `caption` | string | The original caption, for reference. |
| `stats.views` `likes` `comments` `shares` `saves` | number or null | Real numbers from the provider. Null when unknown. |
| `stats.outlierScore` | number or null | Views divided by the creator's typical (median) reel views, when the provider knows it (Sandcastles does). |
| `stats.engagementRate` | number or null | (likes + comments, plus shares and saves when known) / views. `0.0935` = 9.35%. Null without views. |
| `transcript` | array | `{ start, end, text }` in seconds. From the provider or local Whisper. |
| `hook.text` | string | The exact opening line (spoken, or on-screen text if there is no speech). |
| `hook.words` / `hook.seconds` | number | Word count, and the second the hook ends. `normalize.mjs` measures these. |
| `hook.template` | string | The hook as a reusable fill-in-the-blank, e.g. `I let [TOOL] run my [TASK] for [TIME]`. |
| `hook.category` | string | Hook type, e.g. "experiment with a twist", "callout", "news roundup". |
| `hook.whyItWorks` | string | One or two sentences on the psychology. |
| `hook.powerWords` | string[] | Words or phrases from the hook that do the heavy lifting. The library highlights them. |
| `format` | object | `category` (educational, news, story...), `type`, `visualLayout` (talking head, screen recording...), `pacing`, `reasoning`. |
| `angle` | object | `topic`, `angle`, `commonBelief` (what most people think), `contrarianTake` (what this reel argues). |
| `visualBreakdown` | array | Frame by frame: `t` (second), `shot` (what we see), `onScreenText`, `why` (why it is there). From `scripts/frames.mjs` contact sheets. |
| `scrollStoppers` | array | The moments built to stop the scroll: `t`, `moment`, `why`. |
| `myVersion` | object | Your rewrite in your voice (`voice.md`): a `hook` and a `script`. Same idea, your words. |
| `source.provider` | `sandcastles` / `apify` / `ytdlp` / `any` | Where the data came from. |
| `source.fetchedAt` | ISO date | When it was fetched. |
| `source.transcriptTiming` | `exact` / `estimated` / `none` | `exact` = Whisper timestamps. `estimated` = the provider gave text without timings (Apify) or per section (Sandcastles), so lines are spread over the duration. |

## OutlierHit

`reports/<stamp>.json`:

```json
{
  "meta": {
    "stamp": "2026-10-12-0600",
    "provider": "sandcastles",
    "windowHours": 24,
    "queries": 71,
    "rawCount": 2840,
    "keptCount": 64,
    "generatedAt": "2026-10-12T06:04:11.000Z",
    "referenceTime": "2026-10-12T06:04:11.000Z",
    "minViews": 2000,
    "widened": false,
    "attempts": [ { "windowHours": 24, "kept": 64 } ],
    "uniqueReels": 1210,
    "dropped": { "noData": 0, "lowViews": 640, "tooOld": 480, "offTopic": 26 },
    "inputDir": "data/raw/search-2026-10-12-0600",
    "files": 142
  },
  "hits": [
    {
      "id": "ig-abc123", "url": "https://www.instagram.com/reel/ABC123/", "creator": "sample.creator",
      "caption": "", "cover": "https://...", "views": 184000, "likes": 9800, "comments": 2100,
      "postedAt": "2026-10-12T03:00:00.000Z", "hoursAgo": 3, "viewsPerHour": 61333,
      "outlier": 14.2, "engagementRate": 0.0647, "clusters": ["agents"], "foundBy": ["AI agents"],
      "suspicious": false, "provider": "sandcastles"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `hoursAgo` | Hours between posting and the report time. |
| `viewsPerHour` | views / hours since posting (at least half an hour). |
| `outlier` | Provider's outlier score, or null (Apify has none). |
| `clusters` | Niche clusters whose `captionTerms` appear in the caption. |
| `foundBy` | Every search query that returned this reel. |
| `suspicious` | Over 20K views with under 1.5 likes per 1,000 views: reach without engagement, often paid. Flagged, never hidden. |
| `provider` | `sandcastles`, `apify` or `any` (your own JSON). `meta.provider` joins them with `+` when a run mixes sources. |

### Report rules

1. Window is 24 hours. If fewer than 15 reels make it, the window widens to 48 hours. Never wider.
2. Reels under `minViews` (config.json, default 2,000) are dropped.
3. The same reel found by several queries is merged into one hit; `foundBy` lists every query.
4. Off-topic reels are dropped when `niche.json` has `"dropOffTopic": true` (see below).
5. Order: outlier high to low (unknown last), then views per hour.

## Raw search files (what `scripts/outliers.mjs` reads)

One folder per run: `data/raw/search-<stamp>/` (stamp = `date +%Y-%m-%d-%H%M`). Every `.json` file in it is read and its shape is detected on its own, so one folder can mix providers.

| Shape | Looks like | Written by |
| --- | --- | --- |
| Sandcastles search | `{ "videos": [ { "uuid", "title", "platform_url", "thumbnail", "channel": { "handle" }, "view_count", "like_count", "comment_count", "outlier_score", "published_at" } ], "next_cursor" }` | Claude Code saving `search_all_videos` results as `sandcastles-<query-slug>-p<page>.json` |
| Apify items | `[ { "shortCode", "url", "caption", "ownerUsername", "videoPlayCount", "likesCount", "commentsCount", "sharesCount", "timestamp", "displayUrl", "type" } ]` | `scripts/apify-search.mjs` as `apify-<query-slug>.json` |
| Your own JSON | `[ { "url", "creator", "caption", "views", "likes", "comments", "postedAt", "cover", "outlier" } ]` | You, from any other tool or a spreadsheet export |

`queries.jsonl` in the same folder maps files to queries, one JSON object per line:

```json
{"query":"Claude Code","cluster":"coding","file":"sandcastles-claude-code-p1.json","page":1,"provider":"sandcastles"}
```

Without it, the query is guessed from the file name.

## Single reel raw files (what `scripts/normalize.mjs` reads)

| Shape | File | Becomes |
| --- | --- | --- |
| Sandcastles `get_video_details` | any `.json` | ReelEntry with hook, format, angle and transcript pre-filled from Sandcastles' analysis |
| Apify reel scraper | `data/raw/apify-reel-<id>.json` | ReelEntry with numbers (+ transcript if you paid for it) |
| yt-dlp info | `data/raw/ytdlp-<id>.json` | ReelEntry with caption, likes, comments, date (views usually hidden on Instagram) |
| Local video | `--video file.mp4` | Empty ReelEntry skeleton, id `local-<name>` |

If `media/<id>/transcript.json` (Whisper) or `media/<id>/cover.jpg` exist, `normalize.mjs` uses them.

## niche.json

```json
{
  "niche": "AI and Claude Code creators (example, replace with yours)",
  "topicTerms": ["ai", "gpt", "llm"],
  "dropOffTopic": true,
  "clusters": [
    { "id": "coding", "label": "Coding agents and dev tools", "queries": ["Claude Code"], "captionTerms": ["claude code", "cursor"], "needsTopicTerm": false }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `clusters[].queries` | What gets searched every day. For Apify they become hashtags (`"Claude Code"` -> `#claudecode`) unless you pass `--keyword`. |
| `clusters[].captionTerms` | Words that tag a reel with this cluster. A term matches at the start of a word (`mcp` matches "MCPs"); 1 and 2 letter terms (`ai`) must be the whole word. |
| `dropOffTopic` | When true, a reel needs a caption term from a cluster (or a `topicTerms` word) to stay. Keyword search is fuzzy, and this keeps random reels out. |
| `topicTerms` | The core words of your niche. |
| `clusters[].needsTopicTerm` | For broad clusters (money, news): their words alone are not enough, the caption also needs a `topicTerms` word. |

## config.json

| Field | Default | Meaning |
| --- | --- | --- |
| `provider` | `sandcastles` | Single reel research: `sandcastles`, `apify`, `ytdlp` or `any`. |
| `searchProvider` | `sandcastles` | Daily outlier search: `sandcastles` or `apify` (yt-dlp cannot search). |
| `inboxPath` | iCloud Drive `Reel Research/inbox.txt` | The text file your iPhone Shortcut appends reel links to. |
| `windowHours` / `maxWindowHours` | 24 / 48 | Outlier window and the most it may widen to (48 is the hard ceiling). |
| `minViews` | 2000 | Reels under this are dropped from reports. |
| `transcription` | `auto` | `auto` = use the provider's transcript when it has one, else local Whisper. |
| `myHandle` | empty | Your handle, optional. |
