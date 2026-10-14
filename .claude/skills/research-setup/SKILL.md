---
name: research-setup
description: First-run setup wizard for the Instagram research kit. Checks the computer, helps the user pick a data source (Sandcastles, Apify, yt-dlp or any other source), connects it, sets their niche search queries, fills in their voice from their own captions, walks them through the iPhone share Shortcut, and runs the self-test. Use on "/research-setup", "set this up", "setup", "get started", "first run", "change my data source", "change my niche", "update my voice", "connect Sandcastles", "add my Apify token".
---

# Research setup

A friendly, one-question-at-a-time wizard. The user is probably not a developer: run every command yourself, explain
each step in one line, and never paste a wall of text. Each step can also be run on its own ("change my niche" jumps
to Step 4).

At the end, the user should have: a working data source in `config.json`, their own `niche.json`, a filled `voice.md`,
the iPhone Shortcut saving links to the inbox, and a passing self-test.

## Step 1: check the computer

```bash
node -v; ffmpeg -version 2>/dev/null | head -1; yt-dlp --version 2>/dev/null; which whisper whisper-cli 2>/dev/null
```

- Node 18 or newer is required. If missing or older: `brew install node` (Mac) or https://nodejs.org.
- Optional, explain what each unlocks and give the install line only for what is missing:
  - ffmpeg: frame-by-frame visual breakdown. `brew install ffmpeg` (Mac) or `sudo apt install ffmpeg` (Linux).
  - Whisper: transcripts when the data source has none. `pipx install openai-whisper` (downloads its model on first
    use), or `brew install whisper-cpp` plus a model file (`node scripts/transcribe.mjs --help` shows where).
  - yt-dlp: the free single-reel source. `brew install yt-dlp` or `pipx install yt-dlp`.
- Offer to run the install for them. Do not install anything without a yes.

## Step 2: pick the data source

Explain in a few lines, then ask which they want. They are not locked in and can change it any time.

| Source | Good for | Cost | Setup |
|---|---|---|---|
| Sandcastles (MCP) | Reel breakdowns with transcript and hook analysis, plus the daily outlier search with real outlier scores. Instagram, TikTok, YouTube Shorts | Paid plan (MCP needs Pro or higher). Search is free, each new reel analysis is 1 credit | About 2 minutes |
| Apify | Reel data and video, plus the daily search through hashtags | Pay per result, see `providers/apify.md`. Free monthly credit to start | About 3 minutes |
| yt-dlp | Single reels only, free. Transcript through local Whisper | Free | 1 minute if installed |
| Any other source | Your own JSON export, a CSV from another tool, or an mp4 you have | Whatever your source costs | None |

Then write the choice to `config.json`:

- `provider`: the single-reel source (`sandcastles`, `apify`, `ytdlp` or `any`).
- `searchProvider`: `sandcastles` or `apify` for `/outliers`. If they pick yt-dlp or any-source for single reels, ask
  whether they also want the daily outlier search; if yes, it needs Sandcastles or Apify.

Edit only those keys and keep the file valid JSON.

## Step 3: connect it

**Sandcastles** (full guide: `providers/sandcastles.md`)

1. Check whether the tools are already here: call the Sandcastles MCP tool `check_connection`. If it answers, you are
   done with this step (connectors added on claude.ai already show up in Claude Code).
2. If not, the user connects it once. Claude can't do the sign-in for them. Give these lines:

```bash
claude mcp add --transport http sandcastles https://mcp.sandcastles.ai/
```

   then inside Claude Code run `/mcp`, pick Sandcastles and sign in. Or install the official plugin:
   `/plugin marketplace add sandcastles-ai/plugins` then `/plugin install sandcastles@sandcastles`.
3. They may need to restart Claude Code. After that, run `check_connection` again.

**Apify** (full guide: `providers/apify.md`)

1. If they have no account: https://console.apify.com/sign-up?fpr=f7e9d (free plan includes monthly credit).
2. Token: Apify Console -> Settings -> API & Integrations -> copy the personal API token.
3. Create `.env` from the template if it does not exist (`cp .env.example .env`) and set `APIFY_TOKEN=<their token>`.
   Write it only into `.env`. Never repeat the token back in chat, never write it anywhere else.
4. Check it works without spending anything (prints only the account name):

```bash
set -a; . ./.env; set +a; curl -s -H "Authorization: Bearer $APIFY_TOKEN" https://api.apify.com/v2/users/me | grep -o '"username":"[^"]*"'
```

**yt-dlp** (full guide: `providers/yt-dlp.md`)

1. `yt-dlp --version`. If missing, offer `brew install yt-dlp` or `pipx install yt-dlp`.
2. Say plainly: never give yt-dlp your browser cookies or Instagram login. If Instagram blocks a download, switch
   provider for that reel instead.

**Any other source** (full guide: `providers/any-source.md`)

Nothing to connect. Explain the two inputs: a JSON or CSV export they own, or an mp4 file plus the numbers they know.

## Step 4: their niche

Ask: "What is your niche in one line, and who do you make content for?" Optionally: "Name 3 to 5 topics, tools or
words that show up in the reels you want to watch."

Rewrite `niche.json` in the same shape (`niche`, `topicTerms`, `dropOffTopic`, and `clusters[]` of
`{ id, label, queries, captionTerms }`, with `needsTopicTerm: true` on broad clusters):

- 5 to 8 clusters: their core topic, the tools or methods in it, the problems their audience has, results and money,
  news, and 1 or 2 adjacent niches their audience also watches.
- 40 to 80 queries in total, phrased the way creators caption reels ("how I grew my bakery", not "bakery growth
  strategies").
- `captionTerms`: short lowercase words or word starts that prove a reel belongs to the cluster (`"bak"`, `"sourdough"`,
  `"pastry"`). They tag reels in the report and filter out off-topic results.
- `topicTerms`: the handful of core words that prove a reel is in their niche at all (for an AI niche: `"ai"`,
  `"gpt"`, `"llm"`). With `dropOffTopic: true`, reels whose caption matches no cluster term are dropped.
- `needsTopicTerm: true` on broad clusters (money, news, careers): their words alone ("money", "job") match half of
  Instagram, so a reel only counts if its caption also has a topic term. This keeps fuzzy search junk out.
- With Apify, each query becomes a hashtag (spaces removed), so prefer queries that also work as real hashtags.

Show the cluster list (labels and query counts) in a few lines and ask if anything is missing. Then save.

## Step 5: their voice

Ask for 3 of their own captions or video scripts (their words only, never someone else's). Also ask for their call to
action if it is not in the samples, and their Instagram handle (save it to `config.json` as `myHandle`, optional).

Fill in `voice.md` from the samples: who they are, who they talk to, how they open, sentence length and energy, phrases
they use, phrases to avoid, their call to action, and the samples pasted into the three sample blocks. Keep the
"Rewrite rules" section as it is. Show them the filled "How I talk" lines and ask if it sounds right.

## Step 6: the iPhone share button

Walk them through `docs/iphone-shortcut.md` one step at a time (create the Reel Research folder, build the Shortcut
"Save to Research", turn on Show in Share Sheet, test it on one reel).

When they have shared one test reel, find the file on the Mac and point `config.json` at it:

```bash
find ~/Library/Mobile\ Documents -path "*Reel Research*" -name "inbox.txt" 2>/dev/null
```

Set `inboxPath` to the path it finds (use `~` for the home folder). Then run `node scripts/inbox.mjs` and confirm their
test link shows up. On Linux or Windows there is no iCloud sync: they can keep `inbox.txt` anywhere (Dropbox, Google
Drive, a synced notes folder) and set `inboxPath` to it, or skip the inbox and paste links into `/reel-research`.

Mention the optional daily automation at the bottom of `docs/iphone-shortcut.md` (show it, do not install it unless
they ask).

## Step 7: self-test and first look

```bash
npm run selftest
node scripts/build-library.mjs --open
npm run sample-report
```

The self-test must pass (exit 0). If it fails, read the error, fix what you can (usually Node version) and run it
again. The library opens with the sample reel (marked as sample data) so they can see what a finished breakdown looks
like, and the sample report shows what `/outliers` produces. Both use synthetic data only.

## Step 8: done

Finish with a short list:

1. Research a reel: `/reel-research <link>`
2. Process the Shortcut inbox: `/reel-research inbox`
3. See what blew up in your niche today: `/outliers`
4. Your library: `out/library.html`. Your reports: `reports/`.

Remind them in one line: use the idea, write your own words, never repost someone else's video.
