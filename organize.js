/* DayCasion Desktop Import: Sort My Photos by Date (Bulk Import Memories, second choice).
 * A folder (with all its subfolders) is read on this computer: dates taken, small previews, nothing uploaded. Photos are
 * shown by year and month; the member selects photos and creates one memory at a time with DayCasion's existing import
 * steps (dc_import_start 'organize', dc_import_add_items, upload or in-storage copy, dc_import_finalize_item,
 * dc_import_begin_save, move, dc_import_attach_item, dc_import_finish_group, dc_import_finish). Only the selected photos
 * are uploaded. Photos already in one of this profile's memories show "Already used" (DayCasion's import records, on any
 * computer) and can be chosen again: they are stored again as a separate copy, made inside DayCasion's storage.
 * Unfinished work (date corrections, selections) is kept in this browser only (IndexedDB), never photos or previews.
 * Plain DOM; all member text through textContent; no inline styles (CSP). */
(function () {
  'use strict';
  const C = window.DcImport;
  const ORGANIZE_MAX = 50000;       // files read in one session (measured: 50,000 in about 20 s, 43 MB; see the README)
  const READS_AT_ONCE = 4;          // files read at the same time
  const HASHES_AT_ONCE = 2;
  const THUMBS_AT_ONCE = 4;
  const PAGE = 240;                 // tiles drawn at a time in one gallery
  const THUMB_KEEP = 900;           // small previews kept in memory (the oldest are released)
  const HEAD = { 'image/jpeg': 131072, 'image/png': 262144, 'image/webp': 262144, 'image/heic': 262144, 'image/heif': 262144 };
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let X = null; // helpers from app.js
  const O = { scan: 0, files: [], byKey: new Map(), fileOf: new Map(), skipped: [], server: null, corrections: {}, reviewed: {},
    selected: new Set(), org: null, view: { kind: 'dash' }, thumbs: new Map(), folder: '', handle: null, hashing: { total: 0, done: 0 },
    busy: false, pending: null, dashY: 0, page: 1, saved: null, cancelled: false };

  // ------------------------------------------------------------------ browser-local progress (this computer only)
  const IDB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((resolve, reject) => {
        let req; try { req = indexedDB.open('dc-organize', 1); } catch (e) { return reject(e); }
        req.onupgradeneeded = () => req.result.createObjectStore('s');
        req.onsuccess = () => { this.db = req.result; resolve(this.db); };
        req.onerror = () => reject(req.error);
      });
    },
    async run(mode, fn) { const db = await this.open(); return new Promise((resolve, reject) => {
      const tx = db.transaction('s', mode); const st = tx.objectStore('s'); let out; const r = fn(st); if (r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => resolve(out); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); },
    get(k) { return this.run('readonly', (s) => s.get(k)).catch(() => null); },
    put(k, v) { return this.run('readwrite', (s) => s.put(v, k)).catch(() => null); },
    del(k) { return this.run('readwrite', (s) => s.delete(k)).catch(() => null); },
    keys() { return this.run('readonly', (s) => s.getAllKeys()).catch(() => []); },
  };
  const uid = () => { const s = X.session(); return s && s.user && s.user.id; };
  const localKey = () => `${uid()}:${X.profile.id}`;
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const sel = [...O.selected].map((k) => O.byKey.get(k)).filter(Boolean).map((f) => f.qid);
      IDB.put(localKey(), { folder: O.folder, updatedAt: new Date().toISOString(), corrections: O.corrections, reviewed: O.reviewed,
        selected: sel, view: O.view.kind === 'month' ? { year: O.view.year, month: O.view.month } : null });
    }, 400);
  }
  async function hasLocal(user) { const ks = await IDB.keys(); return (ks || []).some((k) => String(k).startsWith(`${user}:`)); }
  async function forget(user) { for (const k of (await IDB.keys()) || []) if (String(k).startsWith(`${user}:`)) await IDB.del(k); }

  // ------------------------------------------------------------------ small helpers
  const el = (...a) => X.el(...a);
  const card = (...k) => X.card(...k);
  const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length && !O.cancelled) await fn(items[i++]); })); };
  const read = (file, from, to) => file.slice(from, to).arrayBuffer();
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const monthName = (m) => (m ? MONTHS[m - 1] : 'Month not known');
  const fmtDay = (d) => { if (!d) return 'Date not known'; return C.dateLabel(d.date, d.precision); };
  let toastTimer = null;
  function toast(text) {
    let t = document.getElementById('org-toast');
    if (!t) { t = el('div', { id: 'org-toast', class: 'toast', role: 'status' }); document.body.append(t); }
    t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }
  const access = () => { const st = X.storage(); const p = st && (st.profiles || []).find((x) => x.profile_id === X.profile.id); return { enforced: !!(st && st.enforced), video: !p || !st.enforced || !!(p.access && p.access.video) }; };
  const storageLeft = () => { const st = X.storage(); return st && st.allowance_bytes ? st.allowance_bytes - st.used_bytes : null; };

  /** used | waiting | uploading | failed | null for a file. */
  function statusOf(f) {
    if (f.state === 'uploading' || f.state === 'failed') return f.state;
    const s = f.hash && O.server && O.server.byHash.get(f.hash);
    if (s && s.used) return 'used';
    if (s && s.waiting) return 'waiting';
    return null;
  }
  const blocked = (f) => (f.kind === 'video' && !access().video) ? 'Needs the Video plan' : statusOf(f) === 'waiting' ? 'Waiting in the app' : statusOf(f) === 'uploading' ? 'Uploading' : null;

  // ------------------------------------------------------------------ 1. start: choose (or reconnect) the folder
  async function open(helpers) {
    X = helpers; O.saved = null; O.handle = null;
    O.saved = await IDB.get(localKey());
    const h = await IDB.get(localKey() + ':handle');
    O.handle = h && typeof h.queryPermission === 'function' ? h : null;
    viewStart();
  }

  function viewStart(message) {
    const folderInput = el('input', { type: 'file', class: 'visually-hidden', id: 'org-folder', webkitdirectory: true, multiple: true });
    folderInput.addEventListener('change', () => { const list = [...folderInput.files].map((f) => ({ file: f, relativePath: f.webkitRelativePath || f.name })); folderInput.value = ''; if (list.length) scan(list); });
    const fsa = typeof window.showDirectoryPicker === 'function';
    const pickBtn = fsa ? el('button', { id: 'org-pick', onclick: () => pickWithAccess(folderInput), text: 'Choose a folder' })
      : el('label', { for: 'org-folder', class: 'btn', role: 'button', tabindex: '0', id: 'org-pick', text: 'Choose a folder' });
    const drop = el('div', { class: 'drop', id: 'org-drop' },
      el('p', { text: 'Drop a folder here, or choose one. Its subfolders are included.' }),
      el('p', { class: 'muted small', text: `Photos: JPEG, HEIC, PNG or WebP, up to 50 MB. Videos: MP4 or MOV, up to ${Math.round(C.LIMITS.videoBytes / 1048576)} MB. Up to ${ORGANIZE_MAX.toLocaleString()} files at a time: for a very large collection, choose one year or one drive folder at a time.` }),
      el('div', { class: 'actions' }, pickBtn, O.handle && O.saved ? el('button', { class: 'secondary', id: 'org-reconnect', onclick: () => reconnect(folderInput), text: `Reconnect “${O.saved.folder}”` }) : null),
      folderInput);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); const list = await X.filesFromDrop(e.dataTransfer); if (list.length) scan(list); });
    const sv = O.saved;
    X.show(card(el('h2', { text: MODES_LABEL }), X.crumbs(),
      el('p', { class: 'intro', text: 'Choose a folder, even a whole year or a drive folder with many subfolders. DayCasion sorts the photos by the date they were taken, by year and month, right here on your computer. Then select the photos from one moment, for example 15 from Christmas morning, and create a memory from them.' }),
      sv ? el('div', { class: 'note', id: 'org-resume' },
        el('strong', { text: `Continue sorting “${sv.folder}”` }),
        el('p', { class: 'small', text: `Last sorted on ${new Date(sv.updatedAt).toLocaleString()}. Choose the same folder again${O.handle ? ', or reconnect it,' : ''} to continue: photos you've already made into memories show as Already used, and your date changes and selections come back.` }),
        el('button', { class: 'link', id: 'org-fresh', onclick: async () => { if (await X.ask('Start fresh?', 'Your unfinished date changes and selections on this computer are forgotten. Memories you created stay in DayCasion.', 'Start fresh')) { await IDB.del(localKey()); await IDB.del(localKey() + ':handle'); O.saved = null; O.handle = null; viewStart(); } }, text: 'Start fresh instead' })) : null,
      message ? el('p', { class: 'err', role: 'alert', text: message }) : null,
      drop,
      el('ul', { class: 'tips small muted' },
        el('li', { text: 'Nothing is uploaded while you sort. When you create a memory, only its photos are uploaded.' }),
        el('li', { text: 'Your browser may ask to let this site view or "upload" the folder: that only lets this page read it on your computer.' }),
        el('li', { text: 'Unfinished date changes and selections are kept in this browser on this computer only. Memories you create are in DayCasion everywhere.' }))));
  }
  const MODES_LABEL = 'Sort My Photos by Date';

  async function pickWithAccess(folderInput) {
    let dir;
    try { dir = await window.showDirectoryPicker({ id: 'dc-organize', mode: 'read' }); }
    catch (e) {
      if (e && e.name === 'AbortError') return;
      // Some folders (system folders, some drive roots) can't be opened this way: the classic folder choice works.
      return viewStart('Your browser could not open that folder this way. Choose it again with the button below, or choose a folder inside it.'), swapToClassic();
    }
    await IDB.put(localKey() + ':handle', dir); O.handle = dir;
    scan(null, dir);
  }
  function swapToClassic() {
    const b = document.getElementById('org-pick');
    if (b && b.tagName === 'BUTTON') b.replaceWith(el('label', { for: 'org-folder', class: 'btn', role: 'button', tabindex: '0', id: 'org-pick', text: 'Choose a folder' }));
  }
  async function reconnect(folderInput) {
    try {
      let p = await O.handle.queryPermission({ mode: 'read' });
      if (p !== 'granted') p = await O.handle.requestPermission({ mode: 'read' });
      if (p === 'granted') return scan(null, O.handle);
    } catch (e) { /* moved, renamed or disconnected */ }
    viewStart(`“${O.saved ? O.saved.folder : 'The folder'}” couldn't be opened. If it's on an external drive, connect it, or choose the folder again.`);
  }

  // ------------------------------------------------------------------ 2. scan: find files, read dates (nothing uploaded)
  async function* walk(dir, prefix) {
    for await (const [name, h] of dir.entries()) {
      if (O.cancelled) return;
      if (h.kind === 'file') { try { yield { file: await h.getFile(), relativePath: prefix + name }; } catch (e) { O.skipped.push({ relativePath: prefix + name, reason: 'unreadable', message: "This file couldn't be read." }); } }
      else if (!/^(\.|@eadir$|__macosx$|\$recycle\.bin$|system volume information$|\.thumbnails$)/i.test(name)) yield* walk(h, prefix + name + '/');
    }
  }

  async function scan(list, dir) {
    releaseThumbs(); O.scan++; const scanId = O.scan; O.cancelled = false;
    O.files = []; O.byKey = new Map(); O.fileOf = new Map(); O.skipped = []; O.selected = new Set(); O.view = { kind: 'dash' }; O.pending = null; O.dashY = 0;
    const status = el('p', { class: 'progress-line', text: 'Looking through your folders…' });
    const bar = el('div', {});
    X.show(card(el('h2', { text: 'Sorting your photos by date' }), status, el('div', { class: 'progress' }, bar),
      el('p', { class: 'small muted', text: 'This happens on your computer. Nothing is uploaded.' }),
      el('div', { class: 'actions' }, el('button', { class: 'secondary', id: 'org-cancel-scan', onclick: () => { O.cancelled = true; }, text: 'Cancel' }))));
    const serverP = loadServer(scanId);
    const t0 = performance.now();
    let found = list || [];
    if (dir) {
      found = []; O.folder = dir.name;
      for await (const x of walk(dir, dir.name + '/')) { found.push(x); if (found.length % 250 === 0) status.textContent = `Found ${found.length.toLocaleString()} files so far…`; }
    } else {
      const tops = new Set(found.map((x) => x.relativePath.split('/')[0]));
      O.folder = [...tops].slice(0, 2).join(', ') || 'your files';
    }
    if (O.cancelled) return viewStart('Sorting was cancelled. Nothing was uploaded.');
    const work = [];
    for (const x of found) {
      const c = C.classify(x.relativePath, x.file.size);
      if (c.ignore) continue;
      if (c.skip) { O.skipped.push({ relativePath: x.relativePath, reason: c.reason, kind: c.kind, message: c.message }); continue; }
      x.cls = c; work.push(x);
    }
    if (work.length > ORGANIZE_MAX) {
      for (const x of work.splice(ORGANIZE_MAX)) O.skipped.push({ relativePath: x.relativePath, reason: 'limit', message: `Sort My Photos by Date reads up to ${ORGANIZE_MAX.toLocaleString()} files at a time. Choose a smaller folder (for example one year) for the rest.` });
    }
    let done = 0, n = 0;
    const seen = new Map();
    await pool(work, READS_AT_ONCE, async (x) => {
      try {
        const f = await readOne(x, scanId, ++n);
        if (scanId !== O.scan) return;
        const first = seen.get(f.qid);
        if (first) { O.skipped.push({ relativePath: f.relativePath, reason: 'duplicate_in_selection', kind: f.kind, message: `Same file as ${first.relativePath}` }); return; }
        seen.set(f.qid, f); O.files.push(f); O.byKey.set(f.key, f); O.fileOf.set(f.key, x.file);
      } catch (e) { O.skipped.push({ relativePath: x.relativePath, reason: 'unreadable', message: "This file couldn't be read." }); }
      finally {
        done++;
        if (done % 20 === 0 || done === work.length) { status.textContent = `Reading dates: ${done.toLocaleString()} of ${work.length.toLocaleString()} files`; bar.style.width = `${Math.round((100 * done) / Math.max(1, work.length))}%`; }
      }
    });
    if (O.cancelled || scanId !== O.scan) return viewStart('Sorting was cancelled. Nothing was uploaded.');
    O.stats = { files: O.files.length, ms: Math.round(performance.now() - t0) };
    // Unfinished work from an earlier visit (this browser): matched by file content, not by name.
    const sv = O.saved && (O.saved.folder || O.saved.corrections) ? O.saved : null;
    O.corrections = {}; O.reviewed = {};
    const have = new Set(O.files.map((f) => f.qid));
    if (sv) {
      for (const [q, c] of Object.entries(sv.corrections || {})) if (have.has(q)) O.corrections[q] = c;
      for (const q of Object.keys(sv.reviewed || {})) if (have.has(q)) O.reviewed[q] = true;
      const byQ = new Map(O.files.map((f) => [f.qid, f]));
      for (const q of sv.selected || []) { const f = byQ.get(q); if (f) O.selected.add(f.key); }
      O.restoreView = sv.view;
    }
    await serverP;
    if (scanId !== O.scan) return;
    regroup(); persist();
    viewDash(true);
    hashKnownSizes(scanId);
  }

  /** Reads what sorting needs from the start of a file (and, for videos, its movie box): the date taken, size, length,
   *  and a content fingerprint of its first and last 64 KB (to recognise it again on a later visit, whatever its name). */
  async function readOne(x, scanId, n) {
    const file = x.file; const { kind, mime } = x.cls; const size = file.size;
    let meta;
    const head = await read(file, 0, Math.min(size, kind === 'video' ? 65536 : HEAD[mime] || 131072));
    if (kind === 'video') {
      const at = await C.findMoov((o, len) => read(file, o, Math.min(size, o + len)), size);
      const moov = at ? await read(file, at.offset, at.offset + Math.min(at.size, 64 * 1048576)) : null;
      meta = moov ? C.readMetadata('video', mime, moov) : { durationSeconds: null, capture: null, width: null, height: null, extra: {} };
    } else {
      meta = C.readMetadata('photo', mime, head);
      if (!meta.capture && (mime === 'image/heic' || mime === 'image/heif') && size > head.byteLength) meta = C.readMetadata('photo', mime, await read(file, 0, size)); // EXIF further in
    }
    const tail = size > 131072 ? await read(file, size - 65536, size) : new ArrayBuffer(0);
    const sz = new TextEncoder().encode(String(size) + ':');
    const qbuf = new Uint8Array(sz.length + Math.min(65536, head.byteLength) + tail.byteLength);
    qbuf.set(sz, 0); qbuf.set(new Uint8Array(head, 0, Math.min(65536, head.byteLength)), sz.length); qbuf.set(new Uint8Array(tail), sz.length + Math.min(65536, head.byteLength));
    const qid = hex(await crypto.subtle.digest('SHA-256', qbuf)).slice(0, 40);
    return { key: `o${scanId}f${n}`, qid, relativePath: x.relativePath, folderPath: C.dirName(x.relativePath), kind, mime, size,
      capture: meta.capture, width: meta.width, height: meta.height, durationSeconds: meta.durationSeconds, extra: meta.extra, lastModified: file.lastModified, hash: null };
  }

  // ------------------------------------------------------------------ DayCasion's records: Already used / Waiting in the App
  async function loadServer(scanId) {
    const pid = X.profile.id; const byHash = new Map(); const sizes = new Set();
    try {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const r = await X.authed(`/rest/v1/import_items?select=content_hash,size_bytes,status,group_id,metadata&memory_profile_id=eq.${pid}&order=id`, { headers: { Range: `${from}-${from + 999}` } });
        if (!r.ok) throw new Error('items'); rows.push(...r.data); if (r.data.length < 1000) break;
      }
      const g = await X.authed(`/rest/v1/import_groups?select=id,memory_id,status,title&memory_profile_id=eq.${pid}`);
      const groups = new Map(((g.ok && g.data) || []).map((x) => [x.id, x]));
      const memIds = [...new Set([...groups.values()].map((x) => x.memory_id).filter(Boolean))];
      const titles = new Map();
      for (let i = 0; i < memIds.length; i += 80) {
        const m = await X.authed(`/rest/v1/memories?select=id,title&id=in.(${memIds.slice(i, i + 80).join(',')})`);
        if (m.ok) for (const x of m.data) titles.set(x.id, (x.title || '').trim() || 'Untitled memory');
      }
      for (const r of rows) {
        const grp = groups.get(r.group_id);
        const e = byHash.get(r.content_hash) || { used: false, waiting: false, titles: [], memberDate: null };
        if (r.status === 'organized') { e.used = true; const t = grp && grp.memory_id ? titles.get(grp.memory_id) : null; if (t && !e.titles.includes(t)) e.titles.push(t); }
        else if (grp && grp.status === 'open') e.waiting = true;
        const md = r.metadata && r.metadata.member_date;
        if (md && md.precision && !e.memberDate) e.memberDate = { date: md.date || null, precision: md.precision };
        byHash.set(r.content_hash, e); sizes.add(+r.size_bytes);
      }
      if (scanId === O.scan) O.server = { byHash, sizes, ok: true };
    } catch (e) { if (scanId === O.scan) O.server = { byHash, sizes, ok: false }; }
  }

  /** Full SHA-256 only where it can matter: files the size of something already imported for this profile. The rest
   *  can't be in DayCasion yet (same content means same size), so they are fingerprinted only when imported. */
  async function hashKnownSizes(scanId) {
    const todo = O.files.filter((f) => !f.hash && O.server && O.server.sizes.has(f.size));
    O.hashing = { total: todo.length, done: 0 };
    paintHashing();
    let last = performance.now();
    await pool(todo, HASHES_AT_ONCE, async (f) => {
      if (scanId !== O.scan) return;
      try { await fullHash(f); } catch (e) { /* unreadable now: stays unrecognised */ }
      O.hashing.done++;
      if (performance.now() - last > 500) { last = performance.now(); if (scanId === O.scan) { paintHashing(); patchStatuses(); } }
    });
    if (scanId === O.scan) { const moved = applyServerDates(); if (moved) refreshView(); else { patchStatuses(); paintHashing(); refreshCounts(); } }
  }
  async function fullHash(f) {
    if (f.hash) return f.hash;
    const file = O.fileOf.get(f.key);
    f.hash = await C.sha256Hex(await file.arrayBuffer());
    return f.hash;
  }
  /** Dates saved with earlier imports (corrections made before those photos became memories). True when photos moved. */
  function applyServerDates() {
    let changed = false;
    for (const f of O.files) {
      const s = f.hash && O.server && O.server.byHash.get(f.hash);
      if (s && s.memberDate && !f.memberDate) { const before = placeOf(f); f.memberDate = s.memberDate; if (placeOf(f) !== before) changed = true; }
    }
    if (changed) regroup();
    return changed;
  }
  /** Updates the tiles on screen whose status changed (Already used, Waiting in the App), without redrawing the page. */
  function patchStatuses() {
    const grid = document.getElementById('org-grid'); if (!grid) return;
    const keys = keysOfView();
    for (const t of grid.querySelectorAll('.tile.org')) {
      const f = O.byKey.get(t.dataset.file); if (!f) continue;
      if ((statusOf(f) || 'open') !== t.dataset.status || !!blocked(f) !== t.classList.contains('blocked')) t.replaceWith(tile(f, keys));
    }
    observeTiles(grid);
  }
  /** The counts and the selection bar of the gallery or the dashboard, in place. */
  function refreshCounts() {
    if (O.view.kind === 'dash') { if (document.getElementById('org-total')) viewDash(false); return; }
    const line = document.getElementById('org-month-counts'); if (!line) return;
    const c = counts(keysOfView());
    line.textContent = countsText(c);
    const bar = document.getElementById('org-bar'); if (bar) bar.replaceWith(selBar(keysOfView()));
  }
  const countsText = (c) => `${plural(c.total, 'photo')} found · ${c.used.toLocaleString()} used in memories · ${c.open.toLocaleString()} not yet used${c.waiting ? ` · ${c.waiting.toLocaleString()} waiting in the app` : ''}`;
  function paintHashing() {
    const line = document.getElementById('org-hashing'); if (!line) return;
    const h = O.hashing;
    line.textContent = !O.server || !O.server.ok ? "DayCasion couldn't check which photos are already in memories. Try choosing the folder again."
      : h.total && h.done < h.total ? `Checking which photos are already in DayCasion: ${h.done.toLocaleString()} of ${h.total.toLocaleString()}…` : '';
  }

  function regroup() { O.org = C.organizeByDate(O.files, { corrections: O.corrections, reviewed: O.reviewed }); }

  // ------------------------------------------------------------------ 3. the dashboard: years and months
  function counts(keys) {
    let used = 0, waiting = 0;
    for (const k of keys) { const s = statusOf(O.byKey.get(k)); if (s === 'used') used++; else if (s === 'waiting') waiting++; }
    return { total: keys.length, used, waiting, open: keys.length - used - waiting };
  }
  const allKeys = () => O.files.map((f) => f.key);

  function viewDash(fresh) {
    O.view = { kind: 'dash' }; O.page = 1;
    const org = O.org; const t = org.totals; const c = counts(allKeys());
    const stat = (n, label, id) => el('div', { class: 'stat', id }, el('strong', { text: n.toLocaleString() }), el('span', { text: label }));
    const years = org.years.map((y) => {
      const yk = y.months.flatMap((m) => m.items); const yc = counts(yk);
      const open = org.years.length <= 3 || (O.restoreView && O.restoreView.year === y.year);
      return el('details', { class: 'year', 'data-year': String(y.year), open: open || null },
        el('summary', {}, el('span', { class: 'y', text: String(y.year) }), el('span', { class: 'muted small', text: ` ${plural(y.count, 'photo')}${yc.used ? ` · ${yc.used.toLocaleString()} used in memories` : ''}` })),
        el('div', { class: 'months' }, y.months.map((m) => {
          const mc = counts(m.items);
          return el('button', { class: 'month', 'data-month': `${y.year}-${m.month}`, onclick: () => openMonth(y.year, m.month) },
            el('strong', { text: monthName(m.month) }), el('span', { text: plural(m.items.length, 'photo') }),
            mc.used ? el('span', { class: 'used-count', text: `${mc.used.toLocaleString()} used` }) : null);
        })));
    });
    const special = [
      org.review.length ? el('button', { class: 'month special', id: 'org-review', onclick: () => openList('review') }, el('strong', { text: 'Check these dates' }), el('span', { text: `${plural(org.review.length, 'photo')} with a camera's default or an impossible date` })) : null,
      org.unknown.length ? el('button', { class: 'month special', id: 'org-unknown', onclick: () => openList('unknown') }, el('strong', { text: 'Dates Unknown' }), el('span', { text: `${plural(org.unknown.length, 'photo')} without a date taken` })) : null,
    ].filter(Boolean);
    const rv = O.restoreView && org.years.some((y) => y.year === O.restoreView.year && y.months.some((m) => m.month === O.restoreView.month)) ? O.restoreView : null;
    const nodes = [card(
      el('div', { class: 'row' }, el('h2', { text: 'Organize Your Photos' }),
        el('button', { class: 'link', id: 'org-other-folder', onclick: async () => { if (!O.selected.size || await X.ask('Choose a different folder?', 'Your selection is kept in this browser and comes back when you choose this folder again.', 'Choose a different folder')) { releaseThumbs(); O.scan++; viewStart(); } }, text: 'Choose a different folder' })),
      X.crumbs(),
      el('p', { class: 'muted small', text: `From “${O.folder}” on this computer. Nothing has been uploaded.` }),
      el('div', { class: 'stats' }, stat(t.files, t.files === 1 ? 'photo or video found' : 'photos and videos found', 'org-total'), stat(t.years, t.years === 1 ? 'year' : 'years', 'org-years'),
        stat(t.dated, 'dated', 'org-dated'), stat(t.needReview, 'need a date check', 'org-review-count'),
        stat(c.used, 'already used in memories', 'org-used'), c.waiting ? stat(c.waiting, 'waiting in the app', 'org-waiting') : null),
      el('p', { class: 'small muted', id: 'org-hashing' }),
      rv ? el('div', { class: 'note' }, el('span', { text: `You were looking at ${monthName(rv.month)} ${rv.year}. ` }),
        el('button', { class: 'link', id: 'org-continue', onclick: () => { O.restoreView = null; openMonth(rv.year, rv.month); }, text: 'Continue there' })) : null,
      O.selected.size ? el('div', { class: 'note' }, el('span', { text: `${plural(O.selected.size, 'photo')} selected. ` }),
        el('button', { class: 'link', onclick: () => openList('selected'), text: 'See them and create a memory' })) : null,
      O.skipped.length ? skippedList() : null),
    special.length ? card(el('h3', { text: 'Need your help' }), el('div', { class: 'months' }, special)) : null,
    org.years.length ? card(el('h3', { text: 'By year and month' }), el('div', { class: 'years' }, years))
      : card(el('p', { text: 'None of these photos has a date taken. Open Dates Unknown to give them dates, or select photos there and create a memory.' }))];
    if (fresh) X.show(...nodes); else X.redrawInPlace(...nodes);
    if (!fresh && O.dashY) window.scrollTo(0, O.dashY);
    paintHashing();
  }
  const plural = (n, one, many) => X.plural(n, one, many);

  function skippedList() {
    const by = new Map();
    for (const s of O.skipped) { const k = s.message || C.REASONS[s.reason] || s.reason; if (!by.has(k)) by.set(k, []); by.get(k).push(s.relativePath); }
    return el('details', { class: 'skipped' }, el('summary', { text: C.skippedSummary(O.skipped) }),
      [...by].map(([why, paths]) => el('div', {}, el('h3', { text: `${why} (${paths.length})` }),
        el('ul', { class: 'files' }, paths.slice(0, 200).map((p) => el('li', {}, el('span', { class: 'path', text: p }))), paths.length > 200 ? el('li', { text: `…and ${paths.length - 200} more` }) : null))));
  }

  // ------------------------------------------------------------------ 4. a gallery: a month, Dates Unknown, dates to check
  function keysOfView(v = O.view) {
    if (v.kind === 'month') { const y = O.org.years.find((x) => x.year === v.year); const m = y && y.months.find((x) => x.month === v.month); return m ? m.items : []; }
    if (v.kind === 'unknown') return O.org.unknown;
    if (v.kind === 'review') return O.org.review;
    if (v.kind === 'selected') return [...O.selected].filter((k) => O.byKey.has(k));
    return [];
  }
  function openMonth(year, month) { O.dashY = window.scrollY; O.view = { kind: 'month', year, month }; O.page = 1; O.restoreView = null; persist(); viewGallery(true); }
  function openList(kind) { O.dashY = window.scrollY; O.view = { kind }; O.page = 1; viewGallery(true); }
  function refreshView() { if (!document.getElementById('org-gallery') && !document.getElementById('org-total')) return; if (O.view.kind === 'dash') viewDash(false); else viewGallery(false); }

  function viewGallery(fresh) {
    const v = O.view;
    if (v.kind === 'month' && !keysOfView().length) { viewDash(true); return; } // everything moved away
    const keys = keysOfView();
    const c = counts(keys);
    const title = v.kind === 'month' ? `${monthName(v.month)} ${v.year}` : v.kind === 'unknown' ? 'Dates Unknown' : v.kind === 'review' ? 'Check these dates' : 'Selected photos';
    const intro = v.kind === 'unknown' ? 'These photos and videos have no date taken (scans and copies often don\'t). Select some and choose Change date to place them in a month, or create a memory from them as they are.'
      : v.kind === 'review' ? 'These dates look like a camera\'s default setting (for example 1 January 2000 at midnight) or are in the future. Change them, or keep them if they are right.'
        : v.kind === 'selected' ? 'Everything you have selected, from any month.' : null;
    // Memories made from photos in this view (from DayCasion's records and this visit).
    const made = new Map();
    for (const k of keys) { const s = O.byKey.get(k).hash && O.server && O.server.byHash.get(O.byKey.get(k).hash); if (s && s.used) for (const t of s.titles) made.set(t, (made.get(t) || 0) + 1); }
    const grid = el('div', { class: 'grid org', id: 'org-grid' });
    const shown = keys.slice(0, PAGE * O.page);
    for (const k of shown) grid.append(tile(O.byKey.get(k), keys));
    const bar = selBar(keys);
    const nodes = [card(
      el('div', { class: 'row' }, el('h2', { id: 'org-gallery', text: title }), el('button', { class: 'link', id: 'org-back', onclick: () => viewDash(false), text: 'Back to all years' })),
      X.crumbs(),
      el('p', { class: 'muted', id: 'org-month-counts', text: countsText(c) }),
      intro ? el('p', { class: 'small', text: intro }) : null,
      made.size ? el('div', { class: 'note small', id: 'org-made' }, el('strong', { text: 'Created memories: ' }),
        [...made].map(([t, n]) => `${t}: ${plural(n, 'photo')}`).join(' · ')) : null,
      el('p', { class: 'small muted', id: 'org-hashing' }),
      el('div', { class: 'sticky' }, bar),
      grid,
      keys.length > shown.length ? el('div', { class: 'actions' }, el('button', { class: 'secondary', id: 'org-more', onclick: () => { O.page++; viewGallery(false); }, text: `Show ${Math.min(PAGE, keys.length - shown.length).toLocaleString()} more of ${keys.length.toLocaleString()}` })) : null)];
    if (fresh) X.show(...nodes); else X.redrawInPlace(...nodes);
    paintHashing();
    observeTiles(grid);
  }

  function selBar(keys) {
    const v = O.view;
    const sel = keys.filter((k) => O.selected.has(k));
    const selectable = keys.filter((k) => !blocked(O.byKey.get(k)));
    const allSel = O.selected.size;
    return el('div', { class: 'selbar org-bar', id: 'org-bar', role: 'region', 'aria-label': 'Selected photos' },
      el('strong', { id: 'org-selcount', text: allSel ? `${plural(allSel, 'photo')} selected${allSel !== sel.length && v.kind !== 'selected' ? ` (${sel.length.toLocaleString()} here)` : ''}` : 'Select the photos from one moment' }),
      el('button', { class: 'small secondary', id: 'org-select-all', disabled: !selectable.length || null, onclick: () => { for (const k of selectable) O.selected.add(k); persist(); viewGallery(false); }, text: 'Select all here' }),
      el('button', { class: 'small secondary', id: 'org-clear', disabled: !allSel || null, onclick: () => { O.selected = new Set(); persist(); viewGallery(false); }, text: 'Clear selection' }),
      el('button', { class: 'small secondary', id: 'org-change-date', disabled: !sel.length || null, onclick: () => dateDialog(sel), text: sel.length ? `Change date (${sel.length.toLocaleString()})` : 'Change date' }),
      v.kind === 'review' ? el('button', { class: 'small secondary', id: 'org-keep-dates', disabled: !sel.length || null, onclick: () => { for (const k of sel) O.reviewed[O.byKey.get(k).qid] = true; regroup(); persist(); toast(`${plural(sel.length, 'date')} kept as taken.`); viewGallery(false); }, text: 'Keep these dates' }) : null,
      el('button', { id: 'org-create', disabled: !allSel || O.busy || null, onclick: () => createDialog(), text: `Create Memory (${plural(allSel, 'Photo')})` }));
  }
  function toggle(f) {
    if (O.selected.has(f.key)) O.selected.delete(f.key); else O.selected.add(f.key);
    persist();
    if (O.view.kind === 'selected') return viewGallery(false);
    const t = document.querySelector(`.tile.org[data-file="${f.key}"]`);
    if (t) { const on = O.selected.has(f.key); t.classList.toggle('on', on); const b = t.querySelector('.tile-sel'); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', b.getAttribute('aria-label').replace(/^(Selected|Select) /, on ? 'Selected ' : 'Select ')); }
    const bar = document.getElementById('org-bar'); if (bar) bar.replaceWith(selBar(keysOfView()));
  }

  function tile(f, keys) {
    const st = statusOf(f); const no = blocked(f); const on = O.selected.has(f.key);
    const d = C.sortDate(f, O.corrections);
    const t = el('div', { class: `tile org${on ? ' on' : ''}${no ? ' blocked' : ''}${st ? ' ' + st : ''}`, 'data-file': f.key, 'data-status': st || 'open', title: f.relativePath });
    const s = f.hash && O.server && O.server.byHash.get(f.hash);
    const pick = el('button', { type: 'button', class: 'tile-sel', 'aria-pressed': on ? 'true' : 'false', disabled: no ? true : null,
      'aria-label': `${on ? 'Selected' : 'Select'} ${C.baseName(f.relativePath)}${st === 'used' ? ', already used' : ''}${no ? `, ${no}` : ''}`,
      onclick: () => toggle(f) });
    const img = el('img', { alt: '', decoding: 'async' });
    const cached = O.thumbs.get(f.key);
    if (cached) img.src = cached; else { img.dataset.key = f.key; pick.append(el('span', { class: 'placeholder', text: f.kind === 'video' ? 'Video' : C.baseName(f.relativePath) })); }
    pick.append(img, el('span', { class: 'check', 'aria-hidden': 'true' }));
    if (st === 'used') pick.append(el('span', { class: 'flag used', text: 'Already used', title: s && s.titles.length ? `In ${s.titles.join(', ')}` : 'Already in a memory' }));
    else if (no) pick.append(el('span', { class: 'flag', text: no }));
    if (f.state === 'failed') pick.append(el('span', { class: 'flag err', text: "Didn't upload" }));
    if (f.kind === 'video') pick.append(el('span', { class: 'badge', text: `▶ ${f.durationSeconds ? Math.round(f.durationSeconds) + 's' : 'video'}` }));
    pick.append(el('span', { class: 'name', text: d ? (d.precision === 'day' && f.capture && f.capture.local && d.source !== 'member' ? new Date(f.capture.local).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : fmtDay(d)) : C.baseName(f.relativePath) }));
    t.append(pick, el('button', { type: 'button', class: 'tile-view', 'aria-label': `View ${C.baseName(f.relativePath)}`, onclick: () => viewer(f.key, keys), text: 'View' }));
    return t;
  }

  // ------------------------------------------------------------------ small previews, made only for tiles on screen
  let observer = null; const thumbQ = []; let thumbActive = 0;
  function observeTiles(grid) {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const img = e.target; const key = img.dataset.key; if (!key) continue;
        const i = thumbQ.findIndex((q) => q.img === img);
        if (e.isIntersecting && i < 0) thumbQ.push({ img, key, scan: O.scan }); else if (!e.isIntersecting && i >= 0) thumbQ.splice(i, 1);
      }
      pumpThumbs();
    }, { rootMargin: '400px 0px' });
    for (const img of grid.querySelectorAll('img[data-key]')) observer.observe(img);
  }
  function pumpThumbs() {
    while (thumbActive < THUMBS_AT_ONCE && thumbQ.length) {
      const q = thumbQ.shift(); thumbActive++;
      makeThumb(q.key).then((url) => {
        if (url && q.scan === O.scan && q.img.isConnected) { q.img.src = url; delete q.img.dataset.key; const ph = q.img.parentNode && q.img.parentNode.querySelector('.placeholder'); if (ph) ph.remove(); if (observer) observer.unobserve(q.img); }
      }).finally(() => { thumbActive--; pumpThumbs(); });
    }
  }
  async function makeThumb(key) {
    if (O.thumbs.has(key)) return O.thumbs.get(key);
    const f = O.byKey.get(key); const file = O.fileOf.get(key); if (!f || !file) return null;
    const scanId = O.scan; let blob = null;
    if (f.kind === 'video') blob = await X.posterBlob(file, 240).catch(() => null);
    else {
      let bmp = null;
      try { bmp = await createImageBitmap(file, { resizeWidth: 240, resizeQuality: 'medium' }); } catch (e) { try { bmp = await createImageBitmap(file); } catch (e2) { bmp = null; } }
      if (bmp) {
        const w = 240, h = Math.max(1, Math.round((bmp.height * w) / bmp.width));
        const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close();
        blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
      }
    }
    if (!blob || scanId !== O.scan) return null; // not for this folder any more (never shown for another one)
    const url = URL.createObjectURL(blob); O.thumbs.set(key, url);
    if (O.thumbs.size > THUMB_KEEP) { const [k0, u0] = O.thumbs.entries().next().value; URL.revokeObjectURL(u0); O.thumbs.delete(k0); }
    return url;
  }
  function releaseThumbs() { for (const u of O.thumbs.values()) URL.revokeObjectURL(u); O.thumbs = new Map(); thumbQ.length = 0; if (observer) observer.disconnect(); }

  // ------------------------------------------------------------------ one photo, larger
  function viewer(key, keys) {
    let i = keys.indexOf(key); let url = null;
    const d = el('dialog', { class: 'dlg viewer', 'aria-label': 'Photo' });
    const body = el('div', { class: 'viewer-body' }); const info = el('div', { class: 'viewer-info small' }); const acts = el('div', { class: 'actions' });
    const paint = () => {
      if (url) URL.revokeObjectURL(url);
      const f = O.byKey.get(keys[i]); const file = O.fileOf.get(f.key); url = URL.createObjectURL(file);
      const media = f.kind === 'video' ? el('video', { src: url, controls: true, playsinline: true }) : el('img', { src: url, alt: C.baseName(f.relativePath) });
      if (f.kind === 'photo') media.addEventListener('error', () => media.replaceWith(el('p', { class: 'muted', text: 'This browser can\'t show this photo (HEIC photos show in Safari). It can still be imported.' })));
      body.replaceChildren(media);
      const s = f.hash && O.server && O.server.byHash.get(f.hash); const dt = C.sortDate(f, O.corrections);
      info.replaceChildren(el('strong', { text: C.baseName(f.relativePath) }), el('div', { class: 'muted', text: f.folderPath }),
        el('div', { text: `${dt ? (dt.source === 'member' ? 'Date (changed by you): ' : 'Taken: ') + (dt.precision === 'day' && f.capture && f.capture.local && dt.source !== 'member' ? new Date(f.capture.local).toLocaleString() : fmtDay(dt)) : 'Date not known'} · ${C.formatBytes(f.size)}` }),
        s && s.used ? el('div', { text: `Already used in: ${s.titles.join(', ') || 'a memory'}` }) : null,
        blocked(f) ? el('div', { class: 'err', text: blocked(f) }) : null);
      const on = O.selected.has(f.key);
      acts.replaceChildren(el('button', { class: 'small secondary', disabled: i <= 0 || null, onclick: () => { i--; paint(); }, text: '‹ Previous' }),
        el('button', { class: 'small secondary', disabled: i >= keys.length - 1 || null, onclick: () => { i++; paint(); }, text: 'Next ›' }),
        el('button', { class: 'small', disabled: blocked(f) ? true : null, onclick: () => { if (on) O.selected.delete(f.key); else O.selected.add(f.key); persist(); paint(); }, text: on ? 'Selected ✓' : 'Select' }),
        el('button', { class: 'small secondary', onclick: () => { d.close(); dateDialog([f.key]); }, text: 'Change date' }),
        el('button', { class: 'link', onclick: () => d.close(), text: 'Close' }));
    };
    d.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' && i > 0) { i--; paint(); } if (e.key === 'ArrowRight' && i < keys.length - 1) { i++; paint(); } });
    d.addEventListener('close', () => { if (url) URL.revokeObjectURL(url); d.remove(); if (O.view.kind !== 'dash') viewGallery(false); });
    d.append(body, info, acts); document.body.append(d); paint(); d.showModal();
  }

  // ------------------------------------------------------------------ date changes (this computer; the original file is never changed)
  function dateEditor(init) {
    const prec = el('select', { 'aria-label': 'How precise is the date' }, [['day', 'Exact date'], ['month', 'Month & year'], ['year', 'Year only'], ['unknown', 'Date unknown']]
      .map(([v, t]) => el('option', { value: v, text: t, selected: (init.precision === v || (v === 'year' && init.precision === 'approximate')) || null })));
    const [y, m, dd] = (init.date || '').split('-');
    const year = el('input', { class: 'year', type: 'number', min: '1826', max: '2100', value: init.date ? y : '', 'aria-label': 'Year', placeholder: 'Year' });
    const month = el('select', { 'aria-label': 'Month' }, el('option', { value: '', text: 'Month' }), MONTHS.map((n, i) => el('option', { value: String(i + 1).padStart(2, '0'), text: n, selected: (init.date && ['day', 'month'].includes(init.precision) && +m === i + 1) || null })));
    const day = el('input', { type: 'number', min: '1', max: '31', value: init.date && init.precision === 'day' ? +dd : '', 'aria-label': 'Day', placeholder: 'Day' });
    const box = el('div', { class: 'dates' }, prec, year, month, day);
    const sync = () => { const p = prec.value; year.hidden = p === 'unknown'; month.hidden = !['day', 'month'].includes(p); day.hidden = p !== 'day'; };
    prec.addEventListener('change', sync); sync();
    /** { date, precision } when complete, else { error } */
    const value = () => {
      const p = prec.value; if (p === 'unknown') return { date: null, precision: 'unknown' };
      const yv = String(year.value).trim(); if (!/^\d{4}$/.test(yv) || +yv < 1826 || +yv > 2100) return { error: 'Enter the year (four digits).' };
      if (p === 'year') return { date: `${yv}-01-01`, precision: 'year' };
      if (!month.value) return { error: 'Choose the month.' };
      if (p === 'month') return { date: `${yv}-${month.value}-01`, precision: 'month' };
      const dv = +day.value; const n = C.normalizeDate(`${yv}-${month.value}-${String(dv).padStart(2, '0')}`, 'day');
      if (!dv || n.precision !== 'day') return { error: 'Enter a day that exists in that month.' };
      return { date: n.date, precision: 'day' };
    };
    return { box, value };
  }

  function dateDialog(keys) {
    const files = keys.map((k) => O.byKey.get(k)).filter(Boolean); if (!files.length) return;
    const first = C.sortDate(files[0], O.corrections);
    const ed = dateEditor(first ? { date: first.date, precision: first.precision } : { date: null, precision: 'day' });
    const msg = el('p', { class: 'err small', role: 'alert' });
    const d = el('dialog', { class: 'dlg', 'aria-labelledby': 'org-date-title' });
    const save = el('button', { id: 'org-date-save', onclick: () => {
      const v = ed.value(); if (v.error) { msg.textContent = v.error; return; }
      const before = new Map(files.map((f) => [f.key, placeOf(f)]));
      for (const f of files) O.corrections[f.qid] = v;
      regroup(); persist(); d.close();
      const moved = files.filter((f) => placeOf(f) !== before.get(f.key));
      const where = v.precision === 'unknown' ? 'Dates Unknown' : v.precision === 'year' ? v.date.slice(0, 4) : `${monthName(+v.date.slice(5, 7))} ${v.date.slice(0, 4)}`;
      toast(moved.length ? `${plural(moved.length, 'photo')} moved to ${where}. The original files are not changed.` : 'Date saved. The original files are not changed.');
      if (O.view.kind === 'dash') viewDash(false); else viewGallery(false);
    }, text: 'Save date' });
    d.append(el('h2', { id: 'org-date-title', text: files.length === 1 ? 'Change the date' : `Change the date of ${plural(files.length, 'photo')}` }),
      el('p', { class: 'small muted', text: 'This changes where the photos are sorted and the date DayCasion suggests for their memory. Your original files and their metadata are not changed. Saved in this browser until the photos are in a memory.' }),
      ed.box, msg, el('div', { class: 'actions' }, save, el('button', { class: 'link', onclick: () => d.close(), text: 'Go back' })));
    d.addEventListener('close', () => d.remove());
    document.body.append(d); d.showModal(); save.focus();
  }
  const placeOf = (f) => { const d = C.sortDate(f, O.corrections); return d ? `${d.date.slice(0, 7)}:${d.precision}` : 'unknown'; };

  // ------------------------------------------------------------------ 5. create a memory from the selected photos
  function createDialog() {
    if (O.busy) return;
    const files = [...O.selected].map((k) => O.byKey.get(k)).filter((f) => f && !blocked(f));
    if (!files.length) return;
    const reuse = files.filter((f) => statusOf(f) === 'used');
    const bytes = files.reduce((n, f) => n + f.size, 0);
    const sug = C.suggestMemoryDate(files, O.corrections);
    const title = el('input', { class: 'title full', id: 'org-title', maxlength: '200', 'aria-label': 'Memory title', placeholder: 'Title, for example Christmas 2010' });
    const ed = dateEditor(sug);
    const desc = el('textarea', { class: 'description', id: 'org-desc', rows: '3', maxlength: String(C.MAX_DESCRIPTION), 'aria-label': 'Memory description', placeholder: 'Description (optional): what happened, who was there, what you want to remember' });
    const msg = el('p', { class: 'err small', role: 'alert', id: 'org-create-msg' });
    const line = el('p', { class: 'progress-line', hidden: true }); const bar = el('div', {}); const prog = el('div', { class: 'progress', hidden: true }, bar);
    const left = storageLeft(); const over = access().enforced && left != null && bytes > left;
    const strip = el('div', { class: 'strip' }, files.slice(0, 14).map((f) => { const u = O.thumbs.get(f.key); return u ? el('img', { src: u, alt: '' }) : el('span', { class: 'ph', text: f.kind === 'video' ? '▶' : '' }); }),
      files.length > 14 ? el('span', { class: 'more', text: `+${(files.length - 14).toLocaleString()}` }) : null);
    const go = el('button', { id: 'org-create-go', disabled: over || null, text: 'Create Memory' });
    const back = el('button', { class: 'link', id: 'org-create-back', onclick: () => d.close(), text: 'Go back' });
    const d = el('dialog', { class: 'dlg create', 'aria-labelledby': 'org-create-title' });
    d.append(el('h2', { id: 'org-create-title', text: `New memory with ${plural(files.length, 'photo')}` }),
      el('p', { class: 'small muted' }, 'For ', el('strong', { text: X.profile.name }), ` · ${X.counts(files.filter((f) => f.kind === 'photo').length, files.filter((f) => f.kind === 'video').length)} · ${C.formatBytes(bytes)}`),
      strip,
      el('label', { for: 'org-title', text: 'Title' }), title,
      el('label', { text: 'Date' }), ed.box,
      el('p', { class: 'small muted', text: sug.precision === 'unknown' ? 'The photos don\'t share one date: choose the date of this memory, or leave it unknown.' : `Suggested from the photos: ${C.dateLabel(sug.date, sug.precision)}. Change it if you like.` }),
      el('label', { for: 'org-desc', text: 'Description' }), desc,
      reuse.length ? el('div', { class: 'note small', id: 'org-reuse-note' }, el('strong', { text: `${plural(reuse.length, 'photo')} ${reuse.length === 1 ? 'is' : 'are'} already in a memory. ` }),
        `${reuse.length === 1 ? 'It' : 'They'} will be stored again as a separate copy for this memory, which uses ${C.formatBytes(reuse.reduce((n, f) => n + f.size, 0))} more of your storage. Nothing is uploaded again from this computer.`) : null,
      over ? el('p', { class: 'err small', text: `These photos need ${C.formatBytes(bytes)}, more than your remaining storage (${C.formatBytes(Math.max(0, left))}). Select fewer photos, or add storage in the app.` }) : null,
      line, prog, msg, el('div', { class: 'actions' }, go, back));
    go.addEventListener('click', async () => {
      if (O.busy) return;
      const t = title.value.trim(); if (!t) { msg.textContent = 'Enter a title for this memory.'; title.focus(); return; }
      const v = ed.value(); if (v.error) { msg.textContent = v.error; return; }
      msg.textContent = ''; O.busy = true; go.disabled = true; back.disabled = true; line.hidden = false; prog.hidden = false;
      for (const x of [title, desc, ...ed.box.querySelectorAll('input,select')]) x.disabled = true;
      const res = await runMemory(files, t, v, desc.value.trim(), (text, pct) => { line.textContent = text; if (pct != null) bar.style.width = `${pct}%`; });
      O.busy = false; back.disabled = false;
      if (res.ok) {
        d.close();
        toast(`“${t}” created with ${plural(res.saved, 'photo')}.${res.skipped ? ` ${plural(res.skipped, 'file')} couldn't be added (see below).` : ''}`);
        viewGallery(false);
        return;
      }
      go.disabled = false; go.textContent = 'Try again';
      msg.replaceChildren(el('span', { text: res.error + ' ' }), res.batch ? el('button', { class: 'link', id: 'org-create-cancel', onclick: async () => {
        await X.cancelBatch(res.batch); X.forgetRun(res.batch); O.pending = null; for (const f of files) if (f.state) f.state = null; d.close(); viewGallery(false);
      }, text: 'Cancel this memory' }) : null);
    });
    d.addEventListener('cancel', (e) => { if (O.busy) e.preventDefault(); });
    d.addEventListener('close', () => { d.remove(); if (!O.busy) viewGallery(false); });
    document.body.append(d); d.showModal(); title.focus();
  }

  /** The existing import steps for one memory. A retry (Try again) continues the same import: files already stored are
   *  not stored again, and the memory is created exactly once. */
  async function runMemory(files, title, date, body, say) {
    const same = O.pending && O.pending.keys.join() === files.map((f) => f.key).join();
    if (!same && O.pending && O.pending.batch) { const old = O.pending.batch; O.pending = null; await X.cancelBatch(old); X.forgetRun(old); } // a different selection: the unfinished attempt is withdrawn
    const P = same ? O.pending : (O.pending = { keys: files.map((f) => f.key), batch: null, group: 'm1' });
    try {
      say('Preparing the photos…', 2);
      let n = 0;
      await pool(files, HASHES_AT_ONCE, async (f) => {
        const file = O.fileOf.get(f.key);
        await fullHash(f);
        if (f.kind === 'photo' && f.canDisplay == null) { const dim = await X.probeImage(file); f.width = f.width || (dim && dim.width); f.height = f.height || (dim && dim.height); f.canDisplay = !!(dim && dim.width > C.DISPLAY_WIDTH); }
        if (f.kind === 'video' && (!f.durationSeconds || f.canPoster == null)) { const p = await X.probeVideo(file); if (!f.durationSeconds && p.duration) f.durationSeconds = p.duration; f.canPoster = !!p.decodable; }
        say(`Preparing the photos: ${(++n).toLocaleString()} of ${files.length.toLocaleString()}`, Math.round(10 * n / files.length));
      });
      for (const f of files) f.reuse = statusOf(f) === 'used';
      if (!P.batch) {
        const started = await X.rpc('dc_import_start', { p_profile_id: X.profile.id, p_source_name: O.folder.slice(0, 255), p_purpose: 'organize' });
        if (!started.ok) return { ok: false, error: X.plainErr(started, "We couldn't start the import. Please try again.") };
        P.batch = started.data.batch_id;
        X.rememberRun(P.batch, { mode: 'organize', descriptions: body ? { [P.group]: body } : {} });
      }
      const payload = C.memoryPayload(P.group, title, date.date, date.precision, files.map((f) => ({ ...f, canPoster: f.kind === 'video' && f.canPoster })), O.corrections);
      const r = await X.rpc('dc_import_add_items', { p_batch_id: P.batch, p_groups: payload });
      if (!r.ok) return { ok: false, batch: P.batch, error: X.plainErr(r, "We couldn't prepare the upload. Please try again.") };
      const byKey = new Map(files.map((f) => [f.key, f]));
      const skipped = []; const tasks = [];
      for (const x of r.data) {
        const f = byKey.get(x.key);
        if (x.result === 'new' || (x.result === 'existing' && x.status === 'pending')) tasks.push({ f, res: { item_id: x.item_id, storage_path: x.storage_path, display_path: x.display_path, poster_path: x.poster_path, copy_from: x.copy_from, copy_display_from: x.copy_display_from } });
        else if (x.result === 'rejected' || x.result === 'duplicate') skipped.push({ relativePath: f.relativePath, reason: x.reason, kind: f.kind, message: C.REASONS[x.reason] || x.reason });
      }
      // Upload (or copy) and confirm each file.
      let sent = 0; const failed = [];
      for (const t of tasks) t.f.state = 'uploading';
      await pool(tasks, 3, async (t) => {
        for (let attempt = 1; ; attempt++) {
          try { await X.stageFile(O.fileOf.get(t.f.key), t.f.mime, t.res, null); t.f.state = null; break; }
          catch (e) {
            if (e && e.message === 'rejected') { t.f.state = null; skipped.push({ relativePath: t.f.relativePath, reason: e.reason, kind: t.f.kind, message: e.userMessage }); break; }
            if (attempt < 3 && !(e && e.permanent)) { await new Promise((ok) => setTimeout(ok, 1000 * attempt)); continue; }
            t.f.state = 'failed'; failed.push(e && e.userMessage); break;
          }
        }
        say(`Uploading ${(++sent).toLocaleString()} of ${plural(tasks.length, 'file')}`, 10 + Math.round(70 * sent / Math.max(1, tasks.length)));
      });
      if (failed.length) return { ok: false, batch: P.batch, error: `${plural(failed.length, 'photo')} didn't upload${failed[0] ? ` (${failed[0]})` : ''}. Your photos are safe; try again to finish.` };
      // Save the memory once, then move each file into it and attach it.
      say('Saving the memory…', 85);
      const g = await X.authed(`/rest/v1/import_groups?select=id,memory_id&batch_id=eq.${P.batch}&client_key=eq.${P.group}`);
      const grp = g.ok && g.data && g.data[0];
      if (!grp) return { ok: false, batch: P.batch, error: skipped.length ? `None of these photos could be added: ${skipped[0].message}.` : "We couldn't find this memory's photos. Please try again." };
      const items = await X.authed(`/rest/v1/import_items?select=id,status,storage_path,display_path,mime_type,kind,content_hash&group_id=eq.${grp.id}&order=sort_order,id`);
      if (!items.ok) return { ok: false, batch: P.batch, error: 'The connection was interrupted. Please try again.' };
      const ready = items.data.filter((i) => i.status === 'ready'); const kept = items.data.filter((i) => i.status === 'ready' || i.status === 'organized');
      if (!kept.length) { await X.rpc('dc_import_finish', { p_batch_id: P.batch }); X.forgetRun(P.batch); O.pending = null; return { ok: false, error: `None of these photos could be added: ${skipped.length ? skipped[0].message : 'please try again'}.` }; }
      let memoryId = grp.memory_id;
      if (!memoryId) {
        const b = await X.rpc('dc_import_begin_save', { p_group_id: grp.id, p_title: title, p_body: body || '', p_occurred_on: date.precision === 'unknown' ? null : date.date,
          p_date_precision: date.precision, p_item_ids: kept.map((i) => i.id) });
        if (!b.ok) return { ok: false, batch: P.batch, error: X.plainErr(b, "We couldn't create this memory. Please try again.") };
        memoryId = b.data.memory_id;
      }
      const me = X.session().user.id; let problem = null; let k = 0;
      for (const it of ready) {
        const sort = items.data.indexOf(it);
        for (let attempt = 1; ; attempt++) {
          await X.authed('/storage/v1/object/move', { method: 'POST', body: { bucketId: 'memory-media', sourceKey: it.storage_path, destinationKey: `${me}/${memoryId}/${it.id}.${EXT[it.mime_type]}` } });
          if (it.display_path) await X.authed('/storage/v1/object/move', { method: 'POST', body: { bucketId: 'memory-media', sourceKey: it.display_path, destinationKey: `${me}/${memoryId}/${it.id}_display.jpg` } });
          const a = await X.rpc('dc_import_attach_item', { p_item_id: it.id, p_sort_order: sort });
          if (a.ok) break;
          if ((a.offline || a.status >= 500) && attempt < 3) { await new Promise((ok) => setTimeout(ok, 1000 * attempt)); continue; }
          problem = problem || X.plainErr(a, 'A photo couldn\'t be added. Check your connection.'); break;
        }
        say(`Saving the memory: ${(++k).toLocaleString()} of ${ready.length.toLocaleString()}`, 85 + Math.round(14 * k / Math.max(1, ready.length)));
      }
      const fin = await X.rpc('dc_import_finish_group', { p_group_id: grp.id });
      if (problem || !fin.ok) return { ok: false, batch: P.batch, error: problem || 'Not finished. Please try again.' };
      await X.rpc('dc_import_finish', { p_batch_id: P.batch });
      X.forgetRun(P.batch);
      // This memory's photos are now used (and no longer selected); everything else stays as it was.
      const savedHashes = new Set(kept.map((i) => i.content_hash));
      for (const f of files) {
        if (!savedHashes.has(f.hash)) continue;
        const e = O.server.byHash.get(f.hash) || { used: false, waiting: false, titles: [], memberDate: null };
        e.used = true; if (!e.titles.includes(title)) e.titles.push(title); O.server.byHash.set(f.hash, e); O.server.sizes.add(f.size);
        O.selected.delete(f.key);
      }
      O.pending = null; persist();
      await X.refreshStorage();
      for (const s of skipped) O.skipped.push(s);
      return { ok: true, saved: kept.length, skipped: skipped.length };
    } catch (e) {
      if (e && e.message === 'signed-out') return { ok: false, error: 'Please sign in again.' };
      return { ok: false, batch: P.batch, error: 'The connection was interrupted. Your photos are safe; try again to finish.' };
    } finally { for (const f of files) if (f.state === 'uploading') f.state = null; }
  }

  window.DcOrganize = { open, hasLocal, forget, _state: () => O };
})();
