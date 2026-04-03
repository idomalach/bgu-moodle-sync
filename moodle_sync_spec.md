# BGU Moodle Sync — Full Specification (v3)

## Goal
Download and organize all course materials from BGU Moodle into a clean, browsable folder structure. The initial run (seed) downloads everything from scratch. Subsequent runs (incremental, scheduled daily at 4 PM) detect and download only new or changed files.

This spec is **reusable across semesters**. See "New Semester Setup" at the bottom for how to adapt it.

**Current semester:** סמסטר ב׳ (סמ 2), תשפ"ו (2025-2026).

**Important:** All courses must match the current semester. Verify the page title includes the expected semester identifier (e.g., "סמ 2") before scraping. If a course ID loads the wrong semester, search Moodle for the correct offering.

---

## Courses

| Course Name (Moodle) | Moodle ID | Folder Name |
|---|---|---|
| הנדסת חשמל ומערכות ספרתיות סמ 2 | 64674 | הנדסת חשמל |
| יסודות המימון לתעו"נ קב 1 סמ 2 | 65670 | מימון |
| מודלים של רגרסיה ליניארית סמ 2 | 64660 | רגרסיה |
| ניהול פרוייקטים סמ 2 | 63518 | ניהול פרוייקטים |
| סימולציה סמ 2 | 64673 | סימולציה |

**Folder names are manually defined** — they do not derive from the Moodle course title. To add a new course, add a row to this table with all three columns.

---

## Disk Structure

```
שנה ג׳/סמסטר ב׳/
  .moodle_manifest.json          ← sync state tracker
  קבצים שלא הורדו.xlsx           ← all skipped items, all courses
  קורסים שנה ג׳ סמסטר ב׳.xlsx    ← existing course overview, keep untouched
  הנדסת חשמל/
    README.md                    ← auto-generated course overview
    הרצאות/
      חוברת קורס חשמל ומערכות ספרתיות 2026.rar
      ...
    תרגול כיתה/
      תרגול 1.pdf
      תרגול 2.pdf
      ...
    תרגילי בית/
      תרגיל בית מספר 1.pdf
      תרגיל בית מספר 2.pdf
      ...
      פתרונות/                   ← merged from "פתרונות תרגילי בית" section
        פתרון תרגיל בית 1.pdf
        ...
    מבחנים משנים קודמות/
      מועד א 22.7.20/            ← subfolder per מועד when exam+solution exist
        מועד א 22.7.20.pdf
        פתרון מועד א 22.7.20.pdf
      מבחן ופתרון מועד א 2025.pdf ← combined files stay flat
    הגשות/                       ← Pattern B assignments
      פתרונות/                   ← only if professor uploaded solutions
  רגרסיה/
    README.md
    תרגולים/
      תרגול 1 - מבוא/            ← mod/folder → subfolder
        [child files]
      תרגול 2 - מעבדה ב-R/
        [child files]
    תרגילים/
      תרגיל 1/                   ← mod/folder for question files
        [child files]
      ...
      פתרונות/
        תרגיל 1 - פתרון
        ...
    פרויקט/
      הנחיות חלק א׳
      ...
    חומרי עזר/
      טבלת Z
      ...
  מימון/
    README.md
    ...
  סימולציה/
    README.md
    מעבדות/
      תרגול 3- התאמת התפלגות/    ← mod/folder → subfolder
        [child files]
      תרגול 4- דגימה 1           ← mod/resource → flat in section
      ...
    ...
```

**Rules:**
- Folder names mirror Moodle section titles exactly (Hebrew, as shown on course page), including parenthetical descriptions (e.g., "שיעורים (מצגות וחומרים נוספים חשובים)").
- Only create a folder if at least one file was successfully downloaded into it. No empty folders.
- No automatic `הגשות` submission folder for the user — user creates that manually if needed.
- **Syllabus exception:** Regardless of which Moodle section a syllabus file sits under (כללי, הרצאות, or any other), it is always saved to the **root folder** of the course — never inside a section subfolder. Syllabuses are the only files that behave this way.

---

## Section Merging Rules

### Numbered stem merging
If 3 or more Moodle sections share the same name differing only by a trailing number (e.g., "הרצאה 1", "הרצאה 2", "הרצאה 12"), merge all their files into a single folder named after the stem ("הרצאה"). Threshold is ≥ 3 occurrences.

**Numbering within merged folders:** When files from multiple numbered sections are merged into one folder, prefix each filename with its zero-padded original section number to preserve chronological order. Format: `"NN - original name"`. Examples:
- File "סיכום פרק 1" from "הרצאה 1" → `"01 - סיכום פרק 1"`
- File "סיכום פרק 2" from "הרצאה 2" → `"02 - סיכום פרק 2"`
- File "סיכום פרק 12" from "הרצאה 12" → `"12 - סיכום פרק 12"`

Zero-pad to match the widest number in the group (2 digits if max ≤ 99).

**Header/divider sections** (sections that contain no downloadable items — e.g., "———", "מבחנים" as a title-only section, "יחידת־הוראה N" with no items): ignore completely. They do not break a merge chain, and they do not create folders.

### Solution handling

**Homework solutions** — simple rule: all solution files for homework/assignments go into a single `פתרונות` subfolder inside the assignments folder. Whether solutions come from a separate Moodle section (e.g., "פתרונות תרגילי בית") or are mixed into the same section as the questions, they all end up in one place: `תרגילי בית/פתרונות/`.

Detection: a file whose name **starts with** "פתרון" or "solution" (case-insensitive) is a solution file. Files where "פתרון" appears mid-name (e.g., "מבחן ופתרון") are NOT standalone solutions — they stay in their parent folder.

**Exam solutions** — when an exam section contains two separate files for the same מועד (one test-only, one solution), create a subfolder for that מועד and put both inside it. Combined files like "מבחן ופתרון מועד א 2025" that contain both in one document stay flat — no subfolder needed.

If a section name starts with "פתרונות" and there's a matching parent section (e.g., "פתרונות תרגילי בית" → "תרגילי בית"), merge its files into that parent's `פתרונות/` subfolder. If no match, keep it as its own folder.

### Pattern A vs Pattern B assignments

**Pattern A:** The question PDF is a `mod/resource` on the main course page. The `mod/assign` item is just an upload portal (no file in its intro). In this case the question PDF already has a natural section folder. The `mod/assign` portal itself is silently ignored — no folder created, not logged to Excel.

**Pattern B:** The question PDF is *only* accessible by clicking into the `mod/assign` submission page (embedded as a pluginfile in the assignment intro HTML). There is no `mod/resource` on the main page for that question. In this case, all question PDFs found this way — regardless of what their individual Moodle section titles are — get consolidated into a **single `הגשות` folder** per course.

**Detection:** For every `mod/assign` item encountered, always fetch its submission page and look for `pluginfile.php` links in the intro HTML. If found → Pattern B, download to `הגשות`. If not found → Pattern A, ignore silently.

**Real example found:** In סימולציה, the assign "תרגיל בית - מונחה עצמים" contains "HW 2026B.pdf" as a pluginfile — this is Pattern B.

### Projects vs Assignments
Projects may also have their question/brief only inside a `mod/assign` page (same Pattern B situation). Distinguish from assignments by reading the section title: if it contains "פרוייקט", "פרויקט", "project", or similar → consolidate into a `פרוייקט` folder instead of `הגשות`. Usually the difference is obvious from the title. When ambiguous, prefer `הגשות`.

**Note:** Project sections often also contain `mod/resource` items (guidelines, datasets). These are NOT Pattern B — they are direct resources and go into the `פרוייקט` folder directly (the section folder IS "פרוייקט").

### פתרונות subfolder (applies everywhere)
The solution handling rules above apply to **all** section folders, including `הגשות` and `פרוייקט`. If a Pattern B assignment page contains a solution file → it goes to `הגשות/פתרונות`. Only create the subfolder when at least one solution file exists.

---

## File Naming Rules

1. Use the **Moodle display name** (not the raw server filename).
2. **PDF files** are saved **with** the `.pdf` extension. ~~(v3 originally said "without" — this was reversed after the first seed run proved that macOS cannot open extensionless files; they display as binary gibberish.)~~
3. **Non-PDF files that keep their extension:** archives (ZIP/RAR), Jupyter notebooks (.ipynb), images (PNG/JPG/GIF), code files (.py, .m, .r, .c, .R), data files (.csv, .xlsx, .xls, .json, .xml), plain text (.txt), HTML (.html), and any other non-PDF type. These are saved as-is with their original extension.
4. **Normalize** display names before saving:
   - Strip invisible Unicode characters: RTL marks (U+200F), LTR marks (U+200E), zero-width spaces (U+200B), zero-width non-joiners (U+200C), zero-width joiners (U+200D), and other Unicode control characters.
   - Strip trailing underscores, trailing dots, trailing punctuation (except closing parentheses).
   - Collapse multiple consecutive spaces into one.
   - Strip leading/trailing whitespace.
   - Replace characters illegal in filenames (`/ \ : * ? " < > |`) with `-`.
   - Examples: `"תרגול 1_"` → `"תרגול 1"`, `"פתרון מועד א  3.2.26.."` → `"פתרון מועד א 3.2.26"`, `"‏‏‏‏Examples questions"` → `"Examples questions"`
5. **Long filenames**: If a normalized filename exceeds 80 characters, shorten it to the clearest possible form — keep the most meaningful portion (course code, topic, date) and drop redundant words. Aim for clarity over completeness.
6. **Duplicate names** in the same folder: append ` (2)`, ` (3)`, etc.
7. **Merged-folder prefix**: files inside a merged folder get a `"NN - "` prefix (see Section Merging Rules above). The prefix is applied *before* duplicate detection.

---

## Download Pipeline by Item Type

### `mod/resource` (direct file attached to Moodle)
- Fetch file, inspect MIME type or extension.
- **PDF** → save with `.pdf` extension.
- **DOCX / PPTX / DOC / PPT / ODT / ODP** → convert to PDF via LibreOffice headless (`libreoffice --headless --convert-to pdf <file>`), save with `.pdf` extension.
  - **If conversion fails** → save the original file with its original extension (e.g., `.docx`). Log to Excel with reason `conversion error`.
- **ZIP / RAR** → download the archive, then **extract its contents**. Inspect the extracted files: if filenames are unclear or cryptic, rename them descriptively based on context (course name, section, content). Place the extracted files in the appropriate folder. **Delete the original archive after extraction** — the user should never see .zip or .rar files in the final output, only their contents. If extraction fails → save the archive as-is with its extension and log to Excel with reason `extraction error`.
- **Images** (PNG/JPG/GIF/BMP or `image/*` MIME) → save as-is, keep extension.
- **Code / notebooks** (.py, .m, .ipynb, .r, .R, .c, .java) → save as-is, keep extension.
- **Data files** (.csv, .xlsx, .xls, .json, .xml, .txt, .html, .css, .js) → save as-is, keep extension.
- **Video** (MP4/AVI/MOV/WMV or `video/*` MIME) → skip, log to Excel with reason `video`.
- **Other** → attempt download, save as-is with original extension. If download fails → log to Excel with reason `download error`.

### `mod/url` (external link)
**Resolution:** `mod/url` items do NOT auto-redirect. Navigating to `mod/url/view.php?id=X` shows a Moodle page with the destination link. Extract the actual target URL from the `.urlworkaround a` element on that page. Then classify by domain:
- `drive.google.com` / `docs.google.com` / `sheets.google.com` / `slides.google.com` → export as PDF. For Google Docs: use `https://docs.google.com/document/d/{ID}/export?format=pdf`. For Google Slides: use `https://docs.google.com/presentation/d/{ID}/export/pdf`. **Do NOT use `credentials: 'include'`** — Google export URLs redirect cross-origin, and credentials cause CORS failures. Use `fetch(url, { redirect: 'follow' })` without credentials. The Google Drive MCP only works for Google Docs; it fails on Slides (`MIME type` error) and Colab notebooks.
- `colab.research.google.com` → extract the file ID from the URL (e.g., `/drive/1eMFd78R5oDKbRTs-9vbg1KonFPAZl-fr`), download as `.ipynb` by **navigating to the Colab page in Chrome and extracting from `colab.global.notebook`** (see Implementation Notes). Google Drive MCP does NOT work for Colab files.
- `dropbox.com` → rewrite URL: replace `?dl=0` with `?dl=1` (or append `?dl=1`) to get direct download. Download and convert if needed. For Dropbox shared folders: navigate to the folder page in Chrome (user must be logged in), extract individual file URLs from anchor elements, then download each with `?dl=1`. Use `fetch(url, { credentials: 'include', redirect: 'follow' })` from the Dropbox tab.
- `youtube.com` / `youtu.be` / `zoom.us` / `vimeo.com` → skip, log to Excel with reason `video`.
- `sites.google.com` → **Do not simply log and skip.** Navigate to the Google Sites page, inventory all linked files (which are typically hosted on Google Drive, Slides, Docs, or Dropbox). Download those files using the appropriate method (see "External Websites and Link Rabbit Holes" in Implementation Notes). Only log the Sites page URL itself to Excel if it contains no downloadable files.
- BGU internal domains (`in.bgu.ac.il`, `iguide.bgu.ac.il`, `bgu4u.bgu.ac.il`, `moodle.bgu.ac.il/moodle/local/...`) → log to Excel with reason `BGU admin page`.
- Everything else → log to Excel with reason `external link — manual required`.

### `mod/assign` (homework/project submission portal)
- Always fetch the submission page.
- Look for `pluginfile.php` links in the assignment intro HTML.
- If found (Pattern B) → download the file(s) to the appropriate consolidated folder (`הגשות` or `פרוייקט`). Apply the פתרונות rule: solution files within the same assignment go to `הגשות/פתרונות` or `פרוייקט/פתרונות`.
- If not found (Pattern A) → silently ignore. Do NOT log to Excel — it's just a portal, not a file.

### `mod/folder`
- **Expansion:** Navigate to `mod/folder/view.php?id=X` to list all child items. Each child file appears as a link to `pluginfile.php`.
- **If the folder contains 2 or more child files:** create a subfolder named after the `mod/folder` title inside the section folder. Place all child files there.
- **If the folder contains exactly 1 child file:** place the file directly in the section folder (no subfolder).
- Apply `mod/resource` rules to each child file.
- **PDF-sibling dedup:** If a `mod/folder` contains both a PDF and a DOCX/PPTX of the same content (detected by matching base filenames, e.g., "תרגול 3.pdf" and "תרגול 3.pptx"), download **only the PDF**. Skip the Office file silently (do not log to Excel). The professor uploaded both; the PDF is the rendered version.

### Silent skips (no Excel entry needed)
`mod/label`, `mod/page`, `mod/zoom`, `mod/lti`, `mod/forum`, `mod/choicegroup` — these are UI elements or live sessions, not files. Skip without logging.

### Unknown types
Any `mod/` type not listed above → log to Excel with reason `unknown type: mod/<typename>` and the URL. Never skip silently.

---

## Cross-Section Duplicates

If the same file (same Moodle resource ID) appears in multiple sections, download it to **each** section's folder independently. Each copy gets its own manifest entry keyed by its unique resource ID, so no special handling is needed.

If a professor links the same URL or uploads an identical file under different resource IDs in different sections, treat them as separate items — download both. Deduplication is not performed.

---

## Manifest (`.moodle_manifest.json`)

Stored at `סמסטר ב׳/.moodle_manifest.json`. Keyed by course ID → resource ID.

```json
{
  "64674": {
    "courseName": "הנדסת חשמל ומערכות ספרתיות סמ 2",
    "folderName": "הנדסת חשמל",
    "lastSync": "2026-03-31T10:00:00Z",
    "items": {
      "3253468": {
        "section": "תרגילי בית",
        "sectionIndex": 6,
        "moodleName": "תרגיל בית מספר 1",
        "type": "resource",
        "status": "downloaded",
        "savedAs": "תרגילי בית/תרגיל בית מספר 1",
        "fileSize": 204800,
        "etag": "abc123",
        "downloadedAt": "2026-03-31T10:00:00Z"
      },
      "3146059": {
        "section": "תרגול כיתה",
        "sectionIndex": 5,
        "moodleName": "תרגול 1_",
        "type": "resource",
        "status": "downloaded",
        "savedAs": "תרגול כיתה/תרגול 1",
        "fileSize": 512000,
        "etag": "def456",
        "downloadedAt": "2026-03-31T10:00:00Z"
      }
    }
  }
}
```

**Status values:** `downloaded`, `converted` (original was non-PDF, converted successfully), `conversion_failed` (saved original with extension), `skipped:video`, `skipped:external`, `skipped:bgu_admin`, `skipped:error`, `skipped:unknown_type`, `removed_from_moodle`

**Update detection:** On each sync run, for IDs already in the manifest, compare `fileSize` (from HTTP `Content-Length`) and/or `etag` (from HTTP `ETag` header) against stored values. If either differs → **delete the old file on disk**, download the new version, update the manifest entry. No duplicates, no stale versions.

**Deletion detection:** If a resource ID exists in the manifest but is no longer present on the Moodle course page → **keep the local file on disk**, set status to `removed_from_moodle`, add a `removedAt` timestamp. The file stays accessible but is clearly flagged. The sync summary reports these as "removed from Moodle."

---

## "Not Downloaded" Excel (`קבצים שלא הורדו.xlsx`)

One file at the semester root, shared across all courses. **Updated on every sync run** (both seed and scheduled incremental). The scheduled daily task must update this file each time it finishes, reflecting any new skipped items discovered.

| Column | Description |
|---|---|
| Course | Course short name (e.g., "הנדסת חשמל") |
| Section | Moodle section title the item sits under |
| Name | Moodle display name of the item |
| URL | Full URL of the item or its destination |
| Reason | Standardized reason (see below) |
| Date | Date the item was first logged |

**Standardized reasons:** `video`, `external link`, `BGU admin page`, `conversion error`, `download error`, `unknown type: mod/<xyz>`

---

## Course Overview (`README.md`)

Each course folder contains an auto-generated `README.md` that serves as a table of contents. It is regenerated on every sync run (seed or incremental). Format:

```markdown
# הנדסת חשמל ומערכות ספרתיות
Last synced: 2026-03-31

## הרצאות (3 files)
- חוברת קורס חשמל ומערכות ספרתיות 2026.rar
- חוברת תרגילים 2026.pdf
- סיליבוס 2026.pdf

## תרגול כיתה (12 files)
- תרגול 1.pdf
- תרגול 2.pdf
- ...

## תרגילי בית (13 files)
- תרגיל בית מספר 1.pdf
- תרגיל בית מספר 2.pdf
- ...
- פתרונות/ (merged from "פתרונות תרגילי בית")
  - פתרון תרגיל בית 1.pdf
  - פתרון תרגיל בית 2.pdf

## מבחנים משנים קודמות (15 files)
- מועד א 22.7.20/
  - מועד א 22.7.20.pdf
  - פתרון מועד א 22.7.20.pdf
- מבחן ופתרון מועד א 2025.pdf
```

**Rules:**
- List every downloaded file in its on-disk location.
- Show subfolders (פתרונות, mod/folder subfolders, exam groupings) as nested entries.
- For merged sections, note the original section range in the heading.
- For solution sections merged into parent, note "(merged from [original section name])".
- Include file count per section.
- Do not list skipped items (those are in the Excel file).

---

## Technical Download Mechanism

- **BGU blocks `curl`** — all Moodle file downloads must go through browser JavaScript with the active session cookie.
- Use `fetch(url, { credentials: 'include' })` in browser JS to retrieve `pluginfile.php` URLs as blobs.
- Use `showDirectoryPicker()` **once** at the start of each session to get a writable directory handle for the semester folder.
- Loop through all new/updated file URLs, fetch each as a blob, write to the correct subfolder path using the File System Access API. No per-file button clicks needed after the initial folder grant.
- **Google Drive files:** handled via the Google Drive MCP (only works for Google Docs/Sheets/Slides — NOT for Colab notebooks or arbitrary Drive files).
- **Colab notebooks:** must be downloaded via browser. Open the Colab URL in a Chrome tab, wait for the notebook model to load (`colab.global.notebook.cells.length > 0`), then extract cell content via JS and build an .ipynb JSON. See Implementation Notes for full code. For batch downloads, open multiple Colab tabs and use `BroadcastChannel` to collect all notebooks into one tab for a single `showDirectoryPicker()` save.
- **LibreOffice conversion:** runs in the Linux VM. Command: `libreoffice --headless --convert-to pdf <inputfile>` — available in the Cowork environment. If the command exits with a non-zero code or produces no output file → conversion has failed.
- **Batch downloads preferred:** Always batch file downloads into a single `showDirectoryPicker()` session whenever possible. Never default to downloading files one-by-one when a batch approach exists. For Colab notebooks, open all tabs simultaneously and use `BroadcastChannel` to collect them. For Moodle files, loop through all URLs in one JS execution. For Google exports, queue all URLs and save in one batch. The user should only need to click the folder picker once per download session.

---

## Sync Modes

### Seed Run (first time)
1. Delete all existing downloaded files in `סמסטר ב׳/` (except `.moodle_manifest.json`, the xlsx files, and this spec file).
2. For each course: load course page. **Verify the page title contains "סמ 2".**
3. Scrape all sections and item IDs from DOM.
4. Identify and group sections for merging (numbered stem rule, solution section merging). Ignore header/divider sections.
5. For each `mod/assign`: fetch submission page to detect Pattern A vs Pattern B.
6. For each `mod/folder`: expand to list child items. Detect PDF-sibling duplicates.
7. Download all files according to pipeline rules.
8. Build manifest from scratch.
9. Write initial `קבצים שלא הורדו.xlsx`.
10. Generate `README.md` for each course folder.
11. Print sync summary.

### Incremental Run (subsequent syncs)
1. For each course: load course page, scrape current section + item IDs.
2. Read manifest. Compute diff: new IDs = current IDs − manifest IDs.
3. For existing IDs: check ETag/size for updates.
4. For manifest IDs not found on Moodle: mark as `removed_from_moodle` (keep file on disk).
5. Download only new + updated files.
6. Append new skipped items to Excel (don't duplicate existing rows).
7. Update manifest.
8. Regenerate `README.md` for each course folder.
9. Print sync summary.

### Sync Summary (printed after every run)
```
Sync complete — 2026-03-31
  הנדסת חשמל:     3 new, 0 updated, 1 skipped, 0 removed from Moodle
  מימון:          1 new, 0 updated, 0 skipped, 0 removed from Moodle
  רגרסיה:         0 new, 1 updated, 0 skipped, 0 removed from Moodle
  ניהול פרוייקטים: 2 new, 0 updated, 1 skipped, 0 removed from Moodle
  סימולציה:       0 new, 0 updated, 0 skipped, 0 removed from Moodle
קבצים שלא הורדו.xlsx updated with 2 new entries.
```

---

## Observed Course Structures (from audit on 2026-03-31)

This section documents the actual structure found on each course page to guide implementation. Each course has different quirks.

### הנדסת חשמל (64674)
- Sections: מבוא, הרצאות, תרגול כיתה (12 resources), תרגילי בית (resource + assign pairs = Pattern A), פתרונות תרגילי בית (separate section → merge into תרגילי בית/פתרונות)
- Naming quirks: trailing underscores ("תרגול 1_"), underscores as separators ("תרגול 3_מתחי צמתים" — keep, only strip trailing)
- Many empty sections (יחידת־הוראה N) — ignore
- URL: "סילבוס מינהל תלמידים" → bgu4u.bgu.ac.il → BGU admin page

### מימון (65670)
- Clean structure: חומר עזר, מצגות, תרגילי כיתה, תרגילי בית - להגשה, הגשת תרגילים (Pattern A — assigns in separate section, no files inside)
- Only 2 lectures uploaded so far (semester just started)
- Several empty sections: מבחנים לדוגמה, פורום הקורס, מועדי א/ב תשפד, תגבורים

### רגרסיה (64660)
- **Heavy mod/folder usage**: each tutorial is a folder with multiple files (handouts, R scripts, data). Use folder title as subfolder.
- Assignments: [folder] for question, [assign] for submission portal (Pattern A variant — question is in folder, not resource), [resource] for solution
- **PDF-sibling dedup relevant here**: folders likely contain both .pptx/.docx and .pdf versions
- Project section has: guidelines (resource), datasets (resource), submission portals (assign), forums
- Dataset files: "Dataset - song_popularity" — likely CSV, download as-is
- URL in חומרי עזר: "לוח התפלגויות ממוחשב" — external link
- URL: "סילבוס מינהל תלמידים" → bgu4u.bgu.ac.il → BGU admin page

### ניהול פרוייקטים (63518)
- 36 academic papers in "מאמרים" section — all mod/resource, likely PDFs
- English filenames with very long paper titles (may need truncation awareness)
- **Invisible Unicode RTL marks** in some filenames ("‏‏‏‏Examples questions S12024") — must strip
- Only 2 lectures and 1 assignment so far
- "TBD" section — empty, ignore

### סימולציה (64673)
- **Heavy URL usage**: 6+ tutorials are Google Colab links (colab.research.google.com/drive/...) → download via Drive MCP as .ipynb
- Mixed item types in "מעבדות" section: URLs (Colab), folders, resources — all for different tutorials
- Pattern B confirmed: "תרגיל בית - מונחה עצמים" assign contains "HW 2026B.pdf" as pluginfile
- URLs: "אתר הקורס" → sites.google.com (log as external), "אפליקציה" → external app with JWT
- URL: "סילבוס מינהל תלמידים" → bgu4u.bgu.ac.il → BGU admin page
- "תרגול 11" appears twice: once as URL (Colab) and once as resource — both should be downloaded (different content)
- Combined exam+solution naming: "מבחן ופתרון, מועד א' סמסטר א' 2020" — stays flat

---

## Scheduled Daily Sync (4 PM)

A scheduled task runs every day at 4:00 PM (16:00) and performs an incremental sync of all courses. This time is chosen because the user is likely at their Mac with Claude Desktop and Chrome extension active — both are required for the sync to work.

### What the scheduled task does
1. Open each course page in Chrome (via Chrome extension) using the stored Moodle IDs.
2. **Session check:** If the page redirects to SSO/login instead of the course page, the sync cannot proceed. Log the failure: "Moodle session expired — manual login required." Do NOT attempt to enter credentials.
3. For each accessible course: scrape current sections and item IDs, compare against the manifest, detect new/updated/removed items.
4. Download new and updated files using browser JS (`fetch` with session cookie).
5. Update the manifest, append to the Excel log, regenerate README.md files.
6. Print the sync summary.

### What the scheduled task does NOT do
- It does not perform the initial seed run (that's manual).
- It does not log in to Moodle — it relies on an existing browser session.
- It does not delete files — removed items are flagged in the manifest only.
- It does not ask for confirmation — new files are downloaded automatically and silently.

### Prerequisites
- **Claude Desktop** must be running on the Mac.
- **Chrome** must be open with the Claude in Chrome extension active.
- The user must be **logged into Moodle** in Chrome (SSO session active).

### Session management
BGU Moodle sessions rely on SSO (Shibboleth). The browser session typically lasts several days if Chrome stays open. If the session expires, the scheduled task detects this (login redirect instead of course page) and reports it without crashing. The user then manually logs in once, and the next scheduled run picks up where it left off.

### Failure handling
- If a single course fails (timeout, unexpected page structure), log the error and continue with the remaining courses. Never let one failure stop the entire sync.
- If ALL courses fail (likely a session issue), report it as a session expiry.
- The sync summary always reflects what happened, including partial failures.

---

## Self-Documenting Process

**Instruction for the executing chat:** As you implement and run this spec, you WILL encounter implementation details, selectors, workarounds, and behaviors not documented here. **You must add them to this spec file** so that future runs (and future semesters) benefit from what you learned.

Specifically, document:
- The exact CSS selectors / DOM queries that work for scraping sections, items, and item types from course pages.
- Any Moodle quirks discovered during download (e.g., redirect behaviors, cookie requirements, rate limiting, timeouts).
- Any file type edge cases not already listed (new MIME types, unexpected formats).
- Any mod/ types encountered that aren't in the spec.
- Workarounds applied (e.g., retry logic, session refresh patterns).
- Per-course structural notes in the "Observed Course Structures" section — add or update entries as you discover new patterns.

Add these notes inline in the relevant section, or in a new `## Implementation Notes` section at the bottom. The goal is that this spec file becomes the single source of truth — anyone (or any future chat) reading it has everything they need to run a sync without guessing.

---

## New Semester Setup

This spec is designed to be reused each semester. Here's what to change:

### 1. Update the header
- Change "Current semester" to the new semester (e.g., "סמסטר א׳ (סמ 1), תשפ"ז").
- Change the semester identifier check from "סמ 2" to "סמ 1" (or vice versa).

### 2. Update the courses table
- For each course: search Moodle (`/course/search.php?search=COURSE_NAME`) for the new semester's offering.
- Verify each result by loading the course page and confirming the title contains the correct semester.
- Update the Moodle ID column with the new IDs.
- Add or remove courses as needed. Update folder names if desired.

### 3. Update the disk structure
- Change the root folder path if needed (e.g., `שנה ד׳/סמסטר א׳/` instead of `שנה ג׳/סמסטר ב׳/`).
- The manifest, Excel log, and README files will be created fresh in the new folder.

### 4. Run the audit
- Before the seed run, re-audit all course pages (as was done for v3). Each professor structures their course differently, and the same professor may change their structure between semesters.
- Update the "Observed Course Structures" section with new findings.
- Add any new edge cases to the relevant spec sections.

### 5. Run the seed
- Execute the seed run in a new chat.
- The scheduled task will handle daily incremental syncs from that point.

### 6. Update the scheduled task
- If the course IDs changed, the scheduled task will automatically pick them up from this spec file (or from the manifest).
- If the root folder path changed, update the scheduled task configuration.

---

## Implementation Notes

_This section is populated by the executing chat as it discovers implementation details. Do not delete — it grows over time._

### First seed run — 2026-03-31

#### Critical Bug: File Extensions MUST Be Preserved

**The spec's rule #2 ("PDF files are saved without the .pdf extension") is WRONG and must be reversed.** On macOS, files without extensions are unrecognizable — the OS opens them as raw text, showing binary gibberish. The user confirmed this: all 129 downloaded PDFs were unusable until re-downloaded with `.pdf` extensions.

**New rule:** ALL files keep their extensions. PDFs get `.pdf`. This applies to every file type without exception.

#### DOM Scraping Selectors (BGU Moodle, March 2026)

These CSS selectors work on `course/view.php?id=X`:

- **Sections:** `li.section.main` — each course section is a list item. The section name is in `.sectionname` or the `aria-label` attribute.
- **Activities within a section:** `li.activity` — each Moodle item (resource, folder, assign, url, etc.)
- **Item type detection:** The `li.activity` element has classes like `modtype_resource`, `modtype_folder`, `modtype_assign`, `modtype_url`, `modtype_forum`, `modtype_label`, `modtype_zoom`, `modtype_choicegroup`, `modtype_lti`. Extract the type from the class name.
- **Item ID (cmid):** The `id` attribute on the `li.activity` element is `module-CMID` — parse the number after the dash.
- **Item name:** `.instancename` inside the activity element. Note: this may contain a nested `<span class="accesshide">` with the type label — strip it.
- **Item link:** The `a` tag inside `.activityinstance` or `.aalink`.

#### Resource Download: URL Construction

- Non-direct URLs (mod/resource, mod/assign, etc.) must be fetched via their Moodle `view.php` URL, which then redirects to the actual `pluginfile.php` file.
- The base URL is `https://moodle.bgu.ac.il` and paths start with `/moodle/mod/...`. **CRITICAL:** When storing relative URLs, always include the leading `/moodle/` prefix. During the first run, URLs were stored as `mod/resource/view.php?id=...` (missing `/moodle/`), causing 88 out of 129 downloads to fail with "Failed to fetch" because the resulting URL was `https://moodle.bgu.ac.ilmod/resource/...` (no slash).
- Direct URLs (folder children via `pluginfile.php`) are already absolute — store them as-is with the full `https://` prefix and set a `direct` flag.
- Always use `fetch(url, { credentials: 'include', redirect: 'follow' })` — the session cookie is required, and resource URLs redirect through Moodle's file serving layer.

#### mod/url Resolution

`mod/url` items do NOT auto-redirect when fetched. Navigating to `mod/url/view.php?id=X` renders a Moodle page. The actual target URL is inside a `.urlworkaround a` element on that page. Fetch the page HTML, parse it with `DOMParser`, and extract the `href`.

#### mod/folder Expansion

Navigate to `mod/folder/view.php?id=X`, parse the response HTML. Child file links are under `.fp-filename-icon a` elements. Each link points to a `pluginfile.php` URL. The filename is in `.fp-filename` within the anchor.

#### mod/assign Pattern B Detection

Fetch `mod/assign/view.php?id=X`, parse the HTML, and look for `a[href*="pluginfile.php"]` links. If found, these are attached question/brief files (Pattern B). The link `href` gives the direct download URL.

#### File System Access API (showDirectoryPicker)

- `showDirectoryPicker()` requires a **user gesture** — it cannot be called from injected script directly. Solution: create a visible button in the page UI that the user clicks to trigger the picker.
- The directory handle persists within the same page session. Once granted, you can create subdirectories and write files without additional prompts.
- Use `getDirectoryHandle(name, { create: true })` to create nested folder paths.
- Use `getFileHandle(name, { create: true })` → `createWritable()` → `write(blob)` → `close()` to save files.

#### Mount/Sandbox Visibility Gap

Files written by the browser via the File System Access API are **invisible** from the Cowork sandbox's filesystem. The sandbox's mount of the user's folder does not reflect real-time changes from the browser. This means:
- You cannot verify, read, or post-process browser-written files from the sandbox.
- READMEs, manifests, and any files that need to be both written and readable should be handled entirely on one side (either all browser or all sandbox).
- The Excel file (`קבצים שלא הורדו.xlsx`) was successfully written from the sandbox side using `openpyxl` because it was created independently, not modifying browser-written files.

#### Google Colab Notebooks: Download Method

The Google Drive MCP (`google_drive_fetch`) only supports Google Docs — it cannot download Colab notebooks (.ipynb files). Direct `fetch()` from the browser to `drive.google.com` is blocked by CORS.

**Working method:** Navigate to each Colab notebook URL in Chrome, wait for it to load, then extract the notebook content from Colab's internal JavaScript model:

```javascript
const nb = colab.global.notebook;
const cells = [];
for (const cell of nb.cells) {
  const type = cell.getType ? cell.getType() : (cell.type_ || 'code');
  const text = cell.getText ? cell.getText() : (cell.text_ || '');
  const c = {
    cell_type: type === 'text' ? 'markdown' : 'code',
    source: text.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l),
    metadata: {}
  };
  if (c.cell_type === 'code') { c.execution_count = null; c.outputs = []; }
  cells.push(c);
}
const ipynb = JSON.stringify({
  nbformat: 4, nbformat_minor: 0,
  metadata: { colab: { name: title, provenance: [] },
              kernelspec: { name: 'python3', display_name: 'Python 3' },
              language_info: { name: 'python' } },
  cells
}, null, 1);
```

Key details:
- Wait for `colab.global.notebook.cells.length > 0` before extracting (poll with timeout).
- `colab.global.notebookModel.getIpynbJsonForSave()` exists but returns `{}` — do NOT rely on it.
- Cell outputs (images, execution results) are NOT captured by `getText()` — the exported `.ipynb` contains source code and markdown only, no outputs. This is acceptable for course materials (students re-run the code).
- **Batching across tabs:** Open all Colab URLs in separate Chrome tabs simultaneously. Extract from each tab, then use `BroadcastChannel('channel-name')` to send all extracted JSON to one collector tab. Save all notebooks from the collector with a single `showDirectoryPicker()` call.

#### Content-Disposition Header for Extension Detection

When downloading via `fetch()`, the response `Content-Disposition` header often contains the server filename with its original extension. Parse it with:

```javascript
const cd = resp.headers.get('content-disposition') || '';
const match = cd.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
const serverName = match ? decodeURIComponent(match[1].replace(/"/g, '')) : null;
```

Fall back to `Content-Type` header for extension detection if no `Content-Disposition` is present:
- `application/pdf` → `.pdf`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` → `.xlsx`
- `application/vnd.openxmlformats-officedocument.presentationml.presentation` → `.pptx`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` → `.docx`
- `application/x-rar-compressed` → `.rar`

#### README Files: Encoding Gotcha

When writing README.md files via browser JS, string literals with `\n` get written literally as backslash-n, not as actual newlines. Use template literals (backtick strings) or build the string with actual newline characters (`String.fromCharCode(10)` or concatenation with `"\n"` in a variable, not in a string literal passed through JSON).

#### Rate Limiting / Throttling

No rate limiting was observed from BGU Moodle during the seed run (129 files downloaded sequentially with ~200ms pauses every 10 files). However, adding small delays between batches is recommended as a precaution.

#### Observed File Types (First Seed Run)

Files actually encountered across all 5 courses:
- **PDF** (vast majority — lectures, tutorials, exams, papers)
- **RAR** (חוברת קורס חשמל — compressed textbook)
- **XLSX** (Lab3_ClassEx_Sol in סימולציה)
- **DOCX** (Lab3_ClassEx in סימולציה)
- **Colab notebooks** (6 across הנדסת חשמל and סימולציה — saved as .ipynb)

No PPTX-only files were encountered (all presentations had PDF siblings and were deduped). No video files were encountered as direct resources.

#### Per-Course Notes (Updated from Seed Run)

**הנדסת חשמל (64674):**
- One Colab notebook in כללי section: "תרגול 1- חזרה על פייתון"
- The חוברת קורס file is a RAR archive, not a PDF

**סימולציה (64673):**
- 5 Colab notebooks in מעבדות section (תרגולים 2, 5, 6, 7, 11)
- "תרגול 11" appears as both a Colab URL AND a separate resource — these are different content (both should be downloaded)
- Pattern B confirmed: assign cmid 3312033 contains "HW 2026B.pdf"
- דף נוסחאות folder (cmid 3287698) contains 5 statistical table PDFs
- תרגול 3 folder (cmid 3287708) contains 3 files: Presentation3.pdf, Lab3_ClassEx.docx, Lab3_ClassEx_Sol.xlsx

**מימון (65670):**
- Straightforward structure, no surprises

**רגרסיה (64660):**
- Heavy mod/folder usage confirmed — PDF-sibling dedup was applied

**ניהול פרוייקטים (63518):**
- 35+ academic papers with long English titles — no truncation was needed (all under 80 chars after normalization)
- Unicode RTL marks confirmed in some filenames — stripping works correctly

#### External Websites and Link Rabbit Holes (Lesson from סימולציה)

Some professors maintain external course websites (Google Sites, personal pages) that contain files NOT uploaded to Moodle — lectures, syllabi, exercises, etc. These sites may also link to files on other platforms (Dropbox, Google Drive/Slides/Docs). When a course page links to an external website (`sites.google.com`, professor's homepage, etc.):

1. **Always explore the external site thoroughly** before marking it as "external link — manual required." Navigate to the page and inventory all downloadable content.
2. **Compare against what's already downloaded from Moodle** — identify gaps (files on the external site that are NOT on Moodle).
3. **Download the missing files** using the appropriate method for each platform:
   - **Google Docs** → export as PDF: `https://docs.google.com/document/d/{ID}/export?format=pdf`
   - **Google Slides** → export as PDF: `https://docs.google.com/presentation/d/{ID}/export/pdf`
   - **CRITICAL for Google exports:** Use absolute URLs (with `https://docs.google.com/...`) and do NOT include `credentials: 'include'`. Google export endpoints redirect to `googleusercontent.com` — adding credentials causes a CORS error on the cross-origin redirect. Use `fetch(url, { redirect: 'follow' })` without credentials.
   - **Dropbox shared folders** → navigate to the Dropbox page in the browser (user must be logged in), extract file URLs from `<a>` elements, append `?dl=1` for direct download. Use `fetch(url, { credentials: 'include', redirect: 'follow' })` from the Dropbox tab (same-origin).
   - **Google Sites** → cannot be exported as PDF via any API. Navigate the site, identify linked files (which are usually on Drive/Slides/Docs/Dropbox), and download those individually.
4. **Do this in one pass** — don't leave gaps for a second round. The first seed run for סימולציה required multiple back-and-forth rounds to discover and download all external files. Nail it in one go.

#### BGU Admin Portal (`bgu4u.bgu.ac.il`) — Syllabus Pages

The "סילבוס מינהל תלמידים" links on all courses point to `bgu4u.bgu.ac.il/pls/scwp/!app.gate?...`. This portal uses a frameset. The `main` frame loads `!app.ann` with query parameters identifying the course.

**Key discovery:** The `!app.ann` URL actually serves a **PDF directly** — Chrome renders it in its built-in PDF viewer. However, when reading the DOM via JavaScript, the page appears completely empty (body has no content, no links, no text). This is because Chrome's PDF viewer replaces the page content with its own viewer UI, and the underlying PDF data is not accessible via standard DOM APIs.

**Working download method:**
1. Navigate to the `!app.ann` URL (either directly or via the frameset's main frame `src`). The browser will render the PDF.
2. The page DOM will appear empty to JS tools, but a **screenshot** reveals the PDF content is visible.
3. Use `fetch(window.location.href, { credentials: 'include', redirect: 'follow' })` **from the same tab** (same origin) to download the PDF as a blob. This works because the fetch re-requests the same URL that served the PDF.
4. Since the PDF is on `bgu4u.bgu.ac.il` (different origin from Moodle), you cannot save it via `showDirectoryPicker` on a Moodle tab. Instead:
   - Create an `<a>` element with `download` attribute and a blob URL, click it to trigger a browser download, OR
   - Create a file input on a Moodle tab where the directory handle exists, and have the user pick the downloaded PDF to save it to the correct course folder.

**Important gotchas:**
- Left-clicking the syllabus link on Moodle may open a **different Chrome profile** (BGU's SSO redirects to a profile where the user is logged in). Ensure you open the link in a **new tab in the same browser profile** where the Claude extension is active.
- `showDirectoryPicker()` does NOT work reliably on Chrome's PDF viewer pages — it throws "file or directory not found" errors.
- Cross-origin `fetch` from Moodle to `bgu4u.bgu.ac.il` is CORS-blocked. The fetch must happen from a tab already on the BGU domain.
- The page title shows "שם קורס - 364- Y-XXXX" (unpopulated template) even when the PDF is fully loaded — do not rely on the title to determine if content loaded.

**Link-hopping technique:** When direct programmatic navigation to the BGU URL results in an empty page (no SSO session), try opening the link chain manually: right-click the Moodle syllabus link → open in new tab → on that page find the next link → right-click → open in new tab again. Each hop carries the SSO cookies forward. Once the PDF renders, use `fetch` from that tab to download it.

#### Auto-Update Spec Rule

Each time the sync process (seed or incremental) learns something new — a new edge case, a workaround, a selector change, a platform behavior — it must immediately add that information to this spec file. Do not wait until the end. The spec is a living document and the single source of truth for all future runs.

---

## Unified Sync Engine (`moodle_sync.js` v2.0)

The entire download pipeline is encoded in a single JavaScript file (`moodle_sync.js`) that runs in any Moodle tab. It handles both seed and incremental syncs via a sidebar UI.

### How to Run

1. Navigate to any `moodle.bgu.ac.il` page in Chrome (must be logged in).
2. Load the engine. Two options:
   - **Manual (console):** Paste the contents of `moodle_sync.js` into the browser console.
   - **Automated (Claude in Chrome):** First inject the config via `javascript_tool`, then load the engine via `fetch()` from GitHub:
     ```javascript
     // Inject config first
     window.__MOODLE_SYNC_CONFIG__ = { /* ... config JSON ... */ };
     // Then load engine from GitHub (do NOT inject the 47KB script directly — it corrupts during chunked transcription)
     fetch('https://raw.githubusercontent.com/idomalach/bgu-moodle-sync/main/moodle_sync.js')
       .then(r => r.text()).then(code => eval(code));
     ```
3. A sidebar appears on the right with two buttons: **Seed Run (Full)** and **Incremental Sync**.
4. Click one. The browser's directory picker opens — point it to the root download folder (the parent of `שנה ג׳`).
5. The engine scrapes all 5 courses, resolves URLs, expands folders, downloads files, saves the manifest, generates READMEs, and produces the Excel log. All automatically.

### Architecture (8-step pipeline)

1. **Folder access** — `showDirectoryPicker()` → navigate to `שנה ג׳/סמסטר ב׳`.
2. **Load manifest** — read `.moodle_manifest.json` from the semester folder (empty object on first run).
3. **Scrape courses** — for each course: fetch `course/view.php?id=X`, extract sections and items via DOM selectors, build section-to-folder mapping (stem merging, solution merging, syllabus exception).
4. **Resolve & expand** — for each item:
   - `mod/resource` → queue for direct download.
   - `mod/folder` → expand children via `view.php`, apply PDF-sibling dedup, queue children.
   - `mod/url` → resolve target via `.urlworkaround a`, classify (Google export / Dropbox / Colab / external / BGU admin), queue or skip accordingly.
   - `mod/assign` → check for Pattern B (embedded `pluginfile.php` links), queue found files.
   - Silent-skip types (`label`, `page`, `zoom`, `lti`, `forum`, `choicegroup`) → ignore.
5. **Incremental filter** (incremental mode only) — remove items already in the manifest.
6. **Download** — fetch each queued file, detect extension from headers, normalize filename, try ZIP extraction (JSZip from CDN), write to correct subfolder via File System Access API. Handle duplicates by appending `(2)`, `(3)`, etc.
7. **Save manifest** — write updated manifest with section mappings, file sizes, timestamps.
8. **Generate outputs** — write `README.md` per course, write `קבצים שלא הורדו.xlsx` (SheetJS from CDN) with all skipped/failed items.

### Manifest Structure (`.moodle_manifest.json`)

```json
{
  "64674": {
    "courseName": "הנדסת חשמל",
    "folderName": "הנדסת חשמל",
    "lastSync": "2026-04-01T16:00:00.000Z",
    "sectionMap": {
      "הרצאות": { "folder": "הרצאות", "isMerged": false },
      "תרגול כיתה 1": { "folder": "תרגול כיתה", "isMerged": true, "numberPrefix": 1 },
      ...
    },
    "items": {
      "3312001": {
        "section": "הרצאות",
        "moodleName": "חוברת קורס חשמל",
        "type": "resource",
        "status": "downloaded",
        "savedAs": "הרצאות/חוברת קורס חשמל.rar",
        "fileSize": 4521234,
        "downloadedAt": "2026-04-01T16:05:23.000Z"
      },
      "3312002:Lab3_ClassEx.docx": {
        "section": "מעבדות",
        "moodleName": "Lab3_ClassEx.docx",
        "type": "folder",
        "status": "downloaded",
        "savedAs": "מעבדות/תרגול 3/Lab3_ClassEx.docx",
        "fileSize": 23456,
        "downloadedAt": "2026-04-01T16:05:25.000Z"
      }
    }
  }
}
```

Key design decisions:
- **Manifest keys:** `cmid` for top-level items, `parentCmid:childName` for mod/folder children (since all children share the parent's cmid).
- **Section mapping stored per course** so the scheduled task knows exactly which folder a new item in a given section should land in — no need to re-derive the mapping.
- **File sizes tracked** for future ETag/content-length-based update detection in incremental mode.
- **Status values:** `downloaded`, `extracted` (ZIP was unpacked), `removed_from_moodle` (item disappeared from Moodle but file kept on disk).

### Known Limitations (v2.0)

- **Colab notebooks:** Skipped with a log entry. Colab requires navigating to each notebook URL in a separate tab and extracting via `colab.global.notebook` — cannot be done from the Moodle tab. A future version could open Colab tabs and use `BroadcastChannel` to collect notebooks.
- **BGU admin syllabi:** Skipped with a log entry. Requires same-origin fetch from a `bgu4u.bgu.ac.il` tab with active SSO session — cannot be done cross-origin from Moodle.
- **RAR extraction:** Not supported in browser. RAR files are saved as-is.
- **Google Sites exploration:** Logged as external link. Requires manual navigation to discover linked files.
- **ETag-based update detection:** Not yet implemented. Incremental mode currently skips all items present in the manifest. A future version could compare content-length or ETag headers to detect updated files.

### CDN Dependencies

The engine loads two libraries from CDN at runtime (only when needed):
- **SheetJS** (`xlsx.full.min.js` v0.20.3) — for generating the Excel log.
- **JSZip** (v3.10.1) — for extracting ZIP archives.

Both are loaded lazily: SheetJS only when generating the Excel file, JSZip only when a ZIP file is downloaded.

---

## Safety Rules (v2.2 — added 2026-04-03)

These rules were added after an incident where the scheduled incremental sync re-downloaded every file because `loadManifest()` silently returned `{}` when the FUSE mount was deadlocked. The silent `catch { return {} }` in loadManifest was the single point of failure — an empty manifest in incremental mode is indistinguishable from a seed run.

### S1 — Abort on empty manifest (incremental mode)

If mode is `incremental` and the loaded manifest has 0 courses and 0 items, the engine throws immediately and refuses to proceed. This prevents blind full re-downloads when the manifest file is unreadable.

### S2 — IndexedDB manifest backup

After every successful sync, the manifest is saved to **both** the filesystem (`.moodle_manifest.json`) and **IndexedDB** (`MoodleSyncBackup` database, key `manifest`). On load, the engine tries the filesystem first; if that returns empty or fails, it falls back to the IndexedDB copy. This provides resilience against filesystem failures (FUSE deadlocks, permission issues, etc.).

### S3 — IndexedDB directory handle cache

After the first `showDirectoryPicker()` call, the returned `FileSystemDirectoryHandle` is stored in IndexedDB (key `directoryHandle`). On subsequent runs, the engine tries the cached handle first with `queryPermission({ mode: 'readwrite' })`. If granted, it skips the picker entirely. If permission was revoked, it calls `requestPermission()` to re-prompt. Only falls back to `showDirectoryPicker()` if the cached handle is unavailable. This eliminates the folder picker blocker for automated/scheduled runs.

### S4 — Download count safety valve

In incremental mode, after filtering the download queue: if the queue length exceeds **50% of total scraped items** AND is greater than **10 items**, the engine aborts. This catches cases where manifest corruption causes most items to appear "new" — which would otherwise trigger a mass re-download.

### S5 — Login enforcement

Before any sync operation, the engine checks for login buttons (`התחברות` / `Log in`) on the page and clicks them if found. It also checks for the user menu element to confirm login status. This addresses a subtle issue where the Moodle page can look like a dashboard (cached HTML) even when the session has expired. Running sync without login would produce empty course pages or redirect errors.

### S6 — Config backup in IndexedDB

The config object is saved to IndexedDB (key `config`) whenever it's loaded from `window.__MOODLE_SYNC_CONFIG__` or saved from the setup form. If config loading fails on a subsequent run (e.g., the injection didn't happen, the config file is unreachable), the engine falls back to the IndexedDB copy. This prevents the setup form from appearing unexpectedly during scheduled runs.
