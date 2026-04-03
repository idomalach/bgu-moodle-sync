# BGU Moodle Sync

One-click download of all your BGU Moodle course materials into organized folders. Runs in your browser — no installation needed.

## What it does

- Downloads every file from all your Moodle courses (lectures, exercises, assignments, exams, syllabi)
- Organizes them into clean folders with sensible names
- Merges numbered sections (e.g. "הרצאה 1", "הרצאה 2", ... into a single "הרצאות" folder)
- Handles Google Docs/Slides/Sheets links (exports as PDF/XLSX)
- Handles Dropbox links
- Extracts ZIP archives automatically
- Removes duplicate files when both PDF and Office versions exist
- Generates a README per course listing all downloaded files
- Generates an Excel log of anything it couldn't download (with reasons)
- Supports incremental sync — after the first run, only downloads new/updated files

## What you need

1. **Chrome** (with DevTools or the [Claude in Chrome](https://claude.ai) extension)
2. **Logged into BGU Moodle** in Chrome (active SSO session)
3. Your **Moodle course IDs** — the number in the URL when you open a course: `moodle.bgu.ac.il/moodle/course/view.php?id=`**`64674`**

## Quick start (5 minutes)

### Step 1: Create your download folder

Create a folder on your computer where you want course materials to live. For example:

```
Desktop/
  שנה ג׳/
    סמסטר ב׳/
```

### Step 2: Run the engine

1. Open any page on `moodle.bgu.ac.il` in Chrome
2. Open DevTools (F12 or Cmd+Option+I)
3. Paste the entire contents of `moodle_sync.js` into the Console tab
4. Press Enter

A blue sidebar appears on the right side of the page.

### Step 3: Enter your courses

Since this is your first run, the sidebar shows a setup form. Fill in:

- **Semester identifier**: the text that appears in your course titles on Moodle (e.g. `סמ 2` for semester B, `סמ 1` for semester A)
- **Semester folder name**: the semester folder inside the year folder you'll pick (e.g. `סמסטר ב׳`)
- **Courses**: one per line, format: `COURSE_ID | Folder Name`

Example:

```
64674 | הנדסת חשמל
65670 | מימון
64660 | רגרסיה
```

Click **Save Config & Continue**.

### Step 4: Run the seed download

1. Click **Seed Run (Full)**
2. A folder picker opens — select your **year folder** (e.g. `שנה ג׳`). The engine navigates into the semester subfolder automatically.
3. Wait. The sidebar shows real-time progress. A full run of 5 courses takes about 2-3 minutes.
4. When you see `SYNC COMPLETE`, you're done.

### Step 5: Check results

Open your semester folder. You should see:

```
שנה ג׳/סמסטר ב׳/
  .moodle_manifest.json       ← tracks what's been downloaded (don't delete)
  moodle_sync_config.json     ← your courses and settings
  קבצים שלא הורדו.xlsx        ← items that couldn't be downloaded (with reasons)
  הנדסת חשמל/
    README.md
    הרצאות/
    תרגולים/
    ...
  מימון/
    README.md
    ...
```

## Updating (during the semester)

Professors upload new files throughout the semester. To grab only the new stuff:

1. Open Moodle in Chrome, paste `moodle_sync.js` in the console
2. Click **Incremental Sync**
3. Pick your year folder (the directory handle is cached after the first run, so this step is usually automatic)
4. Done — only new files are downloaded

## Next semester

1. Open `moodle_sync_config.json` in any text editor
2. Change `semesterCheck` to match the new semester (e.g. `"סמ 1"`)
3. Change `rootPath` to the new semester folder name (e.g. `"סמסטר א׳"`) — you'll pick the year folder in the directory picker
4. Replace the `courses` array with your new course IDs and folder names
5. If using the scheduled task: update `semesterAbsolutePath` to the new semester folder on your machine
6. Run Seed Run again

## Automated daily sync (optional, requires Claude Desktop)

If you use [Claude Desktop](https://claude.ai) with the Claude in Chrome extension, you can set up a scheduled task that runs the incremental sync automatically every day. Ask Claude: "set up the Moodle scheduled sync" and it will configure everything.

## Files in this repo

| File | Purpose |
|------|---------|
| `moodle_sync.js` | The sync engine (v2.3, with safety patches S1–S6 + update/removal detection). Paste into Chrome console. |
| `moodle_sync_config.json` | Your personal config (courses, paths). **Not tracked in git** — create your own. The `semesterAbsolutePath` and `syncScriptPath` fields are only used by the scheduled task — update them to match your machine. |
| `moodle_sync_spec.md` | Full technical spec with all rules and edge cases. Read this if you want to understand or modify the engine. |
| `moodle-course-setup-SKILL.md` | Claude Desktop skill file for guided setup. |

## Limitations

- **Colab notebooks** can't be downloaded automatically (Google blocks cross-origin access). The Excel log will list them — download manually from Colab.
- **BGU admin syllabi** (`bgu4u.bgu.ac.il`) require an SSO session on that domain. The engine logs these — you can download them manually by right-clicking the link on Moodle and opening in a new tab (repeat if redirected).
- **RAR files** are saved as-is (no browser-based RAR extraction). ZIP files are extracted automatically.
- **Video links** (YouTube, Zoom recordings) are skipped — they're noted in the Excel log.
- The browser's folder picker appears on the first run only. After that, the directory handle is cached in IndexedDB and reused automatically — no repeated clicks needed.

## FAQ

**Q: Can I use this on a Mac/Windows/Linux?**
A: Yes — it runs in Chrome, which works on all three.

**Q: Will this work with other universities?**
A: It's built for BGU's Moodle instance. Other Moodle installations may have different DOM structures, but the core logic (scraping sections, resolving URLs, downloading files) is the same. You'd need to update the CSS selectors in the spec and possibly the base URL.

**Q: Is my Moodle password stored anywhere?**
A: No. The engine uses your existing browser session cookie. It never sees or stores your password.

**Q: What if a download fails?**
A: Failed downloads are logged in the Excel file with the reason. The next incremental sync will retry them automatically (since they won't be in the manifest).
