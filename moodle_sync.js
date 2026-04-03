/**
 * BGU Moodle Sync Engine v2.3 (safety patches S1–S6, update/removal detection)
 *
 * Unified engine for both seed runs and incremental syncs.
 * Inject this into any Moodle tab, click the button, and it handles everything.
 *
 * Usage: Paste into Chrome DevTools console on any moodle.bgu.ac.il page,
 *        or inject via Claude in Chrome's javascript_tool.
 *        Then click "Seed Run (Full)" or "Incremental Sync".
 *
 * Configuration is loaded from moodle_sync_config.json (same folder as
 * this script). To change courses, semester, or paths — edit that file,
 * not this one. The engine is course-agnostic.
 *
 * If no config file is available (e.g. first-time use or friend sharing),
 * the engine shows a setup form where you enter courses manually.
 */

(function () {
  'use strict';

  // ============================================================
  // CONFIGURATION — loaded at runtime from config file or UI form
  // ============================================================

  // Defaults — overridden by moodle_sync_config.json if present
  let CONFIG = {
    baseUrl: 'https://moodle.bgu.ac.il',
    semesterCheck: '',      // e.g. 'סמ 2' — set via config
    rootPath: '',           // e.g. 'סמסטר ב׳' — set via config (relative to the folder picked in the directory picker)
    courses: [],            // populated from config or setup form
    silentSkipTypes: ['label', 'page', 'zoom', 'lti', 'forum', 'choicegroup'],
    assignTypes: ['assign'],
    mergeThreshold: 3,
    delayBetweenFetches: 200,
    batchPause: 500,
  };

  /**
   * Try to load config from a JSON file picked by the user,
   * or injected by the scheduled task via window.__MOODLE_SYNC_CONFIG__.
   */
  async function loadConfig() {
    // Option 1: Config injected into window (by scheduled task or script)
    if (window.__MOODLE_SYNC_CONFIG__) {
      const ext = window.__MOODLE_SYNC_CONFIG__;
      Object.assign(CONFIG, ext);
      log('Config loaded from window.__MOODLE_SYNC_CONFIG__');
      // S6 — Backup config to IndexedDB
      try { await idbSet('config', CONFIG); } catch {}
      return true;
    }

    // Option 2: Config loaded alongside the script via the semester folder
    // (The setup form will set this if the user fills it in)

    // S6 — Fallback: try IndexedDB config backup
    try {
      const cachedConfig = await idbGet('config');
      if (cachedConfig && cachedConfig.courses && cachedConfig.courses.length > 0) {
        Object.assign(CONFIG, cachedConfig);
        log('Config restored from IndexedDB backup');
        // S7 — Warn if cached rootPath uses the old two-part format
        const segments = CONFIG.rootPath ? CONFIG.rootPath.split('/').filter(p => p.length > 0).length : 0;
        if (segments > 1) {
          log('  ⚠️ WARNING: rootPath has multiple segments ("' + CONFIG.rootPath + '") — this may create duplicate folders.');
          log('  ⚠️ If you pick the year folder (e.g. שנה ג׳), rootPath should be just the semester (e.g. סמסטר ב׳).');
          log('  ⚠️ Re-run with injected config or use the setup form to fix the IndexedDB cache.');
        }
        return true;
      }
    } catch {}

    return false;
  }

  // ============================================================
  // STATE
  // ============================================================

  let state = {
    mode: null,           // 'seed' or 'incremental'
    rootHandle: null,     // FileSystem root directory handle
    semesterHandle: null, // semester folder handle (e.g. סמסטר ב׳ inside the picked year folder)
    manifest: null,       // loaded manifest JSON
    sectionMap: {},       // courseId -> sectionMapping
    items: [],            // all scraped items across courses
    downloadQueue: [],    // items to download
    skipQueue: [],        // items to log to Excel
    results: { downloaded: 0, failed: 0, skipped: 0, newItems: 0, updated: 0 },
    log: [],
    running: false,
  };

  // ============================================================
  // CDN LIBRARY LOADER
  // ============================================================

  async function loadCdnLibrary(name, url, globalName) {
    if (window[globalName]) return window[globalName];
    log(`Loading ${name} from CDN...`);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => {
        if (window[globalName]) {
          log(`  ${name} loaded`);
          resolve(window[globalName]);
        } else {
          reject(new Error(`${name} loaded but ${globalName} not found on window`));
        }
      };
      script.onerror = () => reject(new Error(`Failed to load ${name} from CDN`));
      document.head.appendChild(script);
    });
  }

  async function ensureSheetJS() {
    return loadCdnLibrary('SheetJS', 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', 'XLSX');
  }

  async function ensureJSZip() {
    return loadCdnLibrary('JSZip', 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'JSZip');
  }

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================

  function log(msg) {
    state.log.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    console.log(`[MoodleSync] ${msg}`);
    updateUI();
  }

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /** Normalize a filename per spec rules */
  function normalizeName(name) {
    if (!name) return 'unnamed';
    let n = name;
    // Strip invisible Unicode
    n = n.replace(/[\u200F\u200E\u200B\u200C\u200D\u061C\uFEFF]/g, '');
    // Replace illegal filename chars
    n = n.replace(/[\/\\:*?"<>|]/g, '-');
    // Collapse multiple spaces
    n = n.replace(/\s+/g, ' ');
    // Strip trailing underscores, dots, punctuation (except closing parens)
    n = n.replace(/[_.!,;:]+$/g, '');
    // Trim
    n = n.trim();
    // Truncate if > 80 chars
    if (n.length > 80) n = n.substring(0, 77) + '...';
    return n || 'unnamed';
  }

  /** Detect extension from Content-Disposition or Content-Type */
  function detectExtension(resp, fallbackName) {
    const cd = resp.headers.get('content-disposition') || '';
    const match = cd.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
    if (match) {
      const serverName = decodeURIComponent(match[1].replace(/"/g, ''));
      const dotIdx = serverName.lastIndexOf('.');
      if (dotIdx > 0) return serverName.substring(dotIdx);
    }
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/pdf')) return '.pdf';
    if (ct.includes('spreadsheetml')) return '.xlsx';
    if (ct.includes('presentationml')) return '.pptx';
    if (ct.includes('wordprocessingml')) return '.docx';
    if (ct.includes('x-rar')) return '.rar';
    if (ct.includes('zip')) return '.zip';
    if (ct.includes('text/html')) return '.html';
    if (ct.includes('text/plain')) return '.txt';
    if (ct.includes('image/png')) return '.png';
    if (ct.includes('image/jpeg')) return '.jpg';
    // Check fallback name
    if (fallbackName) {
      const idx = fallbackName.lastIndexOf('.');
      if (idx > 0) return fallbackName.substring(idx);
    }
    return '';
  }

  /** Check if a file is a solution based on name */
  function isSolutionFile(name) {
    const n = (name || '').trim();
    return n.startsWith('פתרון') || n.toLowerCase().startsWith('solution');
  }

  /** Check if a name is a syllabus */
  function isSyllabus(name) {
    const n = (name || '').toLowerCase();
    return n.includes('סילבוס') || n.includes('סיליבוס') || n.includes('syllabus');
  }

  /** Generate a unique manifest key for an item */
  function manifestKey(item) {
    // mod/folder children share a cmid — use cmid:childName for uniqueness
    if (item.isChild && item.parentCmid) {
      return `${item.parentCmid}:${item.name}`;
    }
    return item.cmid;
  }

  // ============================================================
  // DOM SCRAPING — extract items from course pages
  // ============================================================

  /** Fetch a Moodle page and parse it */
  async function fetchMoodlePage(url) {
    const resp = await fetch(url, { credentials: 'include', redirect: 'follow' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    const html = await resp.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  /** Scrape all sections and items from a course page */
  async function scrapeCourse(courseId, folderName) {
    log(`Scraping course ${folderName} (${courseId})...`);
    const url = `${CONFIG.baseUrl}/moodle/course/view.php?id=${courseId}`;
    const doc = await fetchMoodlePage(url);

    // Verify semester
    const title = doc.title || '';
    if (!title.includes(CONFIG.semesterCheck)) {
      log(`  WARNING: title doesn't contain "${CONFIG.semesterCheck}": ${title}`);
    }

    const sections = doc.querySelectorAll('li.section.main');
    const items = [];
    const sectionNames = [];

    for (const section of sections) {
      const sectionNameEl = section.querySelector('.sectionname');
      const sectionName = sectionNameEl
        ? sectionNameEl.textContent.trim()
        : (section.getAttribute('aria-label') || '').trim();

      if (!sectionName) continue;

      const activities = section.querySelectorAll('li.activity');
      if (activities.length === 0) continue;

      sectionNames.push({ name: sectionName, items: [] });

      for (const act of activities) {
        const classes = act.className || '';
        const typeMatch = classes.match(/modtype_(\w+)/);
        if (!typeMatch) continue;
        const modType = typeMatch[1];

        const idAttr = act.id || '';
        const cmidMatch = idAttr.match(/module-(\d+)/);
        if (!cmidMatch) continue;
        const cmid = cmidMatch[1];

        const nameEl = act.querySelector('.instancename');
        let displayName = nameEl ? nameEl.textContent.trim() : '';
        const accessHide = nameEl ? nameEl.querySelector('.accesshide') : null;
        if (accessHide) {
          displayName = displayName.replace(accessHide.textContent.trim(), '').trim();
        }

        const linkEl = act.querySelector('a');
        const href = linkEl ? linkEl.href : '';

        items.push({
          courseId,
          courseName: folderName,
          section: sectionName,
          cmid,
          type: modType,
          name: displayName,
          url: href,
          direct: false,
          isChild: false,
          parentCmid: null,
          children: [],
        });

        sectionNames[sectionNames.length - 1].items.push(cmid);
      }
    }

    log(`  Found ${items.length} items in ${sectionNames.length} sections`);
    return { items, sectionNames };
  }

  // ============================================================
  // SECTION → FOLDER MAPPING
  // ============================================================

  function buildSectionMapping(sectionNames, folderName) {
    const mapping = {};

    // Step 1: Detect numbered stem groups for merging
    const stemGroups = {};
    for (const s of sectionNames) {
      const match = s.name.match(/^(.+?)\s*(\d+)\s*$/);
      if (match) {
        const stem = match[1].trim();
        const num = parseInt(match[2]);
        if (!stemGroups[stem]) stemGroups[stem] = [];
        stemGroups[stem].push({ name: s.name, number: num });
      }
    }

    // Stems with >= threshold get merged
    for (const [stem, group] of Object.entries(stemGroups)) {
      if (group.length >= CONFIG.mergeThreshold) {
        for (const g of group) {
          mapping[g.name] = { folder: stem, isMerged: true, numberPrefix: g.number };
        }
      }
    }

    // Step 2: Handle solution sections
    for (const s of sectionNames) {
      if (mapping[s.name]) continue;
      if (s.name.startsWith('פתרונות')) {
        const parentName = s.name.replace(/^פתרונות\s*/, '').trim();
        const parentSection = sectionNames.find(p =>
          p.name === parentName ||
          parentName.includes(p.name) ||
          p.name.includes(parentName)
        );
        if (parentSection && parentSection.name !== s.name) {
          const parentFolder = mapping[parentSection.name]?.folder || parentSection.name;
          mapping[s.name] = { folder: `${parentFolder}/פתרונות`, isMerged: false, mergedInto: parentFolder };
        } else {
          mapping[s.name] = { folder: s.name, isMerged: false };
        }
      }
    }

    // Step 3: All remaining sections get their own folder
    for (const s of sectionNames) {
      if (!mapping[s.name]) {
        mapping[s.name] = { folder: s.name, isMerged: false };
      }
    }

    return mapping;
  }

  /** Determine the disk path for an item given the section mapping */
  function getItemDiskPath(item, sectionMapping) {
    if (isSyllabus(item.name)) return '';

    const mapEntry = sectionMapping[item.section];
    if (!mapEntry) return item.section;

    let folder = mapEntry.folder;

    if (isSolutionFile(item.name) && !folder.includes('פתרונות')) {
      folder = `${folder}/פתרונות`;
    }

    return folder;
  }

  // ============================================================
  // ITEM RESOLUTION
  // ============================================================

  async function resolveModUrl(item) {
    try {
      const doc = await fetchMoodlePage(item.url);
      const linkEl = doc.querySelector('.urlworkaround a');
      if (!linkEl) return null;
      const targetUrl = linkEl.href;
      let hostname;
      try { hostname = new URL(targetUrl).hostname; } catch { return { type: 'external', url: targetUrl, reason: 'malformed URL' }; }

      if (hostname.includes('colab.research.google.com')) {
        return { type: 'colab', url: targetUrl };
      }
      if (hostname.includes('docs.google.com') || hostname.includes('slides.google.com')) {
        const id = targetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (!id) return { type: 'external', url: targetUrl, reason: 'external link' };
        if (targetUrl.includes('/presentation/')) {
          return { type: 'google_slides', url: `https://docs.google.com/presentation/d/${id[1]}/export/pdf` };
        }
        if (targetUrl.includes('/document/')) {
          return { type: 'google_docs', url: `https://docs.google.com/document/d/${id[1]}/export?format=pdf` };
        }
        if (targetUrl.includes('/spreadsheets/')) {
          return { type: 'google_sheets', url: `https://docs.google.com/spreadsheets/d/${id[1]}/export?format=xlsx` };
        }
        return { type: 'google_drive', url: targetUrl };
      }
      if (hostname.includes('drive.google.com')) {
        // Try to extract file ID for direct download
        const fileId = targetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || targetUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (fileId) {
          return { type: 'google_drive_direct', url: `https://drive.google.com/uc?export=download&id=${fileId[1]}` };
        }
        return { type: 'google_drive', url: targetUrl, reason: 'Google Drive folder — explore manually' };
      }
      if (hostname.includes('dropbox.com')) {
        return { type: 'dropbox', url: targetUrl.replace(/\?dl=0/, '?dl=1').replace(/&dl=0/, '&dl=1') };
      }
      if (hostname.includes('sites.google.com')) {
        return { type: 'google_sites', url: targetUrl, reason: 'Google Sites — explore for linked files' };
      }
      if (hostname.includes('youtube.com') || hostname.includes('youtu.be') ||
          hostname.includes('zoom.us') || hostname.includes('vimeo.com')) {
        return { type: 'video', url: targetUrl, reason: 'video' };
      }
      if (hostname.includes('bgu4u.bgu.ac.il')) {
        return { type: 'bgu_admin', url: targetUrl, reason: 'BGU admin page — requires link-hopping' };
      }
      if (hostname.includes('github.com')) {
        return { type: 'external', url: targetUrl, reason: 'GitHub link' };
      }
      return { type: 'external', url: targetUrl, reason: 'external link' };
    } catch (e) {
      return { type: 'error', url: item.url, reason: 'URL resolution error: ' + e.message };
    }
  }

  async function expandModFolder(item) {
    try {
      const url = item.url || `${CONFIG.baseUrl}/moodle/mod/folder/view.php?id=${item.cmid}`;
      const doc = await fetchMoodlePage(url);
      const links = doc.querySelectorAll('.fp-filename-icon a');
      const children = [];
      for (const link of links) {
        const nameEl = link.querySelector('.fp-filename');
        const childName = nameEl ? nameEl.textContent.trim() : link.textContent.trim();
        children.push({ name: childName, url: link.href, direct: true });
      }
      return children;
    } catch (e) {
      log(`  Error expanding folder ${item.name}: ${e.message}`);
      return [];
    }
  }

  async function checkAssignPatternB(item) {
    try {
      const url = item.url || `${CONFIG.baseUrl}/moodle/mod/assign/view.php?id=${item.cmid}`;
      const doc = await fetchMoodlePage(url);
      const pluginLinks = doc.querySelectorAll('a[href*="pluginfile.php"]');
      const files = [];
      for (const link of pluginLinks) {
        files.push({ name: link.textContent.trim() || 'assignment_file', url: link.href, direct: true });
      }
      return files;
    } catch (e) {
      return [];
    }
  }

  // ============================================================
  // PDF-SIBLING DEDUP
  // ============================================================

  function dedupPdfSiblings(children) {
    const byBase = {};
    for (const child of children) {
      const dotIdx = child.name.lastIndexOf('.');
      const base = dotIdx > 0 ? child.name.substring(0, dotIdx) : child.name;
      const ext = dotIdx > 0 ? child.name.substring(dotIdx).toLowerCase() : '';
      if (!byBase[base]) byBase[base] = [];
      byBase[base].push({ ...child, ext });
    }

    const result = [];
    for (const [base, files] of Object.entries(byBase)) {
      const hasPdf = files.some(f => f.ext === '.pdf');
      const hasOffice = files.some(f => ['.docx', '.pptx', '.doc', '.ppt'].includes(f.ext));
      if (hasPdf && hasOffice) {
        result.push(...files.filter(f => f.ext === '.pdf'));
      } else {
        result.push(...files);
      }
    }
    return result;
  }

  // ============================================================
  // ZIP / RAR EXTRACTION
  // ============================================================

  /**
   * If the downloaded blob is a ZIP, extract its contents and write them individually.
   * Returns an array of { name, blob } objects. If not a zip or extraction fails, returns null.
   */
  async function tryExtractZip(blob, fileName) {
    const ext = fileName.toLowerCase();
    if (!ext.endsWith('.zip') && !ext.endsWith('.rar')) return null;

    if (ext.endsWith('.rar')) {
      // RAR extraction not supported in browser — save as-is
      log(`  RAR file detected (${fileName}) — saving as-is (no browser RAR support)`);
      return null;
    }

    try {
      const JSZip = await ensureJSZip();
      const zip = await JSZip.loadAsync(blob);
      const extracted = [];

      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue; // Skip directories
        const content = await entry.async('blob');
        // Use just the filename, not the full path inside the zip
        const parts = path.split('/');
        let name = parts[parts.length - 1];
        if (!name) continue;
        extracted.push({ name: normalizeName(name), blob: content });
      }

      log(`  Extracted ${extracted.length} files from ${fileName}`);
      return extracted.length > 0 ? extracted : null;
    } catch (e) {
      log(`  ZIP extraction failed for ${fileName}: ${e.message}`);
      return null;
    }
  }

  // ============================================================
  // FILE DOWNLOAD & SAVE
  // ============================================================

  async function getNestedDir(rootHandle, path) {
    if (!path) return rootHandle;
    const parts = path.split('/').filter(p => p.length > 0);
    let current = rootHandle;
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create: true });
    }
    return current;
  }

  /** Write a blob to a directory, handling duplicate names */
  async function writeFile(targetDir, fileName, blob) {
    let finalName = fileName;
    let dupeCount = 1;
    while (true) {
      try {
        await targetDir.getFileHandle(finalName);
        dupeCount++;
        const dotIdx = fileName.lastIndexOf('.');
        if (dotIdx > 0) {
          finalName = `${fileName.substring(0, dotIdx)} (${dupeCount})${fileName.substring(dotIdx)}`;
        } else {
          finalName = `${fileName} (${dupeCount})`;
        }
      } catch {
        break;
      }
    }
    const fh = await targetDir.getFileHandle(finalName, { create: true });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();
    return finalName;
  }

  /** Download a file and save it to the correct location */
  async function downloadAndSave(item, courseHandle) {
    const fetchUrl = item.fetchUrl || (item.direct
      ? item.url
      : `${CONFIG.baseUrl}/moodle/mod/resource/view.php?id=${item.cmid}`);

    try {
      const fetchOpts = { redirect: 'follow' };

      // Google exports: absolute URL, NO credentials (CORS fix for cross-origin redirect)
      if (item.googleExport) {
        // No credentials — Google rejects cross-origin requests with cookies
      } else {
        fetchOpts.credentials = 'include';
      }

      const resp = await fetch(fetchUrl, fetchOpts);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const blob = await resp.blob();
      const ext = detectExtension(resp, item.name);
      const contentLength = blob.size;
      const etag = resp.headers.get('etag') || '';

      // Build filename
      let fileName = normalizeName(item.name);
      if (ext && !fileName.toLowerCase().endsWith(ext.toLowerCase())) {
        fileName += ext;
      }
      if (item.mergePrefix !== undefined) {
        const pad = String(item.mergePrefix).padStart(2, '0');
        fileName = `${pad} - ${fileName}`;
      }

      // Get target directory
      const targetDir = await getNestedDir(courseHandle, item.diskFolder);

      // Try ZIP extraction
      const extracted = await tryExtractZip(blob, fileName);
      if (extracted) {
        // Write each extracted file individually
        const savedFiles = [];
        for (const entry of extracted) {
          const savedName = await writeFile(targetDir, entry.name, entry.blob);
          savedFiles.push(savedName);
        }
        return {
          success: true,
          savedAs: savedFiles.map(f => item.diskFolder ? `${item.diskFolder}/${f}` : f),
          fileSize: contentLength,
          etag,
          extracted: true,
          extractedCount: savedFiles.length,
        };
      }

      // Normal file — write directly
      const finalName = await writeFile(targetDir, fileName, blob);

      return {
        success: true,
        savedAs: item.diskFolder ? `${item.diskFolder}/${finalName}` : finalName,
        fileSize: contentLength,
        etag,
        extracted: false,
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ============================================================
  // INDEXEDDB HELPERS (S2, S3, S6 — backup & cache layer)
  // ============================================================

  function openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('MoodleSyncBackup', 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('backups')) {
          db.createObjectStore('backups');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    try {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('backups', 'readonly');
        const store = tx.objectStore('backups');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      log(`  IDB read failed for "${key}": ${e.message}`);
      return null;
    }
  }

  async function idbSet(key, value) {
    try {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('backups', 'readwrite');
        const store = tx.objectStore('backups');
        const req = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      log(`  IDB write failed for "${key}": ${e.message}`);
    }
  }

  // ============================================================
  // MANIFEST MANAGEMENT (patched: S1, S2)
  // ============================================================

  async function loadManifest(semesterHandle) {
    // Try filesystem first
    try {
      const fh = await semesterHandle.getFileHandle('.moodle_manifest.json');
      const file = await fh.getFile();
      const text = await file.text();
      const manifest = JSON.parse(text);
      if (manifest && Object.keys(manifest).length > 0) {
        log('  Manifest loaded from filesystem');
        return manifest;
      }
    } catch {
      // filesystem failed — fall through to IndexedDB
    }

    // S2 — Fallback: try IndexedDB backup
    log('  Filesystem manifest empty or missing — trying IndexedDB backup...');
    const backup = await idbGet('manifest');
    if (backup && Object.keys(backup).length > 0) {
      log('  Manifest restored from IndexedDB backup');
      return backup;
    }

    log('  No manifest found in filesystem or IndexedDB');
    return {};
  }

  async function saveManifest(semesterHandle, manifest) {
    // Save to filesystem
    const fh = await semesterHandle.getFileHandle('.moodle_manifest.json', { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(manifest, null, 2));
    await writable.close();

    // S2 — Also save to IndexedDB as backup
    await idbSet('manifest', manifest);
    log('  Manifest saved to filesystem + IndexedDB backup');
  }

  // ============================================================
  // EXCEL GENERATION — skipped/failed items log
  // ============================================================

  async function generateExcel(semesterHandle, skipQueue) {
    if (skipQueue.length === 0) {
      log('No skipped items — skipping Excel generation');
      return;
    }

    try {
      const XLSX = await ensureSheetJS();

      const rows = skipQueue.map(item => ({
        'קורס': item.courseName || '',
        'מיקום במוודל': item.section || '',
        'שם': item.name || '',
        'סוג': item.type || '',
        'סיבה': item.reason || '',
        'קישור': item.url || '',
      }));

      const ws = XLSX.utils.json_to_sheet(rows);

      // Set column widths
      ws['!cols'] = [
        { wch: 18 }, // קורס
        { wch: 22 }, // מיקום במוודל
        { wch: 35 }, // שם
        { wch: 12 }, // סוג
        { wch: 30 }, // סיבה
        { wch: 50 }, // קישור
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'קבצים שלא הורדו');

      const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([xlsxData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      const fh = await semesterHandle.getFileHandle('קבצים שלא הורדו.xlsx', { create: true });
      const writable = await fh.createWritable();
      await writable.write(blob);
      await writable.close();

      log(`Excel generated: ${skipQueue.length} items in קבצים שלא הורדו.xlsx`);
    } catch (e) {
      log(`ERROR generating Excel: ${e.message}`);
    }
  }

  // ============================================================
  // README GENERATION
  // ============================================================

  async function generateReadme(courseHandle, courseName, courseManifest) {
    const lines = [`# ${courseName}`, '', `Last synced: ${new Date().toISOString().split('T')[0]}`, ''];

    if (!courseManifest || !courseManifest.items) return;

    // Collect all files from manifest, grouped by folder
    const folders = {};
    for (const [key, item] of Object.entries(courseManifest.items)) {
      if (item.status !== 'downloaded' && item.status !== 'extracted') continue;

      // Handle extracted items (savedAs is an array)
      const paths = Array.isArray(item.savedAs) ? item.savedAs : [item.savedAs];
      for (const path of paths) {
        if (!path) continue;
        const lastSlash = path.lastIndexOf('/');
        const folder = lastSlash > 0 ? path.substring(0, lastSlash) : '';
        const file = lastSlash > 0 ? path.substring(lastSlash + 1) : path;
        if (!folders[folder]) folders[folder] = [];
        folders[folder].push(file);
      }
    }

    // Root files first
    if (folders['']) {
      for (const f of folders[''].sort()) lines.push(`- ${f}`);
      lines.push('');
      delete folders[''];
    }

    // Then each folder sorted
    const sortedFolders = Object.entries(folders).sort(([a], [b]) => a.localeCompare(b, 'he'));
    for (const [folder, files] of sortedFolders) {
      const depth = folder.split('/').length;
      const heading = depth === 1 ? '##' : '###';
      lines.push(`${heading} ${folder} (${files.length} files)`);
      lines.push('');
      for (const f of files.sort()) {
        const indent = depth > 1 ? '  ' : '';
        lines.push(`${indent}- ${f}`);
      }
      lines.push('');
    }

    const fh = await courseHandle.getFileHandle('README.md', { create: true });
    const writable = await fh.createWritable();
    await writable.write(lines.join('\n'));
    await writable.close();
  }

  // ============================================================
  // MAIN SYNC ORCHESTRATOR
  // ============================================================

  async function runSync(mode) {
    if (state.running) {
      log('Sync already running — ignoring');
      return;
    }
    state.running = true;
    state.mode = mode;
    state.log = [];
    state.results = { downloaded: 0, failed: 0, skipped: 0, newItems: 0, updated: 0 };
    log(`=== Starting ${mode.toUpperCase()} sync ===`);
    log('');

    try {
      // S5 — Login enforcement: always click התחברות before proceeding
      log('Step 0: Ensuring login...');
      const loginBtn = document.querySelector('a[href*="login/index.php"], a.btn-login, a[data-title="login,moodle"]');
      if (loginBtn) {
        log('  Found login button — clicking...');
        loginBtn.click();
        await delay(3000);
        log('  Login page triggered — please complete login, then re-run sync.');
        state.running = false;
        return;
      }
      // Also check for the Hebrew login link text
      const allLinks = document.querySelectorAll('a');
      for (const link of allLinks) {
        if (link.textContent.trim() === 'התחברות' || link.textContent.trim() === 'Log in') {
          log('  Found "התחברות" link — clicking...');
          link.click();
          await delay(3000);
          log('  Login page triggered — please complete login, then re-run sync.');
          state.running = false;
          return;
        }
      }
      // Verify we're actually logged in by checking for user menu
      const userMenu = document.querySelector('.usermenu, .usertext, #user-menu-toggle, .logininfo .username');
      if (!userMenu) {
        log('  WARNING: Could not confirm login status — proceeding cautiously');
      } else {
        log('  Login confirmed');
      }

      // Step 1: Get directory handle (S3 — try cached handle first)
      log('Step 1/8: Requesting folder access...');
      let dirHandle = null;

      // S3 — Try cached directory handle from IndexedDB
      try {
        const cachedHandle = await idbGet('directoryHandle');
        if (cachedHandle) {
          const perm = await cachedHandle.queryPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            dirHandle = cachedHandle;
            log('  Using cached directory handle from IndexedDB');
          } else {
            const requested = await cachedHandle.requestPermission({ mode: 'readwrite' });
            if (requested === 'granted') {
              dirHandle = cachedHandle;
              log('  Re-authorized cached directory handle');
            }
          }
        }
      } catch (e) {
        log(`  Cached handle unavailable: ${e.message}`);
      }

      // Fall back to picker if no cached handle
      if (!dirHandle) {
        dirHandle = await showDirectoryPicker({ mode: 'readwrite' });
        // S3 — Cache the handle for future runs
        await idbSet('directoryHandle', dirHandle);
        log('  Directory handle cached in IndexedDB for future runs');
      }

      state.rootHandle = dirHandle;
      // Walk CONFIG.rootPath dynamically (e.g. "סמסטר ב׳" → one nested dir inside the picked year folder)
      let semHandle = state.rootHandle;
      const pathParts = CONFIG.rootPath.split('/').filter(p => p.length > 0);
      for (const part of pathParts) {
        semHandle = await semHandle.getDirectoryHandle(part, { create: true });
      }
      state.semesterHandle = semHandle;
      log(`  Folder access granted (root path: ${CONFIG.rootPath})`);

      // Step 1b: Save config to semester folder if entered via form
      if (window.__MOODLE_SYNC_CONFIG_PENDING__) {
        const cfgHandle = await state.semesterHandle.getFileHandle('moodle_sync_config.json', { create: true });
        const cfgWritable = await cfgHandle.createWritable();
        await cfgWritable.write(JSON.stringify(window.__MOODLE_SYNC_CONFIG_PENDING__, null, 2));
        await cfgWritable.close();
        log('  Config saved to moodle_sync_config.json');
        // S6 — Also backup config to IndexedDB
        await idbSet('config', window.__MOODLE_SYNC_CONFIG_PENDING__);
        delete window.__MOODLE_SYNC_CONFIG_PENDING__;
      }

      // Step 2: Load manifest
      log('Step 2/8: Loading manifest...');
      state.manifest = await loadManifest(state.semesterHandle);
      const courseCount = Object.keys(state.manifest).length;
      log(`  Manifest loaded: ${courseCount} courses tracked`);

      // S1 — Abort on empty manifest in incremental mode
      if (mode === 'incremental' && courseCount === 0) {
        const totalManifestItems = Object.values(state.manifest)
          .reduce((sum, c) => sum + (c.items ? Object.keys(c.items).length : 0), 0);
        if (totalManifestItems === 0) {
          log('');
          log('🛑 SAFETY ABORT: Incremental mode with EMPTY manifest.');
          log('  An empty manifest in incremental mode means ALL files would be');
          log('  re-downloaded (indistinguishable from a seed run).');
          log('  This usually means the manifest file could not be read.');
          log('');
          log('  To fix: Run a SEED sync first, or check that the manifest file');
          log('  (.moodle_manifest.json) exists and is readable.');
          state.running = false;
          return;
        }
      }

      // S7 — Abort seed into populated folder
      if (mode === 'seed') {
        const totalManifestItems = Object.values(state.manifest)
          .reduce((sum, c) => sum + (c.items ? Object.keys(c.items).length : 0), 0);
        if (totalManifestItems > 0) {
          log('');
          log('🛑 SAFETY ABORT: Seed run into an already-populated folder.');
          log(`  The manifest has ${totalManifestItems} items across ${courseCount} courses.`);
          log('  Running a seed here would create duplicate files.');
          log('');
          log('  For a new semester: update rootPath in the config to point to');
          log('  a new semester folder (e.g. "סמסטר א׳"), then try again.');
          log('  The directory picker will let you select the year folder and');
          log('  the engine creates the new semester subfolder automatically.');
          log('');
          log('  If you truly want to re-download into this folder, delete');
          log('  .moodle_manifest.json first and clear the course folders manually.');
          state.running = false;
          return;
        }
      }

      // Step 3: Scrape all courses
      log('Step 3/8: Scraping courses...');
      const allItems = [];

      for (const course of CONFIG.courses) {
        try {
          const { items, sectionNames } = await scrapeCourse(course.id, course.folderName);
          const sectionMapping = buildSectionMapping(sectionNames, course.folderName);
          state.sectionMap[course.id] = sectionMapping;

          for (const item of items) {
            if (CONFIG.silentSkipTypes.includes(item.type)) continue;
            item.diskFolder = getItemDiskPath(item, sectionMapping);

            const mapEntry = sectionMapping[item.section];
            if (mapEntry && mapEntry.isMerged && mapEntry.numberPrefix !== undefined) {
              item.mergePrefix = mapEntry.numberPrefix;
            }

            allItems.push(item);
          }

          await delay(CONFIG.delayBetweenFetches);
        } catch (e) {
          log(`  ERROR scraping ${course.folderName}: ${e.message}`);
        }
      }

      log(`  Total items scraped: ${allItems.length}`);

      // Step 4: Resolve URLs, expand folders, check assignments
      log('Step 4/8: Resolving URLs and expanding folders...');
      const downloadQueue = [];
      const skipQueue = [];

      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        if (i > 0 && i % 10 === 0) {
          await delay(CONFIG.batchPause);
          log(`  Processing ${i}/${allItems.length}...`);
        }

        if (item.type === 'resource') {
          if (!item.url.includes('/moodle/')) {
            item.url = `${CONFIG.baseUrl}/moodle/mod/resource/view.php?id=${item.cmid}`;
          }
          downloadQueue.push(item);

        } else if (item.type === 'folder') {
          const children = await expandModFolder(item);
          const deduped = dedupPdfSiblings(children);
          const useSubfolder = deduped.length >= 2;

          for (const child of deduped) {
            downloadQueue.push({
              ...item,
              name: child.name,
              url: child.url,
              direct: true,
              fetchUrl: child.url,
              isChild: true,
              parentCmid: item.cmid,
              diskFolder: useSubfolder
                ? `${item.diskFolder}/${normalizeName(item.name)}`.replace(/^\//, '')
                : item.diskFolder,
            });
          }
          await delay(CONFIG.delayBetweenFetches);

        } else if (item.type === 'url') {
          const resolved = await resolveModUrl(item);
          if (!resolved) {
            skipQueue.push({ ...item, reason: 'URL resolution failed' });
          } else if (['google_docs', 'google_slides', 'google_sheets'].includes(resolved.type)) {
            downloadQueue.push({
              ...item,
              fetchUrl: resolved.url,
              googleExport: true,
              name: item.name + (resolved.type === 'google_sheets' ? '.xlsx' : '.pdf'),
            });
          } else if (resolved.type === 'google_drive_direct') {
            downloadQueue.push({
              ...item,
              fetchUrl: resolved.url,
              googleExport: true, // no credentials needed
            });
          } else if (resolved.type === 'colab') {
            skipQueue.push({ ...item, reason: 'Colab notebook — requires manual browser extraction', url: resolved.url });
          } else if (resolved.type === 'dropbox') {
            downloadQueue.push({ ...item, fetchUrl: resolved.url, direct: true });
          } else if (resolved.type === 'video') {
            // Intentionally silent — videos are not downloaded and not logged to Excel
          } else if (resolved.type === 'bgu_admin') {
            skipQueue.push({ ...item, reason: resolved.reason, url: resolved.url });
          } else {
            skipQueue.push({ ...item, reason: resolved.reason || 'external link', url: resolved.url || '' });
          }
          await delay(CONFIG.delayBetweenFetches);

        } else if (item.type === 'assign') {
          const files = await checkAssignPatternB(item);
          if (files.length > 0) {
            // Use the section's mapped folder (e.g. "תרגילי בית", "הגשות", "פרוייקט" — whatever Moodle calls it)
            const baseFolder = item.diskFolder || item.section;
            for (const file of files) {
              const diskFolder = isSolutionFile(file.name) ? `${baseFolder}/פתרונות` : baseFolder;
              downloadQueue.push({
                ...item,
                name: file.name,
                url: file.url,
                direct: true,
                fetchUrl: file.url,
                isChild: true,
                parentCmid: item.cmid,
                diskFolder,
              });
            }
          }
          await delay(CONFIG.delayBetweenFetches);

        } else {
          skipQueue.push({ ...item, reason: `unknown type: mod/${item.type}` });
        }
      }

      log(`  Download queue: ${downloadQueue.length} files`);
      log(`  Skip queue: ${skipQueue.length} items`);

      // Snapshot all resolved keys (including folder/assign children) BEFORE
      // the incremental filter removes unchanged items.  Used later for
      // removal detection so that existing children are not misidentified
      // as "removed from Moodle".
      const allResolvedKeys = new Set();
      for (const item of allItems) allResolvedKeys.add(manifestKey(item));
      for (const item of downloadQueue) allResolvedKeys.add(manifestKey(item));

      // Step 5: Filter for incremental mode
      if (mode === 'incremental') {
        log('Step 5/8: Filtering — incremental mode (with update detection)...');
        const filtered = [];
        let updatedCount = 0;
        for (const item of downloadQueue) {
          const courseManifest = state.manifest[item.courseId];
          const key = manifestKey(item);
          if (courseManifest && courseManifest.items && courseManifest.items[key]) {
            const existing = courseManifest.items[key];
            // Update detection: HEAD request to compare ETag / Content-Length
            try {
              const fetchUrl = item.fetchUrl || (item.direct
                ? item.url
                : `${CONFIG.baseUrl}/moodle/mod/resource/view.php?id=${item.cmid}`);
              const fetchOpts = { method: 'HEAD', redirect: 'follow' };
              if (!item.googleExport) fetchOpts.credentials = 'include';
              const headResp = await fetch(fetchUrl, fetchOpts);
              if (headResp.ok) {
                const newSize = parseInt(headResp.headers.get('content-length') || '0');
                const newEtag = headResp.headers.get('etag') || '';
                const sizeChanged = newSize > 0 && existing.fileSize && newSize !== existing.fileSize;
                const etagChanged = newEtag && existing.etag && newEtag !== existing.etag;
                if (sizeChanged || etagChanged) {
                  log(`  UPDATE detected: ${item.name} (size: ${existing.fileSize}→${newSize})`);
                  item._deleteOldFile = existing.savedAs; // mark old file for deletion
                  item._isUpdate = true;
                  filtered.push(item);
                  updatedCount++;
                  continue;
                }
              }
            } catch { /* HEAD failed — skip update check, keep existing */ }
            continue; // no change detected — skip
          }
          filtered.push(item);
        }
        const newCount = filtered.length - updatedCount;
        const skippedCount = downloadQueue.length - filtered.length;
        log(`  ${newCount} new, ${updatedCount} updated, ${skippedCount} unchanged`);
        downloadQueue.length = 0;
        downloadQueue.push(...filtered);

        // S4 — Download count safety valve
        const totalScraped = allItems.length;
        if (filtered.length > 10 && totalScraped > 0 && filtered.length > totalScraped * 0.5) {
          log('');
          log(`🛑 SAFETY ABORT: Incremental queue (${filtered.length}) exceeds 50% of`);
          log(`  total scraped items (${totalScraped}). This looks like a full re-download.`);
          log('  Possible causes: manifest corruption, manifest read failure, or');
          log('  Moodle changed item IDs.');
          log('');
          log('  To proceed anyway, run a SEED sync instead.');
          state.running = false;
          return;
        }
        // Removal detection: flag manifest items no longer on Moodle
        // Uses allResolvedKeys (built BEFORE filtering) so unchanged
        // folder/assign children are not incorrectly flagged as removed.
        let removedCount = 0;
        for (const [courseId, courseData] of Object.entries(state.manifest)) {
          if (!courseData.items) continue;
          for (const [key, entry] of Object.entries(courseData.items)) {
            if (entry.status === 'removed_from_moodle') continue; // already flagged
            if (!allResolvedKeys.has(key)) {
              entry.status = 'removed_from_moodle';
              entry.removedAt = new Date().toISOString();
              removedCount++;
            }
          }
        }
        if (removedCount > 0) {
          log(`  ${removedCount} items removed from Moodle (files kept on disk, flagged in manifest)`);
        }

      } else {
        log('Step 5/8: Seed mode — downloading all items');
      }

      // Step 6: Download all files
      log(`Step 6/8: Downloading ${downloadQueue.length} files...`);
      let downloaded = 0;
      let failed = 0;

      for (let i = 0; i < downloadQueue.length; i++) {
        const item = downloadQueue[i];
        if (i > 0 && i % 10 === 0) {
          await delay(CONFIG.batchPause);
        }
        if (i % 5 === 0 || i === downloadQueue.length - 1) {
          log(`  [${i + 1}/${downloadQueue.length}] ${item.courseName}/${item.name}`);
        }

        const courseHandle = await getNestedDir(state.semesterHandle, item.courseName);

        // If this is an update, delete the old file on disk first
        if (item._isUpdate && item._deleteOldFile) {
          try {
            const oldPaths = Array.isArray(item._deleteOldFile) ? item._deleteOldFile : [item._deleteOldFile];
            for (const oldPath of oldPaths) {
              if (!oldPath) continue;
              const lastSlash = oldPath.lastIndexOf('/');
              const oldDir = lastSlash > 0 ? oldPath.substring(0, lastSlash) : '';
              const oldName = lastSlash > 0 ? oldPath.substring(lastSlash + 1) : oldPath;
              const dirHandle = await getNestedDir(courseHandle, oldDir);
              await dirHandle.removeEntry(oldName);
              log(`  Deleted old version: ${oldPath}`);
            }
          } catch (e) {
            log(`  Could not delete old file: ${e.message} (will overwrite)`);
          }
        }

        const result = await downloadAndSave(item, courseHandle);
        const key = manifestKey(item);

        // Ensure course entry in manifest
        if (!state.manifest[item.courseId]) {
          state.manifest[item.courseId] = {
            courseName: item.courseName,
            folderName: item.courseName,
            lastSync: new Date().toISOString(),
            sectionMap: state.sectionMap[item.courseId] || {},
            items: {},
          };
        }

        if (result.success) {
          downloaded++;
          const status = result.extracted ? 'extracted' : 'downloaded';
          state.manifest[item.courseId].items[key] = {
            section: item.section,
            moodleName: item.name,
            type: item.type,
            status,
            savedAs: result.savedAs,
            fileSize: result.fileSize,
            etag: result.etag || '',
            downloadedAt: new Date().toISOString(),
          };
          if (result.extracted) {
            log(`  ✓ Extracted ${result.extractedCount} files from ${item.name}`);
          }
        } else {
          failed++;
          log(`  ✗ FAILED: ${item.name} — ${result.error}`);
          skipQueue.push({ ...item, reason: `download error: ${result.error}` });
        }

        await delay(CONFIG.delayBetweenFetches);
      }

      log(`  Downloads complete: ${downloaded} ok, ${failed} failed`);

      // Step 7: Save manifest with section mappings
      log('Step 7/8: Saving manifest and section mappings...');
      for (const course of CONFIG.courses) {
        if (state.manifest[course.id]) {
          state.manifest[course.id].lastSync = new Date().toISOString();
          state.manifest[course.id].sectionMap = state.sectionMap[course.id] || {};
        }
      }
      await saveManifest(state.semesterHandle, state.manifest);
      log('  Manifest saved');

      // Step 8: Generate READMEs and Excel
      log('Step 8/8: Generating READMEs and Excel...');
      for (const course of CONFIG.courses) {
        if (state.manifest[course.id]) {
          const courseHandle = await getNestedDir(state.semesterHandle, course.folderName);
          await generateReadme(courseHandle, course.folderName, state.manifest[course.id]);
        }
      }
      log('  READMEs generated');

      await generateExcel(state.semesterHandle, skipQueue);

      // Summary
      log('');
      log('╔══════════════════════════════════╗');
      log('║        SYNC COMPLETE             ║');
      log('╚══════════════════════════════════╝');
      log(`Mode: ${mode}`);
      log(`Downloaded: ${downloaded}`);
      log(`Failed: ${failed}`);
      log(`Skipped: ${skipQueue.length}`);
      log('');
      for (const course of CONFIG.courses) {
        const m = state.manifest[course.id];
        const count = m ? Object.keys(m.items).length : 0;
        log(`  ${course.folderName}: ${count} items`);
      }
      log('');
      log('Done!');

      state.results = { downloaded, failed, skipped: skipQueue.length };
      state.skipQueue = skipQueue;

    } catch (e) {
      log(`FATAL ERROR: ${e.message}`);
      log(e.stack || '');
    } finally {
      state.running = false;
      // Re-enable buttons
      const seedBtn = document.getElementById('sync-seed');
      const incBtn = document.getElementById('sync-incremental');
      if (seedBtn) seedBtn.disabled = false;
      if (incBtn) incBtn.disabled = false;
      updateUI();
    }
  }

  // ============================================================
  // UI
  // ============================================================

  function createUI() {
    const existing = document.getElementById('moodle-sync-ui');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'moodle-sync-ui';
    container.style.cssText = `
      position: fixed; top: 0; right: 0; width: 420px; height: 100vh;
      background: white; border-left: 2px solid #1565C0; z-index: 999999;
      display: flex; flex-direction: column; font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px; box-shadow: -4px 0 16px rgba(0,0,0,0.2);
    `;

    container.innerHTML = `
      <div style="padding:16px 18px;background:linear-gradient(135deg,#1565C0,#1976D2);color:white;">
        <h2 style="margin:0;font-size:18px;font-weight:700;">BGU Moodle Sync</h2>
        <p style="margin:4px 0 0;opacity:0.8;font-size:11px;">v2.3 — One-click course material sync (S1–S6 + update/removal detection)</p>
      </div>
      <div style="padding:14px 18px;display:flex;gap:10px;">
        <button id="sync-seed" style="flex:1;padding:12px 8px;background:#2E7D32;color:white;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-weight:600;transition:opacity .15s;">
          🌱 Seed Run (Full)
        </button>
        <button id="sync-incremental" style="flex:1;padding:12px 8px;background:#E65100;color:white;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-weight:600;transition:opacity .15s;">
          🔄 Incremental Sync
        </button>
      </div>
      <div id="sync-status" style="padding:8px 18px;background:#E3F2FD;font-weight:600;color:#1565C0;font-size:12px;">
        Ready. Choose a sync mode above.
      </div>
      <div id="sync-progress" style="display:none;padding:0 18px;">
        <div style="background:#e0e0e0;border-radius:4px;height:6px;margin:8px 0;">
          <div id="sync-progress-bar" style="background:#1565C0;height:100%;border-radius:4px;width:0%;transition:width .3s;"></div>
        </div>
      </div>
      <div id="sync-log" style="flex:1;overflow-y:auto;padding:10px 18px;font-family:'Cascadia Code','Fira Code',monospace;font-size:11px;white-space:pre-wrap;color:#333;background:#FAFAFA;line-height:1.5;">
      </div>
      <div style="padding:10px 18px;background:#f5f5f5;border-top:1px solid #e0e0e0;font-size:11px;color:#666;">
        Tip: Run from any moodle.bgu.ac.il page. Point picker to your root download folder.
      </div>
    `;

    document.body.appendChild(container);

    document.getElementById('sync-seed').onclick = () => {
      document.getElementById('sync-seed').disabled = true;
      document.getElementById('sync-incremental').disabled = true;
      runSync('seed').catch(e => log('FATAL: ' + e.message));
    };

    document.getElementById('sync-incremental').onclick = () => {
      document.getElementById('sync-seed').disabled = true;
      document.getElementById('sync-incremental').disabled = true;
      runSync('incremental').catch(e => log('FATAL: ' + e.message));
    };
  }

  function updateUI() {
    const logEl = document.getElementById('sync-log');
    if (logEl) {
      logEl.textContent = state.log.join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    }
    const statusEl = document.getElementById('sync-status');
    if (statusEl && state.log.length > 0) {
      statusEl.textContent = state.log[state.log.length - 1];
    }
  }

  // ============================================================
  // SETUP FORM — shown when CONFIG.courses is empty
  // ============================================================

  function showSetupForm() {
    const formHtml = `
      <div style="padding:18px;">
        <h3 style="margin:0 0 12px;font-size:15px;color:#1565C0;">First-Time Setup</h3>
        <p style="margin:0 0 12px;font-size:12px;color:#666;">
          No config found. Enter your semester details and courses below.
          This creates a <code>moodle_sync_config.json</code> in your semester folder.
          When the folder picker opens, select your <b>year folder</b> (e.g. שנה ג׳).
        </p>
        <label style="font-size:12px;font-weight:600;">Semester identifier (appears in course titles):</label>
        <input id="cfg-semester" placeholder="e.g. סמ 2" value="" style="width:100%;padding:6px;margin:4px 0 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;">

        <label style="font-size:12px;font-weight:600;">Semester folder name (inside the year folder you'll pick):</label>
        <input id="cfg-rootpath" placeholder="e.g. סמסטר ב׳" value="" style="width:100%;padding:6px;margin:4px 0 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;">

        <label style="font-size:12px;font-weight:600;">Courses (one per line: <code>ID | Folder Name</code>):</label>
        <textarea id="cfg-courses" rows="6" placeholder="64674 | הנדסת חשמל&#10;65670 | מימון" style="width:100%;padding:6px;margin:4px 0 10px;border:1px solid #ccc;border-radius:4px;font-size:12px;font-family:monospace;"></textarea>
        <p style="font-size:11px;color:#888;margin:0 0 12px;">
          Find course IDs in Moodle URLs: <code>course/view.php?id=<b>64674</b></code>
        </p>

        <button id="cfg-save" style="width:100%;padding:10px;background:#1565C0;color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600;">
          Save Config & Continue
        </button>
      </div>
    `;

    const container = document.getElementById('moodle-sync-ui');
    const logEl = document.getElementById('sync-log');
    if (logEl) logEl.innerHTML = formHtml;

    document.getElementById('cfg-save').onclick = () => {
      const semester = document.getElementById('cfg-semester').value.trim();
      const rootPath = document.getElementById('cfg-rootpath').value.trim();
      const coursesText = document.getElementById('cfg-courses').value.trim();

      if (!semester || !rootPath || !coursesText) {
        alert('Please fill in all fields.');
        return;
      }

      const courses = coursesText.split('\n').map(line => {
        const parts = line.split('|').map(s => s.trim());
        if (parts.length < 2) return null;
        return { id: parseInt(parts[0]), moodleName: '', folderName: parts[1] };
      }).filter(Boolean);

      if (courses.length === 0) {
        alert('Please enter at least one course.');
        return;
      }

      CONFIG.semesterCheck = semester;
      CONFIG.rootPath = rootPath;
      CONFIG.courses = courses;

      // Store config on window for the save step
      window.__MOODLE_SYNC_CONFIG_PENDING__ = {
        baseUrl: CONFIG.baseUrl,
        semesterCheck: semester,
        rootPath: rootPath,
        courses: courses,
        silentSkipTypes: CONFIG.silentSkipTypes,
        mergeThreshold: CONFIG.mergeThreshold,
        delayBetweenFetches: CONFIG.delayBetweenFetches,
        batchPause: CONFIG.batchPause,
      };

      // Clear form, show normal UI
      if (logEl) logEl.textContent = '';
      log(`Config set: ${courses.length} courses, semester "${semester}"`);
      log('Ready! Choose a sync mode above.');

      // Enable buttons
      document.getElementById('sync-seed').disabled = false;
      document.getElementById('sync-incremental').disabled = false;
    };

    // Disable sync buttons until config is saved
    document.getElementById('sync-seed').disabled = true;
    document.getElementById('sync-incremental').disabled = true;
  }

  // ============================================================
  // INITIALIZE
  // ============================================================

  (async function init() {
    createUI();

    const configLoaded = await loadConfig();

    if (configLoaded && CONFIG.courses.length > 0) {
      log(`Sync engine v2.3 loaded. ${CONFIG.courses.length} courses configured.`);
      log('Choose a mode to begin.');
    } else {
      log('No config found — showing setup form...');
      showSetupForm();
    }
  })();

})();
