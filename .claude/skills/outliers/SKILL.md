---
name: outliers
description: Daily outlier radar for Instagram reels. Runs every search query in niche.json through the chosen search provider (Sandcastles MCP or Apify), keeps reels from the last 24 hours (48 hours only when the day is thin, never wider), scores them, builds a visual report and explains the top 10 with an idea angle for the user. Use on "/outliers", "/outliers --48h", "what blew up today", "what's popping in my niche", "outlier reels", "trending reels in my niche", "daily research", "run my searches".
---

# Outliers

Every query in `niche.json` -> raw results on disk -> `scripts/outliers.mjs` merges, dedupes, filters, scores and
builds `reports/<stamp>.html` -> you explain the top 10 in chat.

Raw search results always go to disk, never into your reply. The script does the counting and sorting; you do the
reading and the ideas.

## Step 0: settings and run folder

1. Read `config.json` (`searchProvider`, `windowHours`, `maxWindowHours`, `minViews`) and `niche.json`.
2. `searchProvider` must be `sandcastles` or `apify` (yt-dlp can't search). If it is missing or `ytdlp`, tell the user
   the outlier radar needs Sandcastles or Apify, point them to `/research-setup`, and stop.
3. Create the run folder and keep the stamp for every later step:

```bash
STAMP=$(date +%Y-%m-%d-%H%M); mkdir -p data/raw/search-$STAMP && echo $STAMP
```

Argument `--48h`: pass `--hours 48` to `outliers.mjs` in Step 2. Otherwise let the script decide (it starts at 24 hours
and widens to 48 only when fewer than 15 reels qualify).

## Step 1a: searches through Sandcastles (`searchProvider: sandcastles`)

Read `providers/sandcastles.md` once per session. Search is free (no credits). The limit is a per-minute rate window.

For EACH query in `niche.json` (`clusters[].queries`), call the Sandcastles MCP tool `search_all_videos` with exactly:

```
query: <the query>
platform: "instagram"
lookback_days: 2
sort: "published_at"
min_views: <config.minViews>
limit: 100
```

Saving each result (filename slug = query lowercased, every run of non-letters/digits replaced by `-`, trimmed):

- If the tool output was saved to a file by Claude Code ("Output has been saved to <path>"), copy that file:
  `cp "<path>" data/raw/search-$STAMP/sandcastles-<slug>-p1.json`. Never open or read it.
- If the result came back inline, Write it to `data/raw/search-$STAMP/sandcastles-<slug>-p1.json` as
  `{ "videos": [...], "next_cursor": ... }`. Keep every video and copy values exactly. To save space you may keep
  only these fields per video: `uuid`, `title`, `platform_url`, `sandcastles_url`, `thumbnail`, `channel`,
  `view_count`, `like_count`, `comment_count`, `outlier_score`, `engagement_rate`, `published_at`. An empty result is
  still written (`{ "videos": [], "next_cursor": null }`).
- If `next_cursor` is not null, call again with `cursor` set to it and save as `-p2.json`. Stop at page 2.

After each file, append one manifest line (one Bash call can append several):

```bash
cat >> data/raw/search-$STAMP/queries.jsonl <<'EOF'
{"query":"Claude Code","cluster":"coding","file":"sandcastles-claude-code-p1.json","page":1,"provider":"sandcastles"}
EOF
```

**Rate limit rules (hard):**

- At most 3 search calls per turn (issued together), then `sleep 3` before the next turn.
- On an error containing `rate_limited`: `sleep 15` and retry the same calls, up to 3 times. Then skip that query and
  list it at the end.
- Do not fire everything at once. A burst of about 60 searches inside a minute trips the limit.

**Keep your context clean.** A full niche (around 70 queries) is a lot of raw data. If you can launch subagents, split
the queries across 2 to 4 workers (Agent tool). Give each worker its slice of queries as JSON, the stamp, the exact
call parameters above, the saving rules and the rate limit rules, and tell it: no analysis, no summaries, never call
`analyze_video`, report back only a table of query, pages, videos per page. Without subagents, run the queries
yourself in batches of 3.

**Build on what's on disk.** If the searches are taking long, run Step 2 on whatever files exist so far, show that
report, and rerun Step 2 with the same stamp when the rest arrive.

Never call `analyze_video` during this run. It costs credits. Offer `/reel-research <url>` for any reel afterwards.

## Step 1b: searches through Apify (`searchProvider: apify`)

Read `providers/apify.md` once per session. Apify charges per result, so check the cost first (no spend):

```bash
node scripts/apify-search.mjs --dry-run
```

It prints the hashtag list and a cost estimate. Say the estimate in one line, then run:

```bash
node scripts/apify-search.mjs --stamp $STAMP --max-usd 5
```

Options: `--limit N` results per query (default 10), `--clusters coding,models` to run only some clusters,
`--keyword` to search the raw phrase instead of the hashtag, `--max-usd` to cap the spend for the run. Each query
becomes a hashtag (`Claude Code` -> `#claudecode`). The script writes `data/raw/search-$STAMP/apify-<slug>.json` plus
`queries.jsonl` and prints the folder.

Apify does not know a creator's typical views, so Apify reports have no outlier score. Reels are ranked by views per
hour instead. Say this once in the read.

## Step 2: build the report

```bash
node scripts/outliers.mjs --in data/raw/search-$STAMP --open
```

(Add `--hours 48` for `--48h`. `--min-views` can raise the floor for one run, never lower it below `config.minViews`.)

The script reads every result file in the folder (Sandcastles and Apify shapes are both detected), then:

- keeps reels posted inside the window (24h, widening to 48h only when fewer than 15 qualify, never wider),
- drops reels under `minViews`,
- merges duplicates by reel id and combines the queries that found them (`foundBy`),
- tags clusters from caption words (`captionTerms` in `niche.json`) and drops off-topic reels (`topicTerms`,
  `dropOffTopic`, `needsTopicTerm`), because search is fuzzy,
- flags suspicious reach (over 20K views with under 1.5 likes per 1,000 views): flagged, never hidden,
- sorts by outlier score (missing scores last), then views per hour,
- writes `reports/<stamp>.json` and `reports/<stamp>.html` and prints the top hits.

## Step 3: the read (chat, short)

Read `reports/<stamp>.json` (`meta` and the first 10 `hits`) and `voice.md` (who the user talks to). Then write:

1. One line: window used, reels kept out of raw results, provider, and whether the window widened.
2. The top 10, one line each: creator, views, outlier (or views per hour), hours ago, and **why it popped** (hook type,
   format, timing, topic wave). Base it on the caption and any hook or format fields in the data. Do not claim to have
   watched a video you did not watch.
3. For each of the 10, one **idea angle for the user**: the topic or format translated to their niche and audience,
   in their words. Original ideas only. Never suggest copying the creator's script, caption, hook wording or video.
4. One line on any suspicious rows worth ignoring.
5. One line pointing to the report file, and the offer: "Want a full breakdown? `/reel-research <url>`".

Keep the whole read under about 25 lines. No raw tables of every hit, the report has those.

## Troubleshooting

- Sandcastles tools missing: the MCP is not connected. See `providers/sandcastles.md` (connect, then run `/mcp`).
- `APIFY_TOKEN` missing: run `/research-setup` or add it to `.env` (see `.env.example`).
- Too few reels even at 48h: the niche queries may be too narrow. Suggest broader caption-style queries in
  `niche.json`. Never widen past 48 hours.
- Off-topic reels in the report: search is fuzzy. Tighten `captionTerms` and `topicTerms` in `niche.json`, or set
  `needsTopicTerm: true` on broad clusters.
- Want to see what a report looks like without searching? `npm run sample-report` (synthetic data).
