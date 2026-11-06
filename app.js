/* DayCasion Desktop Import (import.daycasion.com). Sign in -> choose a memory profile -> drop or choose folders ->
 * review the suggested memories -> upload into that profile's Add Past Memories. Memories are created only in the app.
 * Plain DOM, no dependencies; all member text goes through textContent. */
(function () {
  'use strict';
  if (window.top !== window.self) return; // stay hidden inside frames
  document.documentElement.classList.remove('dc-guard');

  const CFG = window.DC_IMPORT_CONFIG;
  const C = window.DcImport;
  const URL_ = CFG.supabaseUrl;
  const KEY = CFG.publishableKey;
  const SESSION_KEY = 'dc-import-session'; // sessionStorage: cleared when the tab is closed
  const UPLOADS_AT_ONCE = 3;
  const SCANS_AT_ONCE = 3;
  const $app = document.getElementById('app');

  // ------------------------------------------------------------------ DOM helpers
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'text') e.textContent = v;
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return e;
  }
  const show = (...nodes) => { $app.replaceChildren(...nodes); window.scrollTo(0, 0); };
  const card = (...kids) => el('div', { class: 'card' }, ...kids);
  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : (many || one + 's')}`;
  const counts = (photos, videos) => [photos ? plural(photos, 'photo') : null, videos ? plural(videos, 'video') : null].filter(Boolean).join(' · ') || 'Nothing';

  // ------------------------------------------------------------------ session + API (as export.daycasion.com)
  let session = null;
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function saveSession(s) { try { if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); else sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* private mode */ } }
  function storeSession(d) {
    session = { access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: d.user || (session && session.user) };
    saveSession(session);
  }
  async function api(path, opts = {}) {
    const headers = { apikey: KEY, ...(opts.headers || {}) };
    if (opts.body !== undefined && !(opts.body instanceof Blob)) headers['Content-Type'] = 'application/json';
    if (opts.auth && session) headers.Authorization = 'Bearer ' + session.access_token;
    let res;
    try {
      res = await fetch(URL_ + path, { method: opts.method || 'GET', headers, cache: 'no-store',
        body: opts.body === undefined ? undefined : (opts.body instanceof Blob ? opts.body : JSON.stringify(opts.body)) });
    } catch (e) { return { ok: false, status: 0, data: null, offline: true }; }
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    return { ok: res.ok, status: res.status, data, headers: res.headers };
  }
  let refreshing = null;
  async function refresh() {
    if (!session || !session.refresh_token) return false;
    if (!refreshing) {
      refreshing = api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } })
        .then((r) => { refreshing = null; if (r.ok && r.data && r.data.access_token) { storeSession(r.data); return true; } return false; });
    }
    return refreshing;
  }
  async function authed(path, opts = {}) {
    if (session && session.expires_at - Date.now() / 1000 < 90) await refresh();
    let r = await api(path, { ...opts, auth: true });
    if (r.status === 401 && await refresh()) r = await api(path, { ...opts, auth: true });
    if (r.status === 401) { signOut(); throw new Error('signed-out'); }
    return r;
  }
  const rpc = (fn, args) => authed(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args || {} });
  const errText = (r, fallback) => (r && r.data && (r.data.message || r.data.msg || r.data.error_description)) || fallback;
  function signOut() { if (session) api('/auth/v1/logout', { method: 'POST', auth: true }); session = null; saveSession(null); viewSignIn(); }

  // ------------------------------------------------------------------ state
  const S = {
    profiles: [], profile: null, plan: null, storage: null,
    files: [], skipped: [], state: null, selected: new Set(), batch: null, resume: null,
    thumbs: new Map(), queue: null, active: new Set(), // uploads in flight (aborted on cancel)
  };
  const fileByKey = new Map(); // key -> File

  // ------------------------------------------------------------------ 1. sign in
  function viewSignIn(message) {
    const email = el('input', { class: 'full', type: 'email', autocomplete: 'username', id: 'email', required: true });
    const pw = el('input', { class: 'full', type: 'password', autocomplete: 'current-password', id: 'password', required: true });
    const msg = el('p', { class: 'err small', role: 'alert', text: message || '' });
    const btn = el('button', { type: 'submit', text: 'Sign in' });
    const form = el('form', { onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = ''; btn.disabled = true;
      const r = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email.value.trim(), password: pw.value } });
      btn.disabled = false;
      if (r.ok && r.data && r.data.access_token) { pw.value = ''; storeSession(r.data); return viewProfiles(); }
      msg.textContent = r.offline ? "Can't reach DayCasion. Check your connection and try again." : 'That email and password didn\'t match. Use the same sign-in as the DayCasion app.';
    } }, el('label', { for: 'email', text: 'Email' }), email, el('label', { for: 'password', text: 'Password' }), pw, msg,
    el('div', { class: 'actions' }, btn));
    show(el('div', { class: 'card narrow' }, el('h2', { text: 'Sign in to DayCasion' }),
      el('p', { class: 'muted small', text: 'Use the account you use in the DayCasion app. Forgot your password? Reset it in the app.' }), form));
    email.focus();
  }

  // ------------------------------------------------------------------ 2. choose a memory profile
  async function viewProfiles() {
    show(card(el('p', { class: 'muted', text: 'Loading your memory profiles…' })));
    let profiles, storage, batches;
    try {
      [profiles, storage, batches] = await Promise.all([
        authed('/rest/v1/memory_profiles?select=id,name,type&order=created_at'),
        rpc('dc_account_storage'),
        authed('/rest/v1/import_batches?select=id,memory_profile_id,source_name,status,created_at&status=eq.uploading&order=created_at.desc'),
      ]);
    } catch (e) { return; }
    if (!profiles.ok) return show(card(el('p', { class: 'err', text: "We couldn't load your memory profiles. Please reload the page." })));
    if (!batches.ok) return show(card(el('h2', { text: 'Desktop Import is not available yet' }), el('p', { class: 'muted', text: 'Please try again later.' })));
    S.profiles = profiles.data || [];
    // The video size limit, from DayCasion's settings (photos: 50 MB).
    const limit = await authed('/rest/v1/app_config?select=value&key=eq.max_video_bytes').catch(() => null);
    if (limit && limit.ok && limit.data && limit.data[0]) C.setLimits({ videoBytes: Number(limit.data[0].value) });
    S.storage = storage.ok ? storage.data : null;
    const access = new Map(((S.storage && S.storage.profiles) || []).map((p) => [p.profile_id, p.access]));
    if (!S.profiles.length) return show(card(el('h2', { text: 'Add a memory profile first' }), el('p', { text: 'Create a memory profile in the DayCasion app, then come back here.' })));
    const unfinished = batches.data || [];
    const pending = await Promise.all(unfinished.map((b) => authed(`/rest/v1/import_items?select=id&batch_id=eq.${b.id}&status=eq.pending`, { headers: { Prefer: 'count=exact', Range: '0-0' } })
      .then((r) => +(String(r.headers.get('content-range') || '').split('/')[1] || 0))));
    const list = el('div', { class: 'profiles', role: 'list' });
    for (const p of S.profiles) {
      const a = access.get(p.id);
      const enforced = S.storage && S.storage.enforced;
      const blocked = enforced && a && !a.has_access;
      list.append(el('button', { class: 'profile', role: 'listitem', 'data-profile': p.id, disabled: blocked || null, onclick: () => startProfile(p) },
        p.name || 'Unnamed', el('span', { text: blocked ? 'Needs a DayCasion plan' : (p.type || '') + (a && a.has_access && !a.video && enforced ? ' · photos only' : '') })));
    }
    const resumeCards = unfinished.map((b, i) => {
      const p = S.profiles.find((x) => x.id === b.memory_profile_id);
      return el('div', { class: 'note' },
        el('strong', { text: `Unfinished import for ${p ? p.name : 'a memory profile'}` }),
        el('p', { class: 'small', text: `${b.source_name || 'Your folders'} · started ${new Date(b.created_at).toLocaleString()} · ${plural(pending[i], 'file')} not uploaded yet.` }),
        el('div', { class: 'actions' },
          el('button', { class: 'small', onclick: () => startResume(b, p), text: 'Continue it' }),
          el('button', { class: 'small secondary', onclick: () => cancelBatch(b.id, viewProfiles), text: 'Cancel it' })));
    });
    show(card(el('div', { class: 'row' }, el('h2', { text: 'Whose photos are these?' }), el('button', { class: 'link', onclick: signOut, text: 'Sign out' })),
      el('p', { class: 'muted small', text: 'Choose the memory profile to import into. The photos wait in its Add Past Memories until you save them as memories in the app.' }),
      list, storageLine()), ...resumeCards);
  }
  function storageLine() {
    const st = S.storage; if (!st || !st.allowance_bytes) return null;
    const left = Math.max(0, st.allowance_bytes - st.used_bytes);
    return el('p', { class: 'small muted', text: `${C.formatBytes(left)} of storage left on your plan.` });
  }

  function startProfile(p) { S.profile = p; S.resume = null; viewChoose(); }

  // ------------------------------------------------------------------ 3. choose folders or files
  function viewChoose() {
    const folderInput = el('input', { type: 'file', class: 'visually-hidden', id: 'pick-folder', webkitdirectory: true, multiple: true });
    const fileInput = el('input', { type: 'file', class: 'visually-hidden', id: 'pick-files', multiple: true, accept: 'image/*,video/*,.heic,.heif,.mov' });
    const onPick = (input) => () => {
      const list = [...input.files].map((f) => ({ file: f, relativePath: f.webkitRelativePath || f.name }));
      input.value = '';
      if (list.length) scan(list);
    };
    folderInput.addEventListener('change', onPick(folderInput));
    fileInput.addEventListener('change', onPick(fileInput));
    const drop = el('div', { class: 'drop', id: 'drop' },
      el('p', { text: S.resume ? 'Drop the same folder here again to continue' : 'Drop folders, a whole drive folder, or individual photos and videos here' }),
      el('p', { class: 'muted small', text: `Folders such as 2026 › November › Birthday Party become suggested memories. Photos (JPEG, HEIC, PNG, WebP, up to 50 MB) and videos (MP4, MOV, up to 30 seconds and ${Math.round(C.LIMITS.videoBytes / 1048576)} MB).` }),
      el('div', { class: 'actions' },
        el('label', { for: 'pick-folder', class: 'btn', role: 'button', tabindex: '0', text: 'Choose a folder' }),
        el('label', { for: 'pick-files', class: 'btn secondary', role: 'button', tabindex: '0', text: 'Choose photos and videos' })),
      folderInput, fileInput);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (e) => {
      e.preventDefault(); drop.classList.remove('over');
      const list = await filesFromDrop(e.dataTransfer);
      if (list.length) scan(list);
    });
    show(card(el('div', { class: 'row' }, el('h2', { text: `Import for ${S.profile.name}` }), el('button', { class: 'link', onclick: viewProfiles, text: 'Change' })),
      S.resume ? el('p', { class: 'note small', text: `Choose the same folder you used before (${S.resume.batch.source_name || 'your folders'}). Files already uploaded are skipped.` }) : null,
      drop));
  }

  /** Folders dropped from Finder or Explorer, walked recursively (nested folders keep their full relative paths). */
  async function filesFromDrop(dt) {
    const entries = [...dt.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    const out = [];
    const readAll = (reader) => new Promise((resolve) => { const all = []; const next = () => reader.readEntries((batch) => { if (!batch.length) return resolve(all); all.push(...batch); next(); }, () => resolve(all)); next(); });
    async function walk(entry, prefix) {
      if (entry.isFile) {
        const file = await new Promise((res) => entry.file(res, () => res(null)));
        if (file) out.push({ file, relativePath: prefix + entry.name });
      } else if (entry.isDirectory) {
        for (const child of await readAll(entry.createReader())) await walk(child, prefix + entry.name + '/');
      }
    }
    if (entries.length) { for (const e of entries) await walk(e, ''); }
    else for (const f of dt.files) out.push({ file: f, relativePath: f.name });
    return out;
  }

  // ------------------------------------------------------------------ 4. read the files (type, size, dates, duplicates)
  async function scan(list) {
    const status = el('p', { class: 'muted', text: 'Looking through your folders…' });
    const bar = el('div', {});
    show(card(el('h2', { text: 'Reading your photos and videos' }), status, el('div', { class: 'progress' }, bar),
      el('p', { class: 'small muted', text: 'This happens on your computer. Nothing is uploaded yet.' })));
    const valid = []; const skipped = []; let done = 0; let keyN = 0;
    const work = list.filter((x) => { const c = C.classify(x.relativePath, x.file.size); if (c.ignore) return false;
      if (c.skip) { skipped.push({ relativePath: x.relativePath, reason: c.reason, message: c.message }); return false; } x.cls = c; return true; });
    if (work.length > C.MAX_FILES) {
      for (const x of work.splice(C.MAX_FILES)) skipped.push({ relativePath: x.relativePath, reason: 'limit', message: 'One import can hold up to 10,000 files. Import the rest separately.' });
    }
    const one = async (x) => {
      try {
        const buf = await x.file.arrayBuffer();
        const meta = C.readMetadata(x.cls.kind, x.cls.mime, buf);
        const hash = await C.sha256Hex(buf);
        const f = { key: `f${++keyN}`, relativePath: x.relativePath, folderPath: C.dirName(x.relativePath), kind: x.cls.kind, mime: x.cls.mime,
          size: x.file.size, hash, capture: meta.capture, width: meta.width, height: meta.height, durationSeconds: meta.durationSeconds,
          extra: meta.extra, lastModified: x.file.lastModified };
        if (f.kind === 'video') {
          const probe = await probeVideo(x.file);
          if (!f.durationSeconds && probe.duration) f.durationSeconds = probe.duration;
          f.canPoster = probe.decodable;
          if (!f.width && probe.width) { f.width = probe.width; f.height = probe.height; }
          const bad = C.checkVideoLength(f.durationSeconds);
          if (bad) { skipped.push({ relativePath: f.relativePath, reason: bad.reason, message: bad.message }); return; }
        } else {
          const dim = await probeImage(x.file);
          if (dim) { f.width = f.width || dim.width; f.height = f.height || dim.height; f.canDisplay = dim.width > C.DISPLAY_WIDTH; f.canThumb = true; }
        }
        fileByKey.set(f.key, x.file);
        valid.push(f);
      } catch (e) {
        skipped.push({ relativePath: x.relativePath, reason: 'unreadable', message: "This file couldn't be read." });
      } finally {
        done++;
        if (done % 5 === 0 || done === work.length) {
          status.textContent = `Checked ${done.toLocaleString()} of ${work.length.toLocaleString()} files`;
          bar.style.width = `${Math.round((100 * done) / Math.max(1, work.length))}%`;
        }
      }
    };
    let next = 0;
    await Promise.all(Array.from({ length: SCANS_AT_ONCE }, async () => { while (next < work.length) await one(work[next++]); }));
    const { kept, duplicates } = C.markDuplicates(valid);
    for (const d of duplicates) skipped.push({ relativePath: d.relativePath, reason: 'duplicate_in_selection', message: `Same file as ${d.duplicateOf}` });
    S.files = kept; S.skipped = skipped; S.selected = new Set();
    if (S.resume) return resumeUpload(kept, skipped);
    S.state = C.makeState(kept);
    if (!kept.length) {
      return show(card(el('h2', { text: 'No photos or videos to import' }), skippedList(skipped, true),
        el('div', { class: 'actions' }, el('button', { onclick: viewChoose, text: 'Choose other folders' }))));
    }
    viewPreview();
  }

  function probeImage(file) {
    if (!window.createImageBitmap) return Promise.resolve(null);
    return createImageBitmap(file).then((b) => { const d = { width: b.width, height: b.height }; b.close(); return d; }).catch(() => null);
  }
  function probeVideo(file) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      let settled = false;
      const done = (r) => { if (settled) return; settled = true; URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); resolve(r); };
      v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = () => done({ duration: isFinite(v.duration) ? v.duration : null, decodable: v.videoWidth > 0, width: v.videoWidth || null, height: v.videoHeight || null });
      v.onerror = () => done({ duration: null, decodable: false });
      setTimeout(() => done({ duration: null, decodable: false }), 8000);
      v.src = url;
    });
  }

  // ------------------------------------------------------------------ 5. review and edit the suggested memories
  function viewPreview() {
    const st = S.state;
    const sum = C.summary(st);
    const left = S.storage && S.storage.allowance_bytes ? S.storage.allowance_bytes - S.storage.used_bytes : null;
    const over = left != null && S.storage.enforced && sum.bytes > left;
    const top = card(
      el('div', { class: 'row' }, el('h2', { text: `${plural(sum.groups, 'suggested memory', 'suggested memories')} for ${S.profile.name}` }),
        el('button', { class: 'link', onclick: () => { if (confirm('Start over? Your changes on this page will be lost.')) viewChoose(); }, text: 'Start over' })),
      el('p', { text: `${counts(sum.photos, sum.videos)} · ${C.formatBytes(sum.bytes)}` }),
      el('p', { class: 'muted small', text: 'Each folder became a suggested memory, dated from your folder names (and photo dates when they agree). Rename them, fix dates, move photos between them, combine, split or leave things out. Nothing becomes a memory until you save it in the DayCasion app.' }),
      el('p', { class: 'muted small', text: 'Want to add these to a memory you already have? Import them here, then in the DayCasion app go to Add Past Memories, tap Review & save and choose “Add to an existing memory”.' }),
      over ? el('p', { class: 'err', text: `This is more than your remaining storage (${C.formatBytes(Math.max(0, left))}). Leave some photos out, or add storage in the app.` }) : null,
      S.skipped.length ? skippedList(S.skipped) : null,
      el('div', { class: 'actions' }, el('button', { id: 'upload', disabled: !sum.groups || over || null, onclick: confirmUpload,
        text: `Upload ${plural(sum.photos + sum.videos, 'file')} to Add Past Memories` })));
    const groups = st.groups.map(groupCard);
    show(selectionBar(), top, ...groups);
  }

  function selectionBar() {
    const n = S.selected.size;
    if (!n) return el('div', { class: 'sticky', hidden: true });
    const st = S.state;
    const target = el('select', { 'aria-label': 'Move to memory' }, el('option', { value: '', text: 'Move to…' }),
      st.groups.map((g) => el('option', { value: g.key, text: g.title })));
    target.addEventListener('change', () => { if (target.value) { S.state = C.edits.moveItems(st, [...S.selected], target.value); S.selected.clear(); viewPreview(); } });
    const anyIncluded = [...S.selected].some((k) => !st.excluded.has(k));
    return el('div', { class: 'sticky' }, el('div', { class: 'selbar', role: 'region', 'aria-label': 'Selected files' },
      el('strong', { text: `${n} selected` }), target,
      el('button', { class: 'small', onclick: newFromSelection, text: 'New memory from selected' }),
      el('button', { class: 'small secondary', onclick: () => { S.state = C.edits.exclude(st, [...S.selected], anyIncluded); S.selected.clear(); viewPreview(); },
        text: anyIncluded ? 'Leave out' : 'Include again' }),
      el('button', { class: 'link', onclick: () => { S.selected.clear(); viewPreview(); }, text: 'Clear selection' })));
  }

  function newFromSelection() {
    const st = S.state; const keys = [...S.selected];
    const owner = st.groups.find((g) => g.items.includes(keys[0]));
    let s = C.edits.moveItems(st, keys, owner.key); // gather into the first file's memory
    const g = s.groups.find((x) => x.key === owner.key);
    s = g.items.length > keys.length ? C.edits.split(s, owner.key, keys, 'New memory') : C.edits.rename(s, owner.key, g.title);
    S.state = s; S.selected.clear(); viewPreview();
  }

  function groupCard(g) {
    const st = S.state;
    const included = g.items.filter((k) => !st.excluded.has(k));
    const photos = included.filter((k) => st.items[k].kind === 'photo').length;
    const bytes = included.reduce((n, k) => n + st.items[k].size, 0);
    const title = el('input', { class: 'title', value: g.title, maxlength: '200', 'aria-label': 'Memory title' });
    title.addEventListener('change', () => { S.state = C.edits.rename(S.state, g.key, title.value); });
    // Combines two suggested memories from this import (shown only when there is another one to combine with).
    const others = st.groups.filter((x) => x.key !== g.key);
    const merge = others.length ? el('select', { 'aria-label': 'Combine with another suggested memory from this import' },
      el('option', { value: '', text: 'Combine with…' }), others.map((x) => el('option', { value: x.key, text: x.title }))) : null;
    if (merge) merge.addEventListener('change', () => { if (merge.value) { S.state = C.edits.merge(S.state, [merge.value, g.key]); viewPreview(); } });
    const allOut = included.length === 0;
    const grid = el('div', { class: 'grid' });
    const shown = g.showAll ? g.items : g.items.slice(0, 30);
    for (const k of shown) grid.append(tile(st.items[k]));
    return el('section', { class: `group${allOut ? ' excluded' : ''}`, 'data-group': g.key, 'aria-label': g.title },
      el('div', { class: 'group-head' }, title,
        el('span', { class: 'muted small', text: `${counts(photos, included.length - photos)} · ${C.formatBytes(bytes)}` })),
      dateEditor(g),
      el('div', { class: 'folders' }, g.folders.map((f) => el('div', {}, '📁 ' + (f || '(files you chose)'),
        f ? el('button', { class: 'link', onclick: () => { S.state = C.edits.excludeFolder(S.state, f, !allOut); viewPreview(); }, text: allOut ? 'include folder' : 'leave folder out' }) : null))),
      el('div', { class: 'actions' }, merge,
        el('button', { class: 'small secondary', onclick: () => { for (const k of g.items) S.selected.add(k); viewPreview(); }, text: 'Select all' }),
        el('button', { class: 'small secondary', onclick: () => { S.state = C.edits.excludeGroup(S.state, g.key, !allOut); viewPreview(); }, text: allOut ? 'Include this memory' : 'Leave this memory out' })),
      grid,
      g.items.length > shown.length ? el('button', { class: 'link', onclick: () => { g.showAll = true; viewPreview(); }, text: `Show all ${g.items.length}` }) : null);
  }

  function dateEditor(g) {
    // The fields shown follow what the member picked; the recorded date is only what has been fully entered.
    const want = g.chosenPrecision || g.precision;
    const [y, m, d] = (g.date || '').split('-');
    const hasMonth = ['day', 'month', 'approximate_month', 'approximate_day'].includes(g.precision);
    const hasDay = ['day', 'approximate_day'].includes(g.precision);
    const prec = el('select', { 'aria-label': 'How precise is the date' },
      [['day', 'Exact date'], ['month', 'Month & year'], ['year', 'Year only'], ['approximate', 'Around a year'], ['unknown', 'Date unknown']]
        .map(([v, t]) => el('option', { value: v, text: t, selected: want === v || null })));
    const year = el('input', { class: 'year', type: 'number', min: '1826', max: '2100', value: g.date ? y : '', 'aria-label': 'Year', placeholder: 'Year' });
    const month = el('select', { 'aria-label': 'Month' }, el('option', { value: '', text: 'Month', selected: hasMonth ? null : true }),
      ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
        .map((name, i) => el('option', { value: String(i + 1).padStart(2, '0'), text: name, selected: (hasMonth && +m === i + 1) || null })));
    const day = el('input', { type: 'number', min: '1', max: '31', value: hasDay ? +d : '', 'aria-label': 'Day', placeholder: 'Day' });
    const apply = () => {
      const p = prec.value, yv = String(year.value).trim(), mv = month.value, dv = String(day.value).trim();
      let date = null;
      if (p !== 'unknown' && yv) {
        date = yv;
        if ((p === 'month' || p === 'day') && mv) date += `-${mv}`;
        if (p === 'day' && mv && dv) date += `-${dv.padStart(2, '0')}`;
      }
      S.state = C.edits.setDate(S.state, g.key, date, p); viewPreview();
    };
    for (const x of [prec, year, month, day]) x.addEventListener('change', apply);
    const source = { folders: 'from your folder names', photos: 'from the photos', member: 'set by you' }[g.dateSource] || '';
    const missing = want === g.precision ? '' : (!g.date ? 'Enter the year' : (want === 'day' && hasMonth) ? 'Enter the day' : (want === 'month' || want === 'day') ? 'Choose the month' : 'Enter the year');
    return el('div', { class: 'dates' }, prec,
      want === 'unknown' ? null : year,
      ['day', 'month'].includes(want) ? month : null,
      want === 'day' ? day : null,
      el('span', { class: 'muted small', text: `${C.dateLabel(g.date, g.precision)}${source ? ' · ' + source : ''}` }),
      missing ? el('span', { class: 'small hint', text: `${missing} to finish this date.` }) : null);
  }

  function tile(f) {
    const off = S.state.excluded.has(f.key);
    const on = S.selected.has(f.key);
    const t = el('button', { class: `tile${on ? ' on' : ''}${off ? ' off' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'data-file': f.key,
      title: f.relativePath, 'aria-label': `${f.kind === 'video' ? 'Video' : 'Photo'} ${f.relativePath}${off ? ', left out' : ''}`,
      onclick: () => { if (S.selected.has(f.key)) S.selected.delete(f.key); else S.selected.add(f.key); viewPreview(); } });
    const file = fileByKey.get(f.key);
    if (f.kind === 'photo' && f.canThumb) {
      let url = S.thumbs.get(f.key);
      if (!url) { url = URL.createObjectURL(file); S.thumbs.set(f.key, url); }
      t.append(el('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }));
    } else if (f.kind === 'video' && f.canPoster) {
      const img = el('img', { alt: '' }); t.append(img);
      const cached = S.thumbs.get(f.key);
      if (cached) img.src = cached; else posterBlob(file, 240).then((b) => { if (b) { const u = URL.createObjectURL(b); S.thumbs.set(f.key, u); img.src = u; } });
    } else {
      t.append(el('span', { class: 'placeholder', text: f.kind === 'video' ? 'Video' : C.baseName(f.relativePath) }));
    }
    if (f.kind === 'video') t.append(el('span', { class: 'badge', text: `▶ ${Math.round(f.durationSeconds)}s · ${C.formatBytes(f.size)}` }));
    t.append(el('span', { class: 'check', 'aria-hidden': 'true' }), el('span', { class: 'name', text: C.baseName(f.relativePath) }));
    return t;
  }

  function skippedList(skipped, open) {
    const byReason = new Map();
    for (const s of skipped) { const k = s.message || C.REASONS[s.reason] || s.reason; if (!byReason.has(k)) byReason.set(k, []); byReason.get(k).push(s.relativePath); }
    return el('details', { open: open || null }, el('summary', { text: `${plural(skipped.length, 'file')} won't be imported` }),
      [...byReason].map(([why, paths]) => el('div', {}, el('h3', { text: `${why} (${paths.length})` }),
        el('ul', { class: 'files' }, paths.slice(0, 200).map((p) => el('li', {}, el('span', { class: 'path', text: p }))),
          paths.length > 200 ? el('li', { text: `…and ${paths.length - 200} more` }) : null))));
  }

  // ------------------------------------------------------------------ 6. upload
  function confirmUpload() {
    const sum = C.summary(S.state);
    if (!confirm(`Upload ${counts(sum.photos, sum.videos)} (${C.formatBytes(sum.bytes)}) to Add Past Memories for ${S.profile.name}?\n\nYour files stay on this computer. You'll review and save the memories in the DayCasion app.`)) return;
    startUpload();
  }

  async function startUpload() {
    const view = uploadView();
    const started = await rpc('dc_import_start', { p_profile_id: S.profile.id, p_source_name: topFolders() });
    if (!started.ok) return view.fail(errText(started, "We couldn't start the import. Please try again."));
    S.batch = started.data.batch_id;
    const tasks = [];
    for (const call of C.toPayload(S.state)) {
      const r = await rpc('dc_import_add_items', { p_batch_id: S.batch, p_groups: call });
      if (!r.ok) return view.fail(errText(r, "We couldn't prepare the upload. Please try again."), true);
      for (const res of r.data) {
        const f = S.state.items[res.key];
        if (res.result === 'new' || (res.result === 'existing' && res.status === 'pending')) tasks.push({ f, res, state: 'queued', tries: 0, pct: 0 });
        else if (res.result === 'existing') tasks.push({ f, res, state: 'done', pct: 100 });
        else S.skipped.push({ relativePath: f.relativePath, reason: res.reason, message: res.duplicate_of ? `${C.REASONS[res.reason] || res.reason} (${res.duplicate_of})` : C.REASONS[res.reason] });
      }
    }
    runQueue(tasks, view);
  }

  /** The folders the member chose (for the import's name), e.g. "Audrey Photos". */
  function topFolders() {
    const tops = new Set(S.files.filter((f) => f.relativePath.includes('/')).map((f) => f.relativePath.split('/')[0]));
    return [...tops].slice(0, 3).join(', ').slice(0, 255);
  }

  function uploadView() {
    const head = el('h2', { text: 'Uploading to DayCasion' });
    const line = el('p', { text: 'Preparing…' });
    const bar = el('div', {});
    const files = el('ul', { class: 'files', 'aria-label': 'Files' });
    const msg = el('p', { class: 'err', role: 'alert' });
    const actions = el('div', { class: 'actions' });
    const leave = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', leave);
    S.leave = leave;
    show(card(head, line, el('div', { class: 'progress' }, bar), el('p', { class: 'small muted', text: 'Keep this page open until it finishes. If it stops, you can continue later: your files stay on your computer.' }),
      msg, files, actions));
    return { head, line, bar, files, msg, actions, leave,
      fail(text, canCancel) { msg.textContent = text; window.removeEventListener('beforeunload', leave);
        actions.replaceChildren(el('button', { onclick: viewProfiles, text: 'Back' }), canCancel && S.batch ? el('button', { class: 'secondary', onclick: () => cancelBatch(S.batch, viewProfiles), text: 'Cancel import' }) : null); } };
  }

  function runQueue(tasks, view) {
    let stopped = false;
    const total = tasks.reduce((n, t) => n + t.f.size, 0) || 1;
    const rows = new Map();
    let paintTimer = null;
    const paint = () => { if (!paintTimer) paintTimer = setTimeout(() => { paintTimer = null; paintNow(); }, 200); };
    const paintNow = () => {
      const done = tasks.filter((t) => t.state === 'done').length;
      const failed = tasks.filter((t) => t.state === 'failed').length;
      const sent = tasks.reduce((n, t) => n + (t.state === 'done' ? t.f.size : t.f.size * (t.pct || 0) / 100), 0);
      view.line.textContent = `${done.toLocaleString()} of ${tasks.length.toLocaleString()} files uploaded${failed ? ` · ${failed} need another try` : ''}`;
      view.bar.style.width = `${Math.min(100, Math.round((100 * sent) / total))}%`;
      for (const t of tasks) {
        if (t.state === 'queued' || (t.state === 'done' && !rows.has(t))) continue;
        let li = rows.get(t);
        if (!li) { li = el('li', {}, el('span', { class: 'path', text: t.f.relativePath }), el('span', { class: 'st' })); rows.set(t, li); view.files.prepend(li); }
        li.lastChild.textContent = t.state === 'uploading' ? `${t.pct}%` : t.state === 'done' ? 'Uploaded' : t.state === 'failed' ? (t.error || 'Failed') : '';
        li.lastChild.className = `st ${t.state === 'failed' ? 'err' : t.state === 'done' ? 'ok' : ''}`;
      }
      while (view.files.children.length > 300) { const last = view.files.lastChild; for (const [k, v] of rows) if (v === last) rows.delete(k); last.remove(); }
    };
    view.actions.replaceChildren(el('button', { class: 'secondary', onclick: () => { if (confirm('Cancel this import? Files already uploaded are removed from DayCasion. Your files on this computer are not touched.')) { stopped = true; cancelBatch(S.batch, viewProfiles); } }, text: 'Cancel import' }));
    const worker = async () => {
      for (;;) {
        if (stopped) return;
        const t = tasks.find((x) => x.state === 'queued');
        if (!t) return;
        t.state = 'uploading'; paint();
        try { await uploadOne(t, () => paint()); t.state = 'done'; }
        catch (e) {
          t.tries++;
          if (e && e.message === 'signed-out') { stopped = true; return; }
          if (t.tries < 4 && !(e && e.permanent)) { t.state = 'queued'; await wait([1000, 3000, 8000][t.tries - 1] || 8000); }
          else { t.state = 'failed'; t.error = (e && e.userMessage) || 'Upload failed'; }
        }
        paint();
      }
    };
    paintNow();
    Promise.all(Array.from({ length: UPLOADS_AT_ONCE }, worker)).then(async () => {
      paintNow();
      if (stopped) return;
      const failed = tasks.filter((t) => t.state === 'failed');
      if (failed.length) {
        view.head.textContent = 'Almost done';
        view.msg.textContent = `${plural(failed.length, 'file')} didn't upload. The reason is shown next to each file; for a connection problem, try again.`;
        view.actions.replaceChildren(
          el('button', { onclick: () => { for (const t of failed) { t.state = 'queued'; t.tries = 0; t.error = null; } view.msg.textContent = ''; runQueue(tasks, view); }, text: `Try again (${failed.length})` }),
          el('button', { class: 'secondary', onclick: () => finish(view, failed.length), text: 'Finish without them' }),
          el('button', { class: 'link', onclick: () => { if (confirm('Cancel this import? Files already uploaded are removed from DayCasion.')) cancelBatch(S.batch, viewProfiles); }, text: 'Cancel import' }));
        return;
      }
      finish(view, 0);
    });
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function uploadOne(t, onProgress) {
    const file = fileByKey.get(t.f.key);
    if (!file) throw Object.assign(new Error('missing'), { permanent: true, userMessage: 'The file is no longer available on this computer' });
    // Optional preview copies first (small); a failure there never stops the photo itself.
    if (t.res.display_path) { try { const b = await displayBlob(file); if (b) await putObject(t.res.display_path, b, 'image/jpeg'); } catch (e) { /* optional */ } }
    if (t.res.poster_path) { try { const b = await posterBlob(file, 480); if (b) await putObject(t.res.poster_path, b, 'image/jpeg'); } catch (e) { /* optional */ } }
    await putObject(t.res.storage_path, file, t.f.mime, (pct) => { t.pct = pct; onProgress(); });
    let fin = await rpc('dc_import_finalize_item', { p_item_id: t.res.item_id });
    if (!fin.ok && /incomplete/.test(errText(fin, ''))) {
      // A copy cut short (e.g. a connection dropped at the end): replace it once.
      await removeStored([t.res.storage_path]);
      await putObject(t.res.storage_path, file, t.f.mime, (pct) => { t.pct = pct; onProgress(); });
      fin = await rpc('dc_import_finalize_item', { p_item_id: t.res.item_id });
    }
    if (!fin.ok) throw Object.assign(new Error('finalize'), { userMessage: errText(fin, 'Upload not confirmed'), permanent: fin.status === 400 && /match|incomplete/.test(errText(fin, '')) });
    if (fin.data && fin.data.status === 'rejected') {
      // DayCasion can't keep it now (storage full, plan or video plan ended): its copy is removed straight away.
      await removeStored([t.res.storage_path, t.res.display_path, t.res.poster_path].filter(Boolean));
      throw Object.assign(new Error('rejected'), { permanent: true, userMessage: C.REASONS[fin.data.reason] || 'Not kept' });
    }
  }

  /** Deletes this member's own stored copies (storage only allows a member's own folder). */
  async function removeStored(paths) {
    if (paths.length) await authed('/storage/v1/object/memory-media', { method: 'DELETE', body: { prefixes: paths } }).catch(() => null);
  }

  /** Storage upload with progress. An object that already exists (a resumed upload) counts as uploaded. */
  function putObject(path, blob, type, onPct) {
    return new Promise((resolve, reject) => {
      const go = (retried) => {
        const xhr = new XMLHttpRequest();
        S.active.add(xhr);
        xhr.onloadend = () => S.active.delete(xhr);
        xhr.onabort = () => reject(Object.assign(new Error('aborted'), { permanent: true, userMessage: 'Cancelled' }));
        xhr.open('POST', `${URL_}/storage/v1/object/memory-media/${path.split('/').map(encodeURIComponent).join('/')}`);
        xhr.setRequestHeader('Authorization', 'Bearer ' + session.access_token);
        xhr.setRequestHeader('apikey', KEY);
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.setRequestHeader('Content-Type', type);
        xhr.setRequestHeader('cache-control', 'max-age=3600');
        if (onPct) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onPct(Math.round((100 * e.loaded) / e.total)); };
        xhr.onload = async () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve();
          const body = xhr.responseText || '';
          if (xhr.status === 409 || /Duplicate|already exists/i.test(body)) return resolve();
          if ((xhr.status === 401 || /jwt|token/i.test(body) && xhr.status === 400) && !retried && await refresh()) return go(true);
          reject(Object.assign(new Error('upload'), { userMessage: xhr.status === 413 ? 'Too large to upload' : `Upload failed (${xhr.status})`, permanent: xhr.status === 413 || xhr.status === 415 }));
        };
        xhr.onerror = () => reject(Object.assign(new Error('network'), { userMessage: 'Connection lost' }));
        xhr.send(blob);
      };
      go(false);
    });
  }

  async function displayBlob(file) {
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return null;
    try {
      if (bmp.width <= C.DISPLAY_WIDTH) return null;
      const w = C.DISPLAY_WIDTH, h = Math.round((bmp.height * w) / bmp.width);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    } finally { bmp.close(); }
  }

  function posterBlob(file, width) {
    return new Promise((resolve) => {
      const v = document.createElement('video'); const url = URL.createObjectURL(file); let settled = false;
      const done = (b) => { if (settled) return; settled = true; URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); resolve(b); };
      v.muted = true; v.preload = 'auto'; v.playsInline = true;
      v.onloadeddata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
      v.onseeked = () => {
        if (!v.videoWidth) return done(null);
        const c = document.createElement('canvas'); c.width = width; c.height = Math.round((v.videoHeight * width) / v.videoWidth);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => done(b), 'image/jpeg', 0.75);
      };
      v.onerror = () => done(null);
      setTimeout(() => done(null), 10000);
      v.src = url;
    });
  }

  async function finish(view, dropped) {
    const r = await rpc('dc_import_finish', { p_batch_id: S.batch });
    window.removeEventListener('beforeunload', view.leave);
    if (!r.ok) { view.msg.textContent = errText(r, "We couldn't finish the import. Please try again."); return; }
    const groups = await authed(`/rest/v1/import_groups?select=id&batch_id=eq.${S.batch}`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
    const nGroups = +(String(groups.headers.get('content-range') || '').split('/')[1] || 0);
    if (!r.data.ready) {
      return show(card(el('h2', { text: 'Nothing new to import' }),
        el('p', { text: `These photos and videos are already in DayCasion for ${S.profile.name} (waiting in Add Past Memories or already in a memory).` }),
        S.skipped.length ? skippedList(S.skipped, true) : null,
        el('div', { class: 'actions' }, el('button', { onclick: viewProfiles, text: 'Import something else' }))));
    }
    show(card(el('h2', { text: 'Ready in the DayCasion app' }),
      el('p', { text: `${plural(r.data.ready, 'file')} in ${plural(nGroups, 'suggested memory', 'suggested memories')} are waiting in Add Past Memories for ${S.profile.name}.` }),
      el('ol', {}, el('li', { text: 'Open DayCasion on your phone.' }), el('li', { text: `Go to ${S.profile.name} › Add Past Memories.` }),
        el('li', { text: 'Review each suggested memory, add its story, and save it.' })),
      dropped ? el('p', { class: 'small muted', text: `${plural(dropped, 'file')} that didn't upload were left out. Your originals are still on this computer.` }) : null,
      S.skipped.length ? skippedList(S.skipped) : null,
      el('div', { class: 'actions' }, el('button', { onclick: viewProfiles, text: 'Import more' }))));
  }

  async function cancelBatch(id, then) {
    for (const xhr of [...S.active]) xhr.abort(); // nothing of this import may land after it is cancelled
    S.active.clear();
    const r = await rpc('dc_import_cancel', { p_batch_id: id });
    // Stored copies are removed by DayCasion's clean-up; remove this import's folder now as well.
    if (r.ok) {
      const list = await authed('/storage/v1/object/list/memory-media', { method: 'POST', body: { prefix: `${session.user.id}/imports/${id}`, limit: 1000 } }).catch(() => null);
      const names = list && list.ok && Array.isArray(list.data) ? list.data.map((o) => `${session.user.id}/imports/${id}/${o.name}`) : [];
      for (let i = 0; i < names.length; i += 100) await authed('/storage/v1/object/memory-media', { method: 'DELETE', body: { prefixes: names.slice(i, i + 100) } }).catch(() => null);
    } else alert(errText(r, "We couldn't cancel the import. Please try again."));
    if (S.leave) window.removeEventListener('beforeunload', S.leave);
    then();
  }

  // ------------------------------------------------------------------ resume an unfinished import
  function startResume(batch, profile) { S.profile = profile; S.resume = { batch }; viewChoose(); }

  async function resumeUpload(files) {
    const batch = S.resume.batch; S.batch = batch.id;
    const view = uploadView();
    const pending = [];
    for (let from = 0; ; from += 1000) {
      const r = await authed(`/rest/v1/import_items?select=id,relative_path,size_bytes,content_hash,kind,mime_type,storage_path,display_path,poster_path&batch_id=eq.${batch.id}&status=eq.pending&order=id`,
        { headers: { Range: `${from}-${from + 999}` } });
      if (!r.ok) return view.fail(errText(r, "We couldn't load the unfinished import."), true);
      pending.push(...r.data); if (r.data.length < 1000) break;
    }
    const byPath = new Map(files.map((f) => [f.relativePath, f]));
    const tasks = []; let missing = 0;
    for (const p of pending) {
      const f = byPath.get(p.relative_path);
      if (!f || f.size !== p.size_bytes || f.hash !== p.content_hash) { missing++; continue; }
      tasks.push({ f: { ...f, mime: p.mime_type }, res: { item_id: p.id, storage_path: p.storage_path, display_path: p.display_path, poster_path: p.poster_path }, state: 'queued', tries: 0, pct: 0 });
    }
    S.skipped = [];
    if (missing) view.msg.textContent = `${plural(missing, 'file')} from the first try weren't found in this folder. Choose the same folder, or finish without them.`;
    if (!tasks.length) { view.line.textContent = 'Nothing left to upload from this folder.'; return finish(view, missing); }
    runQueue(tasks, view);
  }

  // ------------------------------------------------------------------ start
  session = loadSession();
  if (session && session.access_token) viewProfiles(); else viewSignIn();
  window.DcImportApp = { state: () => S }; // read-only hook for the automated tests
})();
