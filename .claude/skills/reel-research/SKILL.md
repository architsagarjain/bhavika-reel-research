---
name: reel-research
description: Full breakdown of any Instagram reel (TikTok and YouTube Shorts too when the data source supports them). Pulls the transcript, the hook and why it works, the format, the real numbers, a frame-by-frame visual breakdown and the scroll-stopping moments, then rewrites the idea in the user's own voice and saves it to the library. Use on "/reel-research <url>", "/reel-research inbox", "research this reel", "break down this reel", "why did this reel work", "analyze this reel", "process my inbox", "add this reel to my library", or when the user pastes a reel link and wants to learn from it.
---

# Reel research

One reel in, one finished breakdown out: `library/reels/<id>.json`, shown in `out/library.html`.
The data source only supplies raw facts (numbers, caption, video, sometimes a transcript). You do the analysis, so the
breakdown has the same depth whatever the source.

## Input

- `/reel-research <url> [<url> ...]`: one or more reel links.
- `/reel-research inbox`: every link the iPhone Shortcut saved that is not in the library yet.
- `/reel-research <path/to/video.mp4>` or `<path/to/file.json>`: the "any other source" path (`providers/any-source.md`).
- Add `redo` to re-run a reel that is already in the library.

## Step 0: load settings

1. Read `config.json` (`provider`, `transcription`, `inboxPath`) and `voice.md`.
2. If `voice.md` is still the blank template, keep going but tell the user at the end that `/research-setup` will make
   "my version" sound like them.
3. Work out the id for each link: `ig-` plus the lowercased shortcode (`instagram.com/reel/ABC123/` gives `ig-abc123`).
   Strip query strings, treat `/reels/` and `/p/` like `/reel/`. For other platforms or local files, use the id that
   `node scripts/normalize.mjs` prints.
4. If `library/reels/<id>.json` already exists and the user did not say `redo`, skip that reel and say so.
5. More than 10 reels on a paid source (Sandcastles credits, Apify)? State the rough cost in one line, then continue.

## Step 1: get the raw data (by `config.provider`)

Read the matching provider file once per session for details and troubleshooting.

**sandcastles** (`providers/sandcastles.md`)
1. Call the Sandcastles MCP tool `analyze_video` with `url`. It returns `status: "still_analyzing"` and a `video_uuid`.
   It costs 1 credit for a reel that is new to the user's workspace, nothing if it is already there.
2. Wait about 30 seconds (`sleep 30`), then call `get_video_details` with that `video_uuid`. Repeat every 30 seconds
   until `analyzed` is `true` (give up after about 5 minutes and tell the user).
3. Save the full payload verbatim to `data/raw/sandcastles-reel-<id>.json`. If Claude Code saved the tool output to a
   file ("Output has been saved to <path>"), just `cp` that file there.
4. Sandcastles gives no video file. For the frame pass (Step 3), get the video with a free or keyed helper if one is
   available: `node scripts/ytdlp-reel.mjs <url>` when yt-dlp is installed, or `node scripts/apify-reel.mjs <url>` when
   `APIFY_TOKEN` is set. If neither works, do the visual breakdown from Sandcastles' visual analysis plus the cover, and
   say so in the chat summary.

**apify** (`providers/apify.md`)
1. `node scripts/apify-reel.mjs <url...>` (add `--transcript` only if the user wants Apify's paid transcript instead of
   local Whisper).
2. It writes `data/raw/apify-reel-<id>.json`, `media/<id>/video.mp4` and `media/<id>/cover.jpg`.

**ytdlp** (`providers/yt-dlp.md`)
1. `node scripts/ytdlp-reel.mjs <url...>`. Free, no account. Works for public Instagram, TikTok and YouTube Shorts links.
2. It writes `data/raw/ytdlp-<id>.json`, `media/<id>/video.mp4` and `media/<id>/cover.jpg`.
3. On Instagram, yt-dlp usually returns likes and comments but no view count. Views stay `null` (and so does
   `engagementRate`). Say so in the summary instead of guessing.
4. If Instagram blocks the download (login required or rate limited), tell the user in one line and offer another
   provider or the any-source path. Never add cookies or a login to make it work.

**any** (`providers/any-source.md`)
1. A local mp4: use its own path wherever the steps below say `media/<id>/video.mp4`. `transcribe.mjs` and
   `frames.mjs` write into `media/local-<file name>/` when there is no link. In Step 2b, build the skeleton with
   `node scripts/normalize.mjs --video path/to/file.mp4 [--url <link>] --write` instead.
2. A JSON export: save it under `data/raw/` and normalize it like the others. Unknown shape? Read it and write the
   entry yourself following `docs/schema.md`.
3. Just a link: work from what the user pastes (numbers, caption, transcript). Without a video there are no frames:
   leave `visualBreakdown` and `scrollStoppers` as `[]` unless they describe the video, and say so.
4. Ask the user once for anything you cannot see: the link, the creator, views, likes, comments. Missing numbers stay
   `null`. Never guess them.

## Step 2: transcript

`config.transcription` is `auto` by default:

1. If the provider returned a timed transcript, use it. Sandcastles: `normalize.mjs` stitches
   `analysis.narrative_structure.structure_sections[]` in order (one segment per section, `start_second`,
   `end_second`, joined `transcript_sentences`).
2. Otherwise, when there is a video file, transcribe locally before building the skeleton:
   `node scripts/transcribe.mjs media/<id>/video.mp4` writes `media/<id>/transcript.json` (`[{ start, end, text }]`,
   exact timings).
3. Only a plain untimed transcript (Apify's add-on) and no Whisper? `normalize.mjs` spreads it over the duration and
   marks `source.transcriptTiming` as `estimated`. Mention that the timings are approximate.
4. No transcript at all (no speech, or no tools)? `transcript` stays `[]`; lean on on-screen text from the frames.

## Step 2b: build the skeleton

(Local mp4 on the any-source path: use the `--video` command from Step 1 instead.)

```bash
node scripts/normalize.mjs data/raw/<provider>-reel-<id>.json --as reel --write
```

`--write` saves the skeleton to `library/reels/<id>.json`. It refuses to overwrite an existing entry unless you add
`--force`, which you only use on `redo`. The skeleton has `id`, `url`, `creator`, `postedAt`, `durationSec`, `cover`,
`caption`, `stats` and `source`, and picks up `media/<id>/transcript.json` and `media/<id>/cover.jpg` when they exist.
You fill in the analysis fields in that file in Steps 3 to 5.

Not in English? Rewrite each transcript segment in English and keep the original after it in brackets, for example
`"This changed how I work [Original ES: Esto cambio como trabajo]"`.

## Step 3: watch the video (frames)

```bash
node scripts/frames.mjs media/<id>/video.mp4
```

It writes contact sheets (`media/<id>/frames/contact-01.jpg`, 5 x 4 tiles, one tile per second by default), prints
the time range each sheet covers, and saves the same map to `media/<id>/frames/index.json`
(`{ fps, cols, rows, sheets: [{ file, from, to }] }`). Tiles read left to right, top to bottom, so tile `n` (starting
at 0) on a sheet that starts at second `from` shows second `from + n / fps`.

**Open every contact sheet with the Read tool and look at it.** Do not describe frames you have not seen. For a fast-cut
reel, rerun with `--fps 2` (the formula above still gives the right second).

From the frames, write:

- `visualBreakdown[]`: one row per shot or visual change. `t` (seconds), `shot` (what is on screen: talking head, screen
  recording, b-roll, text card, split screen), `onScreenText` (exact words on screen, `""` if none), `why` (what that
  shot does for retention).
- `scrollStoppers[]`: the 2 to 5 moments most likely to stop a thumb or keep it. `t`, `moment`, `why`. Look for: the
  first frame, big bold text, a number or result on screen, a face or angle change, a reveal, a pattern interrupt, a cut
  landing on a key word, an unexpected object, a before and after.
- `format.pacing`: count the cuts and describe it (for example `fast, about 1 cut every 1.5s`).

## Step 4: the breakdown (you write this)

Fill the rest of the ReelEntry (field reference: `docs/schema.md`):

- `hook.text`: the opening spoken line (roughly the first 3 seconds or first sentence). If there is no speech, use the
  first on-screen text.
- `hook.words`, `hook.seconds`: word count and the second the hook ends.
- `hook.template`: the hook as a reusable frame with `[BRACKETS]`, for example `Most people think [X], but [Y]`.
  Sandcastles' `spoken_hook_madlib` is a good starting point.
- `hook.category`: the hook type (curiosity gap, bold claim, contrarian, number list, secret reveal, mistake callout,
  result first, question).
- `hook.whyItWorks`: 1 to 3 sentences on the psychology: what gap it opens, who it calls out, why the first frame
  supports it.
- `hook.powerWords[]`: the words in the hook doing the heavy lifting (curiosity, authority, scarcity, contrarian,
  numbers, outcome size). Exact words from the hook only.
- `format`: `category` (educational, entertainment, story, news, review...), `type` (breakdown, list, tutorial,
  reaction, talking head, skit...), `visualLayout`, `pacing`, `reasoning` (why this format fits this idea).
- `angle`: `topic`, `angle` (the specific take), `commonBelief` (what most viewers assume), `contrarianTake` (what the
  reel says instead). Leave a field `""` if the reel has no contrarian element.
- `stats`: keep the provider numbers exactly. Unknown numbers are `null`, never estimated. `engagementRate` =
  (likes + comments, plus shares and saves when known) / views, rounded to 4 decimals, or `null` when views are
  unknown. `outlierScore` = the provider's outlier score (Sandcastles `outlier_score`), else `null`.
- `source`: `{ "provider": "<provider>", "fetchedAt": "<ISO now>" }`. `addedAt` = ISO now.

## Step 5: my version (rewrite in the user's voice)

Read `voice.md` and write `myVersion`:

- `hook`: a new opening line in the user's voice on the same topic. It can use the same hook template (a sentence frame
  is not anyone's property) but none of the original wording.
- `script`: a full spoken script about the same length as the original (match the word count within about 20%), using
  the user's examples, products and results where `voice.md` has them, ending with their call to action.

Rules, no exceptions:

1. Keep the topic and the idea. Every sentence is new.
2. Never reuse the creator's lines, jokes, stories, examples or claims. Self-check before saving: no run of 5 or more
   words may match the original transcript or caption. If one does, rewrite that line.
3. If the original makes a claim the user can't back up, leave it out.
4. Write it to be said out loud: short sentences, contractions, one idea per line.

## Step 6: save and rebuild

1. Save the finished entry in `library/reels/<id>.json` (valid JSON, every field from the schema present).
2. Check it: `node scripts/normalize.mjs --validate library/reels/<id>.json`. Exit 0 = valid. Otherwise fix every
   problem it lists and check again.
3. `node scripts/build-library.mjs` after each reel. On the last reel of the run, `node scripts/build-library.mjs --open`.
   It skips invalid entries with a warning, so a warning means go back to step 2.

## Inbox mode (`/reel-research inbox`)

```bash
node scripts/inbox.mjs
```

It prints the unprocessed links, one per line (already cleaned and deduped). Then for each link:

1. Run Steps 1 to 6 (rebuild the library without `--open` until the last one).
2. Only after `library/reels/<id>.json` is written: `node scripts/inbox.mjs --done <url>`.
3. If a link fails, do not mark it done. Note the reason and move on to the next one.

Empty inbox? Say "Inbox is empty" and stop. When run headless (`claude -p "/reel-research inbox"`), do not ask
questions: skip anything that needs the user, and list it at the end.

## Step 7: tell the user (short)

Per reel, at most 5 lines:

1. The hook and why it works (one line).
2. Format and pacing.
3. The numbers: views, likes, comments, engagement rate, outlier score if known.
4. The strongest scroll stopper and its timestamp.
5. The first line of their version.

Then one line with the library path. For an inbox run, add a count (done, skipped, failed with reasons).
