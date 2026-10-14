# yt-dlp (free, single reels)

[yt-dlp](https://github.com/yt-dlp/yt-dlp) is a free, open source command-line downloader. It fetches a public video
and its basic details (creator, caption, likes, comments, duration) from a link, with no account and no API key. The
kit runs it for you, then transcribes locally with Whisper and cuts frames with ffmpeg.

Best for: researching single reels for free. It works with public Instagram, TikTok and YouTube Shorts links.

Not for: the daily outlier search. yt-dlp can't search a niche, so `/outliers` needs Sandcastles or Apify
(`searchProvider` in `config.json`).

## Install

```bash
brew install yt-dlp          # Mac (Homebrew)
pipx install yt-dlp          # Mac or Linux with pipx
```

Also install ffmpeg (frames, and merging some video formats) and Whisper (transcripts):

```bash
brew install ffmpeg                    # Mac
sudo apt install ffmpeg                # Linux
pipx install openai-whisper            # Whisper, downloads its model on first use
```

Prefer whisper.cpp (faster on a Mac)? `brew install whisper-cpp`, plus one model file.
`node scripts/transcribe.mjs --help` shows where it looks for the model.

Keep yt-dlp updated. Sites change often and old versions stop working: `brew upgrade yt-dlp` or
`pipx upgrade yt-dlp`.

Then set it in `config.json`:

```json
{ "provider": "ytdlp" }
```

## How the kit uses it

```bash
node scripts/ytdlp-reel.mjs <url> [<url> ...] [--no-video]
```

For each link it runs yt-dlp with `--no-playlist --write-info-json --write-thumbnail --convert-thumbnails jpg`
(mp4 preferred) and saves:

| File | What |
|---|---|
| `media/<id>/video.mp4` | The video, for frames and the local transcript |
| `media/<id>/cover.jpg` | The thumbnail |
| `data/raw/ytdlp-<id>.json` | yt-dlp's info file (download links and headers stripped) |

Then `/reel-research` runs `scripts/transcribe.mjs` (local Whisper) and `scripts/frames.mjs` (ffmpeg contact sheets),
and Claude writes the breakdown. `normalize.mjs` recognizes the info file on its own.

## What you get (and what you don't)

| yt-dlp field | Library field |
|---|---|
| `webpage_url` | `url` |
| `id` | the reel id (`ig-<shortcode>`, `tt-<id>`, `yt-<id>`) |
| `channel` (the @handle on Instagram; `uploader` is the display name) | `creator` |
| `description` | `caption` |
| `like_count`, `comment_count` | `stats.likes`, `stats.comments` |
| `view_count` | `stats.views` (usually empty for Instagram, see below) |
| `duration` | `durationSec` (filled from the video with ffprobe when empty) |
| `timestamp` (unix seconds) | `postedAt` |
| `thumbnail` | `cover` |

On Instagram, yt-dlp usually returns likes and comments but **no view count and no duration**. The kit leaves views as
`null` (so engagement rate is `null` too) and reads the duration from the video. No outlier score, no shares, no saves.
If you need the real view count for a reel, add it by hand in `library/reels/<id>.json` or research that one reel with
Sandcastles or Apify.

## When Instagram blocks it

Instagram sometimes answers yt-dlp with "login required" or a rate limit, especially after many downloads in a row.
The script prints a plain message when that happens. Then:

1. wait a while and try again later, or
2. research that reel with another provider (Sandcastles or Apify), or
3. use the any-source path with a video file you already have (`providers/any-source.md`).

## Never give yt-dlp your cookies

yt-dlp has options to use your browser cookies or an Instagram login. **Don't.** The kit never passes them and has no
flag for them. Automated downloads tied to your account can get that account restricted or banned. If a reel only
works when you are logged in, use another provider for it.

## Use it fairly

yt-dlp reads public pages without an account, but Instagram's terms don't welcome automated downloading, so keep it
light: a handful of reels you want to study, not bulk downloads. The video stays on your computer for analysis. Never
re-upload, repost or reuse someone else's footage. Take the idea and make your own video.
