# CLAUDE.md

This folder is a research kit for short-form video creators. Claude Code does the thinking: it reads a reel's data,
watches the frames, writes the breakdown and rewrites the idea in the user's voice. Small Node scripts (Node 18+,
zero npm dependencies) fetch data, cut frames, transcribe, and build the HTML viewers.

The user is usually a creator, not a developer. Talk in plain words, run the commands yourself, and explain what you
did in one or two lines.

## Read these first, every session

1. `config.json`: which data source to use and the run settings (fields below).
2. `voice.md`: how the user talks. Needed for every "my version" rewrite.
3. `niche.json`: the search queries for the daily outlier run.

If `config.json` still has the defaults and `voice.md` is still the blank template, suggest `/research-setup` first.

## Running in Claude Code cloud (this repo)

This kit runs in Claude Code cloud sessions, not on a laptop. Cloud sessions are wiped when they end, so:

- `APIFY_TOKEN` comes from the cloud environment's environment variables. There is no `.env`; never create one or ask
  for the token in chat. If it is missing, tell the user to add `APIFY_TOKEN` in the environment settings.
- The inbox is `inbox.txt` in the repo root (one reel link per line). The user adds links by editing it in the GitHub
  app or website, or pastes links straight into `/reel-research`. There is no iPhone Shortcut or iCloud path; skip
  Step 6 of `/research-setup` and the iCloud parts of `docs/iphone-shortcut.md`.
- `library/reels/`, `reports/` and `data/inbox-done.txt` are committed. `media/`, `data/raw/` and `out/` are not.
- At the end of every run that adds a breakdown or a report: run `npm run selftest`, then commit and push to `main`
  (`git pull --rebase` first). Work that is not pushed is lost.
- Viewers can't be opened from a cloud session. Instead of `--open`, publish `out/library.html` or
  `reports/<stamp>.html` as a private Artifact (re-publish the same one to keep the link) and also send the file.
- Whisper is not preinstalled: `pip install --break-system-packages openai-whisper` when a transcript is needed and
  Apify has none. ffmpeg is already in the container.

## Setup status (done in an earlier session)

- Data source: Apify for both single reels and the daily search (`config.json`). `myHandle` is `fitwithbhavika`.
- `niche.json` is set for women's fitness coaching in India (fat loss, strength, home workouts, Indian nutrition,
  PCOS/thyroid, transformations, myths and habits): 7 clusters, 66 queries, about $1.72 per full Apify search.
- The original AI-niche example lives in `samples/niche.example.json`; the self-test and `npm run sample-report` use it.
- Still to do with `/research-setup`: check `APIFY_TOKEN` is set in the environment (Step 3, cloud version),
  Step 5 voice (unless `voice.md` is already filled), Step 7 self-test.
  Skip Steps 2 and 4 unless the user asks to change them.

## config.json fields

| Field | Values | What it does |
|---|---|---|
| `provider` | `sandcastles`, `apify`, `ytdlp`, `any` | Where single-reel data comes from (`/reel-research`) |
| `searchProvider` | `sandcastles`, `apify` | Where the daily niche search runs (`/outliers`). yt-dlp can't search |
| `inboxPath` | a file path (`~` allowed) | The `inbox.txt` the iPhone Shortcut appends reel links to |
| `windowHours` | `24` | Outlier window. The script widens to `maxWindowHours` only when fewer than 15 reels qualify |
| `maxWindowHours` | `48` | Hard ceiling for the outlier window. Never wider |
| `minViews` | `2000` | Reels under this are dropped from outlier reports |
| `transcription` | `auto` | `auto` = use the provider's transcript when it has one, else local Whisper |
| `myHandle` | `""` | Optional. The user's own Instagram handle |

## Skills

| Command | Skill file | What it does |
|---|---|---|
| `/reel-research <url...>` | `.claude/skills/reel-research/SKILL.md` | Full breakdown of one or more reels, saved to the library |
| `/reel-research inbox` | same | Processes every new link the iPhone Shortcut saved |
| `/outliers [--48h]` | `.claude/skills/outliers/SKILL.md` | Runs the niche searches and builds the outlier report |
| `/research-setup` | `.claude/skills/research-setup/SKILL.md` | First-run wizard: data source, niche, voice, Shortcut, self-test |

Provider details live in `providers/`. Read the matching file before using a provider for the first time in a session:
`providers/sandcastles.md`, `providers/apify.md`, `providers/yt-dlp.md`, `providers/any-source.md`.
The provider contract (what fields every source must supply) is `providers/README.md`. Field reference: `docs/schema.md`.

## Scripts

```bash
# fetch (one per provider)
node scripts/apify-reel.mjs <url...> [--transcript] [--no-video]     # Apify: data/raw/apify-reel-<id>.json + media/<id>/
node scripts/apify-search.mjs [--limit 10] [--clusters a,b] [--keyword] [--max-usd 5] [--dry-run] [--stamp <stamp>]
                                                                      # Apify niche search -> data/raw/search-<stamp>/
node scripts/ytdlp-reel.mjs <url...> [--no-video]                    # yt-dlp: data/raw/ytdlp-<id>.json + media/<id>/

# shape and check
node scripts/normalize.mjs <raw.json> [--provider auto|sandcastles|apify|ytdlp] [--as reel|hits] [--write] [--force]
node scripts/normalize.mjs --video path/to/file.mp4 [--url <link>] [--write]   # local mp4 -> ReelEntry skeleton
node scripts/normalize.mjs --validate library/reels/<id>.json        # exit 0 = valid, else lists the problems

# media
node scripts/transcribe.mjs media/<id>/video.mp4 [--engine whisper|whisper-cpp] [--model base] [--language en]
                                                                      # -> media/<id>/transcript.json
node scripts/frames.mjs media/<id>/video.mp4 [--fps 1]               # -> media/<id>/frames/contact-01.jpg ... + index.json

# inbox, reports, viewer
node scripts/inbox.mjs [--done <url>] [--file <path>]                # list unprocessed inbox links / mark one done
node scripts/outliers.mjs [--in data/raw/search-<stamp>] [--hours 24|48] [--min-views 2000] [--open]
                                                                      # -> reports/<stamp>.json + .html
node scripts/build-library.mjs [--open]                              # -> out/library.html

npm run selftest        # offline checks on samples/, exit 0 = pass
npm run sample-report   # builds an outlier report from the synthetic samples, zero setup
```

Every script prints usage with `--help`. A missing tool or key (APIFY_TOKEN, yt-dlp, ffmpeg, Whisper) prints one line
with the fix and exits with code 2: relay that line to the user.

Stamps are `date +%Y-%m-%d-%H%M` (for example `2026-10-12-0900`). Reel ids: `ig-` plus the lowercased Instagram
shortcode, `tt-<video id>` for TikTok, `yt-<id>` for YouTube Shorts, `local-<file name>` for a local mp4 with no link.
`normalize.mjs` prints the right id.

## Where things land

```
library/reels/<id>.json        one finished breakdown per reel (ReelEntry, see docs/schema.md)
media/<id>/                    video.mp4, cover.jpg, transcript.json, frames/contact-*.jpg (gitignored)
data/raw/                      raw provider responses, kept for re-parsing (gitignored)
data/raw/search-<stamp>/       one outlier run: raw search files + queries.jsonl
data/inbox-done.txt            inbox links already processed (gitignored)
reports/<stamp>.json|.html     outlier reports
out/library.html               the library viewer (self-contained, opens from file://)
```

## Hard rules

1. **Original work only.** The library is for studying why a reel worked. "My version" keeps the topic and the idea
   and writes every line fresh in the user's voice from `voice.md`. Never reuse the creator's script, jokes, stories or
   hook wording, not even lightly reworded. Never help repost, re-upload or reproduce someone else's video, caption
   or artwork.
2. **No Instagram logins.** Never log in to Instagram, never use the user's cookies, session or browser profile, never
   pass `--cookies` or `--cookies-from-browser` to yt-dlp, never scrape Instagram with the user's account. Data comes
   only from the provider the user chose, or from files the user gives you.
3. **No secrets in the repo.** Keys live only in `.env` (gitignored) or environment variables. Never print a token,
   never write one into any other file, never commit `.env`.
4. **Any data source works.** The analysis is yours, so it is the same whatever the source. If a provider fails, say
   so in one line and offer the next option (another provider, or a file the user has). Never invent numbers: a stat
   you could not get is `null`, and you say so.
5. **Mind the user's money.** Sandcastles search is free but `analyze_video` spends 1 credit per new reel. Apify runs
   cost money per result. yt-dlp is free. Before any batch over 10 reels on a paid source, state the rough cost in one
   line. Never call `analyze_video` during an outlier run.
6. **Rate limits.** Sandcastles rate-limits bursts. At most 3 search calls per turn, `sleep 3` between turns, and on
   `rate_limited` wait 15 seconds and retry (up to 3 times). Build on whatever is already on disk instead of waiting.
7. **Missing tools are not a dead end.** No ffmpeg: skip frames and say so. No Whisper: use the provider transcript or
   ask the user to install it (`pipx install openai-whisper`, or `brew install whisper-cpp` plus a model file, see
   `node scripts/transcribe.mjs --help`). Keep going with what works.
8. **Open viewers once.** Open `out/library.html` or a report at the end of a run, not after every step.
9. **Check your work.** After changing any script, run `npm run selftest`. A breakdown is not done until
   `library/reels/<id>.json` is written, passes `node scripts/normalize.mjs --validate`, and `out/library.html` is
   rebuilt.
