# The iPhone share button

Tap Share on any reel, tap **Save to Research**, and the link lands in a text file in iCloud Drive. Your Mac gets the
same file a few seconds later, and `/reel-research inbox` breaks down everything you saved.

Takes about 5 minutes, once. Nothing here logs in to Instagram: the Shortcut only saves the link you shared.

```
Instagram reel -> Share -> Save to Research -> iCloud Drive/Reel Research/inbox.txt -> your Mac -> /reel-research inbox
```

## 1. Make the folder

1. Open the **Files** app on your iPhone.
2. Tap **Browse**, then **iCloud Drive**.
3. Tap the **...** button (top right), then **New Folder**.
4. Name it `Reel Research`.

## 2. Build the Shortcut

Open the **Shortcuts** app and tap **+** (top right) to start a new shortcut.

1. **Name it.** Tap the name at the top, choose **Rename**, type `Save to Research`.
2. **Put it in the share sheet.** Open the shortcut's details (the **i** button, or tap the name and choose
   **Details** on newer iOS) and turn on **Show in Share Sheet**. Tap **Done**.
   A block appears at the top of the shortcut: **Receive** ... **input from Share Sheet**.
3. **Accept links only.** In that block, tap the blue input types (it may say "Any" or "Images and 18 more"), tap
   **Clear**, then select **URLs** and **Text**. (Some apps share a link as text. The next step pulls the link out.)
4. **Add "Get URLs from Input".** Tap the search bar at the bottom, type `Get URLs`, tap **Get URLs from Input**. It
   should read "Get URLs from **Shortcut Input**".
5. **Add "Append to Text File".** Search `Append`, tap **Append to Text File**. Set it up:
   - The text to append: tap it and pick the **URLs** variable (from the step above).
   - The file: the `Reel Research` folder in iCloud Drive, file name `inbox.txt`. On most iOS versions you tap the
     folder in the action and pick **iCloud Drive > Reel Research**, then type `inbox.txt`. If your version only offers
     a path, type `Reel Research/inbox.txt`. If it only lets you save inside the **Shortcuts** folder, that is fine too:
     use `Reel Research/inbox.txt` there, and setup will find it on your Mac.
   - Tap the arrow on the action to show more options and turn on **Make New Line**, so every link gets its own line.
6. **Add "Show Notification".** Search `Show Notification`, tap it, and replace the text with `Saved for research`.
7. Tap **Done**.

Your shortcut should read, top to bottom:

```
Receive URLs and Text input from Share Sheet
Get URLs from Shortcut Input
Append URLs to Reel Research/inbox.txt      (Make New Line: on)
Show notification "Saved for research"
```

The file is created the first time you use it.

## 3. Use it from Instagram

1. Open any reel and tap the **Share** button (the paper plane).
2. In the bottom row of Instagram's share panel, tap **Share to...** (on some versions it's **More**, or **Share** with
   the iPhone share icon). The iPhone share sheet opens.
3. Scroll to the list of actions and tap **Save to Research**.
4. The first time, iOS asks if the shortcut can access the file. Tap **Always Allow**.
5. You see "Saved for research". Done.

Tip: in the share sheet, tap **Edit Actions** and add **Save to Research** to your Favorites so it sits at the top.

The same button works in TikTok and YouTube (Share, then More or the share icon), so you can save Shorts and TikToks
too. Single-reel research handles them with Sandcastles, yt-dlp, or a video file.

## 4. On your Mac

Make sure iCloud Drive is on: **System Settings > [your name] > iCloud > iCloud Drive**.

The file syncs to:

```
~/Library/Mobile Documents/com~apple~CloudDocs/Reel Research/inbox.txt
```

That is **iCloud Drive > Reel Research** in Finder, and it is the default `inboxPath` in `config.json`. If you had to
save inside the Shortcuts folder, the file is here instead:

```
~/Library/Mobile Documents/iCloud~is~workflow~my~workflows/Documents/Reel Research/inbox.txt
```

Not sure where it went? This finds it (and `/research-setup` runs it for you):

```bash
find ~/Library/Mobile\ Documents -path "*Reel Research*" -name "inbox.txt" 2>/dev/null
```

Put that path in `config.json` as `inboxPath`, then in Claude Code:

```
/reel-research inbox
```

It reads the new links (`node scripts/inbox.mjs`), breaks each one down, and marks it done so it never runs twice. You
never need to clear the file by hand.

iCloud can take a few seconds to a minute to sync a new line. If a link you just saved is missing, wait and run it again.

## 5. Optional: the Mac share menu

The shortcut syncs to your Mac too (if iCloud sync is on in the Shortcuts app settings). To use it from Safari or any
app with a Share button:

1. Open **Shortcuts** on the Mac and double-click **Save to Research**.
2. Open the **Details** panel (the **i** button) and turn on **Show in Share Sheet**.
3. The first time, macOS may ask you to allow the Shortcuts share extension in System Settings. Allow it.
4. On any reel page in your browser, click **Share > Save to Research**.

Or skip the inbox on the Mac and paste a link straight into Claude Code: `/reel-research <link>`.

## 6. Optional: run it every morning by itself

Claude Code can run headless with `claude -p`. A scheduled job can process the inbox (and run the outlier radar) before
you wake up. These are examples to copy if you want them. Nothing here is installed for you.

Headless runs can't click "Allow", so pass the tools Claude may use with `--allowedTools`. Find your `claude` path with
`which claude` and replace `/path/to/instagram-research-tool` with where you cloned the kit.

**cron** (run `crontab -e` and add these lines):

```cron
# 7:30 every morning: process the inbox
30 7 * * * cd /path/to/instagram-research-tool && /path/to/claude -p "/reel-research inbox" --allowedTools "Bash,Read,Write,Edit,mcp__sandcastles" >> reports/inbox-run.log 2>&1

# 8:00 every morning: the outlier radar
0 8 * * * cd /path/to/instagram-research-tool && /path/to/claude -p "/outliers" --allowedTools "Bash,Read,Write,Edit,mcp__sandcastles" >> reports/outliers-run.log 2>&1
```

**launchd** (the Mac way, runs at the next wake if the Mac was asleep). Save as
`~/Library/LaunchAgents/local.reel-research.inbox.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.reel-research.inbox</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd /path/to/instagram-research-tool &amp;&amp; claude -p "/reel-research inbox" --allowedTools "Bash,Read,Write,Edit,mcp__sandcastles"</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>7</integer>
    <key>Minute</key>
    <integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/reel-research-inbox.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/reel-research-inbox.log</string>
</dict>
</plist>
```

Load it with `launchctl load ~/Library/LaunchAgents/local.reel-research.inbox.plist` (and `launchctl unload ...` to
stop it).

Notes:

- `mcp__sandcastles` allows every Sandcastles tool if you connected it under the name `sandcastles`. If you connected
  it through claude.ai, run `/mcp` to see the server name and use that instead. Apify and yt-dlp only need `Bash`.
- macOS protects the iCloud Drive folder. If the scheduled run can't read `inbox.txt`, give Full Disk Access to `cron`
  (or to your terminal app for launchd jobs) in **System Settings > Privacy & Security > Full Disk Access**, or move
  `inboxPath` to a folder outside iCloud.
- Paid providers spend money on every run (Sandcastles credits for new reels, Apify per result). Check the cost notes in
  `providers/` before you schedule anything.
