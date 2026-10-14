# Any other source

You don't need Sandcastles, Apify or yt-dlp. Claude Code does the analysis, so it can work from whatever you already
have: a video file, an export from another tool, or numbers you copy by hand.

Set it in `config.json`:

```json
{ "provider": "any" }
```

## Option 1: a video file

Got the reel as an mp4 (your own video, a screen recording you made for study, or a file a tool gave you)? Run:

```
/reel-research path/to/video.mp4
```

Claude will:

1. transcribe it locally (`scripts/transcribe.mjs`, needs Whisper and ffmpeg),
2. cut contact sheets and look at them (`scripts/frames.mjs`, needs ffmpeg),
3. ask you once for anything a video file can't tell it: the link, the creator, and the views, likes and comments if
   you know them,
4. write the breakdown and your version, and save it to the library.

The skeleton comes from `node scripts/normalize.mjs --video path/to/video.mp4 [--url <link>] --write`. With no link the
reel gets an id like `local-my-video`. Numbers you don't know stay empty (`null`). The breakdown still works, the
numbers card just shows what is missing.

Install the tools once:

```bash
brew install ffmpeg            # Mac (Linux: sudo apt install ffmpeg)
pipx install openai-whisper    # transcripts, downloads its model on first use
```

## Option 2: just the link and the numbers

No video and no tool? Paste the link and tell Claude what you see on the reel:

```
/reel-research https://www.instagram.com/reel/XXXX/  views 120K, likes 8.1K, comments 340, creator @sample.creator
```

Without the video Claude can't do the transcript or the frame-by-frame breakdown, so it works from the caption and what
you paste (you can paste the transcript too). For the full breakdown, add a video file (option 1) or switch provider.

## Option 3: bring your own JSON (another tool's export)

Many tools export reels as JSON or CSV. Convert the export into a shape the scripts already read and everything works,
including `/outliers` reports. Claude can write the converter for you: "convert `exports/my-tool.csv` into the
Sandcastles search shape for an outlier run".

### For outlier reports

Put one file per search into `data/raw/search-<stamp>/` (stamp like `2026-10-12-0900`) using this shape. It is the
Sandcastles search format, the simplest one the scripts understand (the values below are made up):

```json
{
  "videos": [
    {
      "uuid": "any-unique-id-1",
      "title": "The caption of the reel",
      "platform_url": "https://www.instagram.com/reel/XXXX/",
      "thumbnail": "https://example.com/cover.jpg",
      "channel": { "handle": "sample.creator" },
      "view_count": 48200,
      "like_count": 3100,
      "comment_count": 212,
      "outlier_score": null,
      "published_at": "2026-10-12T06:30:00"
    }
  ],
  "next_cursor": null
}
```

- `published_at` is UTC without a zone, like Sandcastles uses.
- `outlier_score` is views compared to the creator's usual reel. Use `null` if your tool doesn't have it, and the
  report ranks by views per hour instead.

Add one line per file to `data/raw/search-<stamp>/queries.jsonl` so the report knows which search found each reel:

```json
{"query":"my search words","cluster":"coding","file":"mytool-my-search-words.json","page":1,"provider":"any"}
```

Then build the report:

```bash
node scripts/outliers.mjs --in data/raw/search-<stamp> --open
```

### For single reels

Save your tool's data for one reel as JSON in `data/raw/`, then ask Claude to `/reel-research` it. If the shape is one
the scripts know (Sandcastles, Apify or yt-dlp, see `samples/`), `normalize.mjs` handles it. If not, Claude reads it and
writes `library/reels/<id>.json` directly following `docs/schema.md`, then checks it with
`node scripts/normalize.mjs --validate library/reels/<id>.json`.

## Rules

- Only use data you are allowed to have. No logins to Instagram, no cookies, no scraping with your account.
- Never invent numbers. Unknown stays `null`.
- Study the reel, then make your own. Never repost someone else's video.
