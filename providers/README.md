# Data providers

This kit is not tied to any one tool. A provider only fetches raw facts about reels: the numbers, the caption, the
video, sometimes a transcript. Claude Code does all the analysis itself (hook, format, angle, visual breakdown, scroll
stoppers, your version), so a breakdown looks the same whichever provider fed it.

Pick one in `config.json`:

```json
{ "provider": "sandcastles", "searchProvider": "sandcastles" }
```

- `provider` feeds `/reel-research` (single reels): `sandcastles`, `apify`, `ytdlp` or `any`.
- `searchProvider` feeds `/outliers` (the daily niche search): `sandcastles` or `apify`.

You can mix them, for example `"provider": "ytdlp"` (free) for single reels and `"searchProvider": "apify"` for the
daily search.

| Provider | Single reels | Daily search | Transcript | Video file | Cost | Guide |
|---|---|---|---|---|---|---|
| Sandcastles (MCP) | Yes, with hook and format analysis | Yes, with real outlier scores | Yes (timed) | No | Paid plan, search is free, 1 credit per new reel analysis | [sandcastles.md](sandcastles.md) |
| Apify | Yes | Yes, through hashtags (no outlier score) | Optional paid add-on, or local Whisper | Yes | Pay per result | [apify.md](apify.md) |
| yt-dlp | Yes (public links) | No | Local Whisper | Yes | Free | [yt-dlp.md](yt-dlp.md) |
| Any other source | Yes | Yes, if your export has the fields below | Yours, or local Whisper | If you have it | Whatever your source costs | [any-source.md](any-source.md) |

## The rule every provider follows

Data comes from the provider or from files you own. Never from logging in to Instagram, never from your cookies or
browser session, never from scraping Instagram with your account. That keeps your account safe and keeps the kit on
the right side of Instagram's terms.

## The contract

### 1. Single reel (feeds `/reel-research`)

A provider must give Claude a raw JSON file in `data/raw/` and, ideally, the video in `media/<id>/video.mp4`.
`scripts/normalize.mjs` turns the raw file into a ReelEntry skeleton.

| Field | Required | Notes |
|---|---|---|
| Reel URL | Yes | Gives the id: `ig-<shortcode>`, `tt-<id>`, `yt-<id>`, or `local-<file name>` with no link |
| Creator handle | Yes | Without the `@` |
| Caption | Yes | Can be empty |
| Posted at | Recommended | ISO date. `null` if unknown |
| Duration (seconds) | Recommended | `null` if unknown (ffprobe fills it from the video when ffmpeg is installed) |
| Views, likes, comments | Recommended | Numbers or `null`. Never estimated |
| Shares, saves | Optional | Only some sources have them |
| Outlier score | Optional | Views compared to the creator's typical reel. `null` if the source doesn't know it |
| Cover image | Optional | URL or `media/<id>/cover.jpg` |
| Transcript | Optional | Timed `[{ start, end, text }]` or plain text. If missing, local Whisper makes one from the video |
| Video file | Optional but important | Needed for the frame-by-frame visual breakdown and for local transcripts |

### 2. Search results (feeds `/outliers`)

A provider must write one JSON file per query into `data/raw/search-<stamp>/`, plus one line per file in
`data/raw/search-<stamp>/queries.jsonl`:

```json
{"query":"Claude Code","cluster":"coding","file":"sandcastles-claude-code-p1.json","page":1,"provider":"sandcastles"}
```

Each reel in a result file needs:

| Field | Required | Notes |
|---|---|---|
| Reel URL and a stable id | Yes | Used to merge duplicates across queries |
| Creator handle | Yes | |
| Caption | Yes | Used to tag clusters and filter off-topic reels |
| Posted at | Yes | The 24h / 48h window depends on it |
| Views | Yes | Reels under `minViews` are dropped |
| Likes, comments | Yes | Engagement and the suspicious-reach flag |
| Outlier score | Optional | Without it, reels are ranked by views per hour |
| Cover image | Optional | Shown on the report cards |

`scripts/outliers.mjs` detects each file's shape on its own, so one folder can mix providers.

## Shapes the scripts understand

`normalize.mjs` and `outliers.mjs` auto-detect these raw shapes (field reference: [../docs/schema.md](../docs/schema.md)):

- **Sandcastles**: `search_all_videos` results (`{ videos: [...], next_cursor }` or a bare array) and
  `get_video_details` payloads.
- **Apify**: dataset items from the Instagram reel and hashtag scrapers (an array of items).
- **yt-dlp**: the `.info.json` that yt-dlp writes for a single video.

There are synthetic examples of each in `samples/`.

## Adding your own provider

Three ways, easiest first:

1. **Convert to a known shape.** Turn your tool's export into one of the shapes above (the Sandcastles search shape is
   the simplest: `{ "videos": [{ "uuid", "title", "platform_url", "thumbnail", "channel": { "handle" },
   "view_count", "like_count", "comment_count", "outlier_score", "published_at" }] }`). Drop the file into
   `data/raw/search-<stamp>/` or `data/raw/`, and every script just works. Ask Claude Code to write the converter
   for you.
2. **Write the entry directly.** For single reels, you can skip raw files and have Claude write
   `library/reels/<id>.json` straight from whatever you have, following [../docs/schema.md](../docs/schema.md). Check it
   with `node scripts/normalize.mjs --validate library/reels/<id>.json`.
3. **Add an adapter.** Copy `scripts/apify-reel.mjs` as a starting point, make it write
   `data/raw/<name>-reel-<id>.json` plus `media/<id>/video.mp4`, teach `scripts/normalize.mjs` to recognize the new
   shape, add a synthetic sample to `samples/`, and make `npm run selftest` cover it. Then add a `providers/<name>.md`
   guide like the others.

Whatever you add: keys go in `.env` only, no Instagram logins or cookies, and missing numbers stay `null`.
