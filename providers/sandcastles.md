# Sandcastles (MCP)

[Sandcastles](https://sandcastles.ai) is a short-form video research platform. It indexes reels across Instagram,
TikTok and YouTube Shorts, scores every video against the creator's usual numbers (the outlier score), and can analyze a
video's hook, format, angle and transcript. It connects to Claude Code as an MCP server, so Claude calls it directly.
No scripts, no API key in `.env`.

Best for: the daily outlier search (real outlier scores, free searches) and fast reel breakdowns with a timed transcript.

## Cost

The MCP needs a paid plan: Pro, Visionary or Titan (the Starter plan doesn't include it). Prices on sandcastles.ai in
October 2026:

| Plan | Monthly | Billed yearly | Credits per month |
|---|---|---|---|
| Pro | $49 | $39 | 100 |
| Visionary | $99 | $79 | 250 |
| Titan | $499 | $399 | 1,500 |

Unused credits expire at the end of each month. Check [sandcastles.ai](https://sandcastles.ai) for current prices.

What uses credits in this kit:

| Action | Tool | Credits |
|---|---|---|
| Daily outlier search | `search_all_videos` | Free |
| Fetch a reel's details | `get_video_details` | Free |
| Analyze a reel | `analyze_video` | 1 credit per reel that is new to your workspace. Free if it is already in your library |

So `/outliers` costs nothing, and `/reel-research` costs 1 credit per new reel.

## Connect it to Claude Code

From Sandcastles' own setup guide (help.sandcastles.ai, "How to set up the Sandcastles MCP in Claude"). Pick one:

**A. Already connected on claude.ai?** Connectors you added in Claude (for example from
`claude.ai/directory/sandcastles`) are available in Claude Code too. Run `/mcp` inside Claude Code and check that
Sandcastles is listed.

**B. Official plugin**, inside Claude Code:

```
/plugin marketplace add sandcastles-ai/plugins
/plugin install sandcastles@sandcastles
```

Sign in with your Sandcastles account when prompted.

**C. Manual**, in your terminal:

```bash
claude mcp add --transport http sandcastles https://mcp.sandcastles.ai/
```

Then start Claude Code, run `/mcp`, choose Sandcastles and sign in.

Check it worked: ask Claude "check my Sandcastles connection". It calls `check_connection` and shows your workspace.

Tool names: Claude Code prefixes MCP tools by how you connected them (for example
`mcp__sandcastles__search_all_videos` or `mcp__claude_ai_Sandcastles__search_all_videos`). The skills only care about
the last part (`search_all_videos`, `analyze_video`, `get_video_details`, `check_connection`).

Then set it in `config.json`:

```json
{ "provider": "sandcastles", "searchProvider": "sandcastles" }
```

## The tools this kit uses

| Tool | Used by | How |
|---|---|---|
| `analyze_video` | `/reel-research` | `url` = the reel link. Returns right away with `status: "still_analyzing"` and a `video_uuid` |
| `get_video_details` | `/reel-research` | `video_uuid`. Poll every 30 seconds until `analyzed` is `true`. Returns the numbers plus the full analysis |
| `search_all_videos` | `/outliers` | `query`, `platform: "instagram"`, `lookback_days: 2`, `sort: "published_at"`, `min_views`, `limit: 100`, `cursor` for page 2 |
| `check_connection` | `/research-setup` | Confirms the MCP is connected |

Results are saved to disk exactly as returned: `data/raw/sandcastles-reel-<id>.json` for one reel,
`data/raw/search-<stamp>/sandcastles-<slug>-p<page>.json` for searches. The scripts read Sandcastles' own field names.

## Field mapping

### Search results (`search_all_videos`) -> outlier report

| Sandcastles field | Report field |
|---|---|
| `platform_url` | `url` (and the `ig-<shortcode>` id) |
| `channel.handle` | `creator` |
| `title` | `caption` |
| `thumbnail` | `cover` |
| `view_count`, `like_count`, `comment_count` | `views`, `likes`, `comments` |
| `outlier_score` | `outlier` |
| `published_at` (UTC, no zone, e.g. `2026-09-13T15:32:37`) | `postedAt`, `hoursAgo`, `viewsPerHour` |
| `spoken_hook_category`, `format_category`, `topic` | extra context for the chat read (often empty until a video is analyzed) |

### Reel details (`get_video_details`) -> library entry

| Sandcastles field | Library field |
|---|---|
| `platform_url`, `channel.handle`, `title`, `thumbnail`, `published_at` | `url`, `creator`, `caption`, `cover`, `postedAt` |
| `view_count`, `like_count`, `comment_count`, `outlier_score` | `stats.views`, `stats.likes`, `stats.comments`, `stats.outlierScore` |
| `analysis.narrative_structure.structure_sections[]` (`start_second`, `end_second`, `transcript_sentences`) | `transcript[]` |
| `analysis.spoken_hook` | `hook.text` |
| `analysis.spoken_hook_madlib` | `hook.template` |
| `analysis.spoken_hook_category` | `hook.category` |
| `analysis.hook_alignment` | input for `hook.whyItWorks` |
| `analysis.format_category`, `analysis.format_type`, `analysis.format_reasoning` | `format.category`, `format.type`, `format.reasoning` |
| `analysis.visual_layout_category`, `analysis.visual_layout_type` | `format.visualLayout` |
| `analysis.topic`, `analysis.angle`, `analysis.common_belief`, `analysis.contrarian_reality` | `angle.topic`, `angle.angle`, `angle.commonBelief`, `angle.contrarianTake` |

Sandcastles' analysis is a starting point. Claude still writes `whyItWorks`, the power words, the visual breakdown,
the scroll stoppers and your version itself.

Not in the payload: shares, saves, the duration and a video file. Shares and saves stay `null`. The duration comes from
the video (ffprobe) or the end of the last transcript section. For the frame-by-frame pass, `/reel-research` fetches
the video with yt-dlp (free) or Apify if either is set up. If neither is, Claude works from Sandcastles' visual
analysis and the cover, and tells you so.

## Rate limits

Search is free, but Sandcastles limits bursts. A burst of about 60 searches inside one minute returns `rate_limited`.
The `/outliers` skill paces itself:

- at most 3 search calls at a time, then a 3 second pause,
- on `rate_limited`, wait 15 seconds and retry (up to 3 times),
- for a big niche, split the queries across 2 to 4 subagents rather than firing them all at once,
- build the report from whatever is already on disk, and rebuild when the rest arrives.

A full run of about 70 queries usually finishes in 5 to 15 minutes.

## TikTok and YouTube Shorts

Sandcastles covers both. `/reel-research` accepts TikTok and Shorts links when the provider is Sandcastles. For a TikTok
or Shorts outlier run, change `platform` in the `/outliers` skill to `tiktok` or `youtube-shorts`.

## Troubleshooting

- **Claude says it has no Sandcastles tools.** The MCP isn't connected in this session. Run `/mcp`. If Sandcastles is
  missing, use option B or C above, then restart Claude Code.
- **Signed out.** Run `/mcp`, choose Sandcastles, sign in again.
- **`analyze_video` keeps saying still analyzing.** New reels can take a few minutes. The skill polls for about
  5 minutes, then stops and tells you. Run it again later.
- **Off-topic reels in search.** Search is fuzzy (a query like "AI agent" can return a football club). The report
  filters by `captionTerms` and `topicTerms` in `niche.json`. Tighten them.
- **Out of credits.** Searches still work. Single-reel research can switch to yt-dlp or Apify for the rest of the
  month (`"provider": "ytdlp"` in `config.json`).
