# Apify

[Apify](https://console.apify.com/sign-up?fpr=f7e9d) is a cloud platform full of ready-made scrapers called actors. The
kit uses two official Apify actors: one for single reels, one for the daily niche search. Apify collects the public data
on its side. Your Instagram account is never involved.

Best for: single reels with the video file included, and a daily search through hashtags, pay as you go with no
monthly plan.

## Cost

New accounts get **$5 of free credit every month** on the free plan, which covers a lot of research with this kit.
Prices below are from the actors' pricing in October 2026 (they get cheaper on higher Apify plans). Check the actor page
for current prices.

| What | Actor | Price (free plan -> top plan) |
|---|---|---|
| One reel | `apify/instagram-reel-scraper` | $0.001 per run + $0.0026 -> $0.0004 per reel |
| Transcript add-on (optional) | same | $0.048 -> $0.01 per started minute of audio |
| Niche search | `apify/instagram-hashtag-scraper` | $2.60 per 1,000 results on free, $2.30 on Starter, down to $1.40 |

What that means in practice:

| Run | Rough cost |
|---|---|
| One reel, transcript by local Whisper (default) | under 1 cent |
| One 42 second reel with Apify's transcript add-on (real test run) | about 5 cents |
| A full daily `/outliers` run: 71 queries x 10 results | up to 710 results, about $1.65 to $1.85 |
| The same run with `--limit 5` | about half that |

Before a search, `node scripts/apify-search.mjs --dry-run` prints the hashtags and the estimate without spending
anything. `--max-usd` sets a hard cap per run.

## Set up your token

1. Create a free account: [console.apify.com/sign-up](https://console.apify.com/sign-up?fpr=f7e9d).
2. Open **Settings > API & Integrations** ([console.apify.com/settings/integrations](https://console.apify.com/settings/integrations))
   and copy your **Personal API token**.
3. In the kit folder:

```bash
cp .env.example .env
```

4. Open `.env` and paste the token after `APIFY_TOKEN=`. (Or run `/research-setup` and Claude does steps 3 and 4.)

`.env` is gitignored. The token never goes in `config.json` or any other file, and the scripts send it only as an
`Authorization: Bearer` header, never in a URL.

Then set it in `config.json`:

```json
{ "provider": "apify", "searchProvider": "apify" }
```

## Single reels

```bash
node scripts/apify-reel.mjs <url> [<url> ...] [--transcript] [--no-video]
```

- Runs `apify/instagram-reel-scraper` with the reel link as input (`username: ["https://www.instagram.com/reel/<code>/"]`).
- Saves the result to `data/raw/apify-reel-<id>.json`, downloads the video to `media/<id>/video.mp4` and the cover to
  `media/<id>/cover.jpg` right away (Apify's media links expire after a few days).
- `--transcript` turns on Apify's paid transcript add-on (`includeTranscript`). Off by default, because local Whisper
  is free and gives exact timings. Apify's transcript is plain text with no timings, so the kit spreads it over the
  video and marks the timings as estimated.
- `--no-video` skips the video download (no frame-by-frame breakdown then).
- A run takes about 15 to 20 seconds per reel.

## Daily niche search

```bash
node scripts/apify-search.mjs [--limit 10] [--clusters coding,models] [--keyword] [--max-usd 5] [--dry-run] [--stamp <stamp>]
```

- Runs `apify/instagram-hashtag-scraper` with `resultsType: "reels"`. Every query in `niche.json` becomes one hashtag,
  lowercase with spaces removed (`Claude Code` -> `#claudecode`).
- `--limit` is results per hashtag (default 10). The free plan only gets the first page of results per hashtag.
- `--keyword` searches the raw phrase instead (`keywordSearch: true`), useful when a query is not a real hashtag.
- `--clusters` runs only some clusters from `niche.json`.
- Writes `data/raw/search-<stamp>/apify-<slug>.json` (the dataset items as returned) plus a line per file in
  `queries.jsonl`, and prints the folder. Next step: `node scripts/outliers.mjs --in <that folder> --open`.

Two things to know about Apify search results:

1. **They are recent, not newest first.** A hashtag run can include reels from 1 to 12 days ago, so the 24 hour window
   can be thin. `outliers.mjs` widens to 48 hours when fewer than 15 reels qualify (never wider), and the report says so.
2. **No outlier score.** Apify doesn't know a creator's typical views, so `outlier` is empty for Apify reels and the
   report ranks them by views per hour instead. Sandcastles is the option with real outlier scores.

## Field mapping

| Apify field | Library / report field |
|---|---|
| `shortCode` | the `ig-<shortcode>` id |
| `url` (comes back as `/p/<code>/`) | `url`, normalized to `https://www.instagram.com/reel/<code>/` |
| `ownerUsername` | `creator` |
| `caption` | `caption` |
| `timestamp` (UTC) | `postedAt` |
| `videoDuration` | `durationSec` |
| `videoPlayCount` (also `igPlayCount` in search results) | `views` |
| `likesCount` | `likes` (`-1` means the creator hides likes, stored as `null`) |
| `commentsCount` | `comments` |
| `sharesCount` | `shares` (only with Apify's paid shares add-on, which the kit leaves off) |
| `displayUrl` | `cover` (downloaded to `media/<id>/cover.jpg`) |
| `videoUrl` | downloaded to `media/<id>/video.mp4` |
| `transcript` | `transcript` (plain text, only with `--transcript`) |

## How the scripts talk to Apify

Plain HTTPS with Node's built-in `fetch`, no Apify package:

1. Start a run: `POST https://api.apify.com/v2/acts/apify~<actor>/runs` with the actor input as the body
   (and `maxTotalChargeUsd` as a cost cap).
2. Wait: `GET https://api.apify.com/v2/actor-runs/<runId>?waitForFinish=60` until the status is `SUCCEEDED`.
3. Read: `GET https://api.apify.com/v2/datasets/<datasetId>/items?clean=true&format=json`.

Running async like this means long runs never hit the 300 second limit of Apify's one-shot endpoint.

## Troubleshooting

| Message | Fix |
|---|---|
| `APIFY_TOKEN` missing | Add it to `.env` (see above) or run `/research-setup` |
| 401 | The token is wrong or was reset. Copy it again from Settings > API & Integrations |
| 402 | Out of credit or over your usage limit. Check Billing in the Apify Console |
| Few or no search results | Try `--keyword`, a broader query, or a higher `--limit` (paid plans get more than the first page) |
| Cover or video missing later | Apify's media links expire. The scripts download them right away. Re-run the reel if a file is missing |
| An `error` field on a reel | The reel is private, deleted or region-locked. Try another provider or skip it |

Other Apify actors (`apify/instagram-scraper`, `apify/instagram-search-scraper`) can do similar jobs. The kit wires up
the two above because they are built for exactly these tasks.
