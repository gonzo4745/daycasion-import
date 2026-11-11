/* DayCasion Desktop Import (import.daycasion.com). Sign in -> choose a memory profile -> choose what to do:
 *   1. Bulk Import Memories, two ways:
 *      a. My Photos Are Organized: folders become proposed memories; after one review they are created as saved memories.
 *      b. Sort My Photos by Date (organize.js): the folder is sorted by year and month on the computer; the member picks
 *         photos and creates one memory at a time (only those photos are uploaded).
 *   2. Add to Existing Memory: files are added to one saved memory (its title, date and story are not changed).
 *   3. Upload for Later: up to 50 files wait in the profile's Add Past Memories, to be organized in the app.
 *   Below them, Import My Eulogy (eulogy.js): the member's finished eulogy (No AI) or eulogy information (AI-assisted).
 * Every path stages the files first (dc_import_*), then 1 and 2 save them with the same server steps the app's
 * Add Past Memories uses (dc_import_begin_save / dc_import_begin_add_to_memory, storage move, dc_import_attach_item,
 * dc_import_finish_group), so ownership, plan, video and storage rules apply unchanged.
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
  const RUNS_KEY = 'dc-import-runs'; // localStorage: what an unfinished import was for (create / existing / later)
  const UPLOADS_AT_ONCE = 3;
  const SCANS_AT_ONCE = 3;
  const $app = document.getElementById('app');
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp',
    'video/mp4': 'mp4', 'video/quicktime': 'mov' }; // as dc_import_ext
  const LATER_MAX = 50; // Upload for Later: files per batch (the server enforces the same)
  const MODES = {
    bulk: { label: 'Bulk Import Memories', icon: '✦',
      text: 'Create new DayCasion memories from your photos and videos. Use your existing folders or let DayCasion help organize your photos by date.',
      hint: 'Two ways: My Photos Are Organized, or Sort My Photos by Date.' },
    create: { label: 'My Photos Are Organized', icon: '▤', parent: 'bulk',
      text: 'Already organized your photos into folders or events? Use your folders to create DayCasion memories.',
      hint: 'Best for folders of events, years, trips, childhood or pet photos.' },
    organize: { label: 'Sort My Photos by Date', icon: '◷', parent: 'bulk',
      text: 'Have a large collection of photos? Sort them by year and month, select the moments that matter, and create memories.',
      hint: 'Sorted on your computer. Only the photos you choose are uploaded.' },
    existing: { label: 'Add to Existing Memory', icon: '＋',
      text: 'Choose a memory you\'ve already created, then add individual photos, videos, or entire folders.',
      hint: 'The memory\'s title, date and story stay as they are.' },
    later: { label: 'Upload for Later', icon: '⇪',
      text: 'Upload photos and videos without creating memories yet. Organize them later in the DayCasion app.',
      hint: `Up to ${LATER_MAX} photos or videos at a time. They wait in Add Past Memories in the app.` },
    eulogy: { label: 'Import My Eulogy', icon: '✎',
      text: 'Upload your finished eulogy, or information for DayCasion to prepare it with AI.',
      hint: 'Private. Only your Legacy Executor receives the final eulogy.' },
  };

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
  /** Redraws the same screen after an edit without moving the page: the memory being edited stays where it was on
   * screen (and its control keeps focus); otherwise the scroll position is kept. */
  function redrawInPlace(...nodes) {
    const active = document.activeElement;
    const section = active && active.closest ? active.closest('section.group') : null;
    const key = section && section.getAttribute('data-group');
    const top = section ? section.getBoundingClientRect().top : null;
    const label = active && active.getAttribute ? active.getAttribute('aria-label') : null;
    const y = window.scrollY;
    $app.replaceChildren(...nodes);
    const again = key ? [...$app.querySelectorAll('section.group')].find((x) => x.getAttribute('data-group') === key) : null;
    if (again) {
      window.scrollTo(0, window.scrollY + again.getBoundingClientRect().top - top);
      const control = label ? [...again.querySelectorAll('[aria-label]')].find((x) => x.getAttribute('aria-label') === label) : null;
      if (control) control.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, y);
    }
  }
  const card = (...kids) => el('div', { class: 'card' }, ...kids);
  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : (many || one + 's')}`;
  const counts = (photos, videos) => [photos ? plural(photos, 'photo') : null, videos ? plural(videos, 'video') : null].filter(Boolean).join(' · ') || 'Nothing';
  const countsAnd = (photos, videos) => [photos ? plural(photos, 'photo') : null, videos ? plural(videos, 'video') : null].filter(Boolean).join(' and ') || 'nothing';
  const memoriesWord = (n) => `${n.toLocaleString()} ${n === 1 ? 'Memory' : 'Memories'}`;
  const filesWord = (n) => `${n.toLocaleString()} ${n === 1 ? 'File' : 'Files'}`;
  const quoted = (t) => `“${t}”`;

  /** An in-page question. Resolves to the chosen option's value, or null when dismissed (Esc or the last button). */
  function choose({ title, body, options }) {
    return new Promise((resolve) => {
      const d = el('dialog', { class: 'dlg', 'aria-labelledby': 'dlg-title' });
      const btns = options.map((o, i) => el('button', { type: 'button', id: o.id || (i === 0 ? 'dlg-ok' : `dlg-${i}`),
        class: o.secondary ? 'secondary' : null, onclick: () => d.close(String(i)), text: o.label }));
      d.append(el('h2', { id: 'dlg-title', text: title }),
        ...[].concat(body || []).filter(Boolean).map((b) => (typeof b === 'string' ? el('p', { text: b }) : b)),
        el('div', { class: 'actions' }, btns,
          el('button', { type: 'button', id: 'dlg-cancel', class: 'link', onclick: () => d.close(''), text: 'Go back' })));
      d.addEventListener('close', () => { const i = d.returnValue; d.remove(); resolve(i === '' || i == null ? null : options[+i].value); });
      document.body.append(d);
      d.showModal();
      btns[0].focus();
    });
  }
  const ask = async (title, body, ok) => (await choose({ title, body, options: [{ label: ok, value: true }] })) === true;

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
    if (r.status === 401) { endSession(); throw new Error('signed-out'); }
    return r;
  }
  const rpc = (fn, args) => authed(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args || {} });
  const errText = (r, fallback) => (r && r.data && (r.data.message || r.data.msg || r.data.error_description)) || fallback;
  /** DayCasion's own explanation (plan, storage, …); a dropped connection or server hiccup in plain words. */
  const plainErr = (r, fallback) => (!r || r.offline || r.status >= 500 ? 'The connection was interrupted. Please try again.' : errText(r, fallback));
  const countOf = (r) => +(String((r && r.headers && r.headers.get('content-range')) || '').split('/')[1] || 0);
  async function signOut() {
    const uid = session && session.user && session.user.id;
    const O = window.DcOrganize;
    if (uid && O && await O.hasLocal(uid).catch(() => false)) {
      const forget = await choose({ title: 'Signing out', body: ['Unfinished sorting from Sort My Photos by Date is kept in this browser so you can continue later. On a shared computer, you can forget it now.',
        'Memories you created stay in DayCasion either way.'], options: [{ label: 'Keep it for next time', value: 'keep' }, { label: 'Forget it on this computer', value: 'forget', secondary: true }] });
      if (forget === 'forget') await O.forget(uid).catch(() => null);
    }
    endSession();
  }
  function endSession() { if (session) api('/auth/v1/logout', { method: 'POST', auth: true }); session = null; saveSession(null); viewSignIn(); }

  // What each unfinished import was for, so "Continue it" finishes it the same way (this browser only).
  function runs() { try { return JSON.parse(localStorage.getItem(RUNS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function rememberRun(id, info) { try { const r = runs(); r[id] = info; localStorage.setItem(RUNS_KEY, JSON.stringify(r)); } catch (e) { /* storage off */ } }
  function forgetRun(id) { try { const r = runs(); delete r[id]; localStorage.setItem(RUNS_KEY, JSON.stringify(r)); } catch (e) { /* storage off */ } }

  // ------------------------------------------------------------------ state
  const S = {
    profiles: [], profile: null, plan: null, storage: null,
    mode: null, // 'create' | 'existing' | 'later'
    target: null, // Add to Existing Memory: { id, title, date, precision, count }
    files: [], skipped: [], state: null, selected: new Set(), organizing: null, batch: null, resume: null, run: null,
    thumbs: new Map(), active: new Set(), // uploads in flight (aborted on cancel)
    scan: 0, // which selection of folders is on screen: file keys are unique to it
  };
  const fileByKey = new Map(); // key -> File

  /** Forgets the current selection of folders (files, proposed memories, selection, skipped list, previews) before a
   * new one: Start over, Import more, another profile, other folders, and every new scan. Nothing that was uploaded is
   * touched. Previews still being made for the old selection are discarded when they finish (see tile). */
  function clearSelection() {
    S.scan++;
    for (const url of S.thumbs.values()) URL.revokeObjectURL(url);
    S.thumbs = new Map();
    fileByKey.clear();
    S.files = []; S.skipped = []; S.state = null; S.selected = new Set(); S.organizing = null; S.batch = null; S.run = null;
  }

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
        authed('/rest/v1/import_batches?select=id,memory_profile_id,source_name,status,created_at,purpose&status=eq.uploading&order=created_at.desc'),
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
    const pending = await Promise.all(unfinished.map((b) => authed(`/rest/v1/import_items?select=id&batch_id=eq.${b.id}&status=eq.pending`, { headers: { Prefer: 'count=exact', Range: '0-0' } }).then(countOf)));
    const list = el('div', { class: 'profiles', role: 'list' });
    for (const p of S.profiles) {
      const a = access.get(p.id);
      const enforced = S.storage && S.storage.enforced;
      const blocked = enforced && a && !a.has_access;
      list.append(el('button', { class: 'profile', role: 'listitem', 'data-profile': p.id, disabled: blocked || null, onclick: () => startProfile(p) },
        p.name || 'Unnamed', el('span', { text: blocked ? 'Needs a DayCasion plan' : (p.type || '') + (a && a.has_access && !a.video && enforced ? ' · photos only' : '') })));
    }
    const known = runs();
    const resumeCards = unfinished.map((b, i) => {
      const p = S.profiles.find((x) => x.id === b.memory_profile_id);
      const info = known[b.id] || {};
      const mode = b.purpose || info.mode;
      const what = mode === 'create' ? 'My Photos Are Organized' : mode === 'organize' ? 'Sort My Photos by Date'
        : mode === 'existing' ? `Add to ${quoted(info.title || 'a memory')}` : mode === 'later' ? 'Upload for Later' : 'Import';
      return el('div', { class: 'note' },
        el('strong', { text: `Unfinished: ${what} for ${p ? p.name : 'a memory profile'}` }),
        el('p', { class: 'small', text: `${b.source_name || 'Your folders'} · started ${new Date(b.created_at).toLocaleString()}${pending[i] ? ` · ${plural(pending[i], 'file')} not uploaded yet` : ''}.` }),
        el('div', { class: 'actions' },
          el('button', { class: 'small', onclick: () => startResume(b, p), text: 'Continue it' }),
          el('button', { class: 'small secondary', onclick: async () => {
            if (await ask('Cancel this import?', 'Photos and videos from it that aren\'t in a memory yet are removed from DayCasion. Memories it already created stay. Your files on this computer are not touched.', 'Cancel the import')) cancelBatch(b.id, viewProfiles);
          }, text: 'Cancel it' })));
    });
    if (S.goEulogy) { S.goEulogy = false; return openEulogy(viewProfiles); } // opened from the app's My Eulogy
    show(card(el('div', { class: 'row' }, el('h2', { text: 'Whose photos are these?' }), el('button', { class: 'link', onclick: signOut, text: 'Sign out' })),
      el('p', { class: 'muted small', text: 'Choose the memory profile these photos and videos belong to.' }),
      list, storageLine()), ...resumeCards,
    card(el('h2', { text: 'My Eulogy' }),
      el('p', { class: 'muted small', text: 'Upload your finished eulogy, or information for DayCasion to prepare it with AI. Private: only your Legacy Executor receives the final eulogy.' }),
      el('div', { class: 'actions' }, el('button', { id: 'open-eulogy', class: 'secondary', onclick: () => openEulogy(viewProfiles), text: 'Import My Eulogy' }))));
  }
  function storageLine() {
    const st = S.storage; if (!st || !st.allowance_bytes) return null;
    const left = Math.max(0, st.allowance_bytes - st.used_bytes);
    return el('p', { class: 'small muted', text: `${C.formatBytes(left)} of storage left on your plan.` });
  }

  function startProfile(p) { clearSelection(); S.profile = p; S.mode = null; S.target = null; S.resume = null; viewMode(); }

  // ------------------------------------------------------------------ 3. what to do
  const option = (m) => el('button', { class: 'choice', id: `mode-${m}`, 'data-mode': m, onclick: () => chooseMode(m) },
    el('span', { class: 'choice-icon', 'aria-hidden': 'true', text: MODES[m].icon }),
    el('strong', { text: MODES[m].label }),
    el('span', { class: 'choice-text', text: MODES[m].text }),
    el('span', { class: 'choice-hint', text: MODES[m].hint }));
  /** Three photo choices; Import My Eulogy is its own section below them (My Life profiles, as before). */
  function viewMode() {
    clearSelection(); S.resume = null;
    show(card(el('div', { class: 'row' }, el('h2', { text: 'What would you like to do with these photos and videos?' }),
      el('button', { class: 'link', onclick: viewProfiles, text: `For ${S.profile.name} · change` })),
    el('div', { class: 'choices three' }, option('bulk'), option('existing'), option('later'))),
    S.profile.type === 'My Life' ? card(el('h2', { text: 'My Eulogy' }),
      el('p', { class: 'muted small', text: MODES.eulogy.text + ' ' + MODES.eulogy.hint }),
      el('div', { class: 'actions' }, el('button', { id: 'mode-eulogy', class: 'secondary', onclick: () => chooseMode('eulogy'), text: MODES.eulogy.label }))) : null);
  }
  /** Bulk Import Memories: the two ways to create new memories. */
  function viewBulk() {
    clearSelection(); S.resume = null; S.mode = null;
    show(card(el('div', { class: 'row' }, el('h2', { text: 'Bulk Import Memories' }),
      el('button', { class: 'link', onclick: viewMode, text: 'Back to all choices' })),
    el('p', { class: 'crumbs small' }, 'For ', el('strong', { text: S.profile.name }), ' · ', el('strong', { text: MODES.bulk.label })),
    el('p', { class: 'muted', text: 'How are your photos arranged today?' }),
    el('div', { class: 'choices' }, option('create'), option('organize'))));
  }
  function chooseMode(m) {
    if (m === 'eulogy') return openEulogy(viewMode);
    if (m === 'bulk') return viewBulk();
    if (m === 'organize') return openOrganize();
    S.mode = m; S.target = null; if (m === 'existing') viewPickMemory(); else viewChoose();
  }
  /** Import My Eulogy (eulogy.js). Needs no plan (preparing needs the Eulogy purchase; viewing it does not), so it is also
   *  offered on the profile screen. */
  function openEulogy(back) {
    clearSelection();
    window.DcEulogy.open({ el, show, card, choose, ask, rpc, authed, plainErr, errText, url: URL_, key: KEY,
      session: () => session, back: back || viewProfiles,
      // A fresh access token for long video uploads (each chunk asks again; refreshed a few minutes before it expires).
      token: async () => { if (session && session.expires_at - Date.now() / 1000 < 300) await refresh(); return session && session.access_token; } });
  }

  /** Sort My Photos by Date (organize.js), with the same sign-in, storage and import steps as the other choices. */
  function openOrganize() {
    clearSelection(); S.mode = 'organize'; S.target = null;
    window.DcOrganize.open({ el, show, card, choose, ask, rpc, authed, plainErr, errText, plural, quoted, counts, countsAnd,
      session: () => session, profile: S.profile, storage: () => S.storage, crumbs, back: viewBulk, home: viewMode,
      stageFile, putObject, displayBlob, posterBlob, removeStored, probeImage, probeVideo, rememberRun, forgetRun, filesFromDrop,
      cancelBatch: (id) => new Promise((resolve) => cancelBatch(id, resolve)), redrawInPlace,
      refreshStorage: async () => { const r = await rpc('dc_account_storage').catch(() => null); if (r && r.ok) S.storage = r.data; return S.storage; } });
  }

  /** "For Audrey · Bulk Import Memories › My Photos Are Organized · choose something else": where the member is, with a
   *  way back (to the two Bulk Import choices, or to the three choices). */
  function crumbs(extra) {
    const m = MODES[S.mode]; const back = m.parent ? viewBulk : viewMode;
    return el('p', { class: 'crumbs small' }, 'For ', el('strong', { text: S.profile.name }), ' · ',
      m.parent ? el('strong', { text: `${MODES[m.parent].label} › ${m.label}` }) : el('strong', { text: m.label }), ' · ',
      el('button', { class: 'link', onclick: async () => { if (!S.state || await ask('Choose something else?', 'Your changes on this page will be lost. Nothing has been uploaded.', 'Choose something else')) back(); }, text: 'choose something else' }),
      extra || null);
  }

  // ------------------------------------------------------------------ 3b. Add to Existing Memory: which memory
  async function viewPickMemory() {
    show(card(el('p', { class: 'muted', text: `Loading ${S.profile.name}'s memories…` })));
    let r;
    try {
      r = await authed(`/rest/v1/memories?select=id,title,occurred_on,date_precision,memory_media(count),memory_profile_links!inner(memory_profile_id)&memory_profile_links.memory_profile_id=eq.${S.profile.id}&order=occurred_on.desc.nullslast,created_at.desc&limit=500`);
    } catch (e) { return; }
    if (!r.ok) return show(card(el('p', { class: 'err', text: "We couldn't load the memories. Please try again." }), el('div', { class: 'actions' }, el('button', { onclick: viewPickMemory, text: 'Try again' }))));
    const rows = (r.data || []).map((m) => ({ id: m.id, title: (m.title || '').trim() || 'Untitled memory', date: m.occurred_on, precision: m.date_precision || 'unknown',
      count: (m.memory_media && m.memory_media[0] && +m.memory_media[0].count) || 0 }));
    const head = el('div', { class: 'row' }, el('h2', { text: 'Which memory should the files go into?' }));
    if (!rows.length) {
      return show(card(head, crumbs(), el('p', { text: `${S.profile.name} doesn't have any saved memories yet.` }),
        el('div', { class: 'actions' }, el('button', { onclick: () => chooseMode('create'), text: 'Create New Memories instead' }))));
    }
    const list = el('div', { class: 'memories', role: 'list' });
    const search = el('input', { type: 'search', class: 'full', placeholder: 'Search by title', 'aria-label': 'Search memories' });
    const paint = () => {
      const q = search.value.trim().toLowerCase();
      const shown = rows.filter((m) => !q || m.title.toLowerCase().includes(q));
      list.replaceChildren(...shown.map((m) => el('button', { class: 'memory', role: 'listitem', 'data-memory': m.id, onclick: () => { S.target = m; viewChoose(); } },
        el('strong', { text: m.title }), el('span', { text: `${C.dateLabel(m.date, m.precision)} · ${plural(m.count, 'item')}` }))),
      shown.length ? null : el('p', { class: 'muted', text: 'No memories match.' }));
    };
    search.addEventListener('input', paint);
    paint();
    show(card(head, crumbs(), el('p', { class: 'muted small', text: `${plural(rows.length, 'saved memory', 'saved memories')} for ${S.profile.name}. The one you choose keeps its title, date and story.` }),
      search, list));
    search.focus();
  }

  function targetLine() {
    const t = S.target;
    return el('div', { class: 'note target' }, el('span', { class: 'small muted', text: 'Adding to' }),
      el('strong', { text: t.title }), el('span', { class: 'small muted', text: `${C.dateLabel(t.date, t.precision)} · ${plural(t.count, 'item')} now` }),
      el('button', { class: 'link', onclick: viewPickMemory, text: 'Choose a different memory' }));
  }

  // ------------------------------------------------------------------ 4. choose folders or files
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
      el('p', { text: S.resume ? 'Drop the same folder here again to continue' : 'Drop folders or photos and videos here' }),
      el('p', { class: 'muted small', text: `Photos: JPEG, HEIC, PNG or WebP, up to 50 MB. Videos: MP4 or MOV, up to ${Math.round(C.LIMITS.videoBytes / 1048576)} MB.` }),
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
    const intro = {
      create: 'Choose a folder, even a parent folder with years or events inside it. DayCasion suggests one memory per event folder, for example 2014 › Dec 23 › Christmas. You\'ll review the titles and dates before anything is uploaded.',
      existing: 'Choose the photos and videos to add. You\'ll see them before anything is uploaded.',
      later: `Choose whole folders or individual photos and videos, up to ${LATER_MAX} at a time. You'll see them before anything is uploaded.`,
    }[S.mode];
    const waitingNote = S.mode === 'later' ? el('p', { class: 'small muted', 'data-waiting': '' }) : null;
    if (waitingNote) waitingCount().then((n) => { waitingNote.textContent = waitingText(n); });
    show(card(el('h2', { text: S.resume ? 'Continue the unfinished import' : MODES[S.mode].label }),
      S.resume ? null : crumbs(),
      S.mode === 'existing' && S.target && !S.resume ? targetLine() : null,
      S.resume ? el('p', { class: 'note small', text: `Choose the same folder you used before (${S.resume.batch.source_name || 'your folders'}). Files already uploaded are skipped.` })
        : el('p', { class: 'intro', text: intro }),
      waitingNote, drop));
  }

  /** Files from the computer waiting in the app's Add Past Memories for this profile (photos added on the phone are
   *  kept on the phone, so they can't be counted here). Null when it can't be read. */
  async function waitingCount() {
    try {
      const g = await authed(`/rest/v1/import_groups?select=id&memory_profile_id=eq.${S.profile.id}&status=eq.open`);
      if (!g.ok) return null;
      const ids = (g.data || []).map((x) => x.id); let n = 0;
      for (let i = 0; i < ids.length; i += 80) {
        const r = await authed(`/rest/v1/import_items?select=id&group_id=in.(${ids.slice(i, i + 80).join(',')})&status=in.(pending,ready)`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
        if (!r.ok) return null; n += countOf(r);
      }
      return n;
    } catch (e) { return null; }
  }
  const waitingText = (n) => (n == null ? '' : n === 0 ? `Nothing from your computer is waiting in the app for ${S.profile.name} yet.`
    : `${plural(n, 'file')} from your computer ${n === 1 ? 'is' : 'are'} already waiting in the app for ${S.profile.name}, ready to organize in Add Past Memories.`);

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

  // ------------------------------------------------------------------ 5. read the files (type, size, dates, duplicates)
  async function scan(list) {
    const status = el('p', { class: 'muted', text: 'Looking through your folders…' });
    const bar = el('div', {});
    show(card(el('h2', { text: 'Reading your photos and videos' }), status, el('div', { class: 'progress' }, bar),
      el('p', { class: 'small muted', text: 'This happens on your computer. Nothing is uploaded yet.' })));
    clearSelection(); // a new selection never reuses the previous one's files, keys or previews
    const scanId = S.scan;
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
        const f = { key: `s${scanId}f${++keyN}`, relativePath: x.relativePath, folderPath: C.dirName(x.relativePath), kind: x.cls.kind, mime: x.cls.mime,
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
    for (const d of duplicates) skipped.push({ relativePath: d.relativePath, reason: 'duplicate_in_selection', kind: d.kind, duplicateOf: d.duplicateOf, message: `Same file as ${d.duplicateOf}` });
    S.files = kept; S.skipped = skipped; S.selected = new Set();
    if (S.resume) return resumeRun(kept);
    if (!kept.length) {
      return show(card(el('h2', { text: 'No photos or videos to import' }), skippedList(skipped, true),
        el('div', { class: 'actions' }, el('button', { onclick: () => { clearSelection(); viewChoose(); }, text: 'Choose other folders' }))));
    }
    let st = C.makeState(kept);
    if (S.mode === 'existing') { // one group: everything goes into the chosen memory
      st = C.edits.merge(st, st.groups.map((g) => g.key));
      st.groups[0].title = S.target.title.slice(0, 200);
      st.groups[0].date = S.target.precision === 'unknown' ? null : S.target.date; st.groups[0].precision = S.target.date ? S.target.precision : 'unknown';
    }
    S.state = st;
    if (S.mode === 'create') viewReviewCreate(true); else viewReviewFiles(true);
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

  // ------------------------------------------------------------------ 6a. review: Create New Memories
  const startOver = () => el('button', { class: 'link', onclick: async () => { if (await ask('Start over?', 'Your changes on this page will be lost. Nothing has been uploaded.', 'Start over')) { clearSelection(); viewChoose(); } }, text: 'Start over' });
  const storageLeft = () => (S.storage && S.storage.allowance_bytes ? S.storage.allowance_bytes - S.storage.used_bytes : null);
  const isOver = (sum) => { const left = storageLeft(); return left != null && S.storage.enforced && sum.bytes > left; };

  /** [fresh]: first time this screen is shown (top of the page). Edits redraw it in place. */
  function viewReviewCreate(fresh) {
    const st = S.state;
    const sum = C.summary(st);
    const over = isOver(sum);
    const top = card(
      el('div', { class: 'row' }, el('h2', { text: `Review ${plural(sum.groups, 'new memory', 'new memories')} for ${S.profile.name}` }), startOver()),
      crumbs(),
      el('p', { class: 'lead', text: 'Each group below becomes one saved memory in DayCasion, with its own title, date, photos and videos. Check them, change anything you like, add a description if you wish, then create them all at once. Nothing is uploaded until you do.' }),
      el('ul', { class: 'tips small muted' },
        el('li', { text: 'Everything is included. To leave a photo or video out, choose Remove on it.' }),
        el('li', { text: 'To move photos between memories or split one in two, choose Organize photos on that memory.' })),
      S.skipped.length ? skippedList(S.skipped) : null);
    const n = st.groups.length;
    const groups = st.groups.map((g, i) => groupCard(g, i, n));
    const label = `Create ${memoriesWord(sum.groups)} in DayCasion`;
    (fresh ? show : redrawInPlace)(top, ...groups,
      actionBar(`${plural(sum.groups, 'memory', 'memories')} · ${counts(sum.photos, sum.videos)} · ${C.formatBytes(sum.bytes)}`,
        over ? `This is more than your remaining storage (${C.formatBytes(Math.max(0, storageLeft()))}). Remove some photos, or add storage in the app.` : null,
        el('button', { id: 'upload', disabled: !sum.groups || over || null, onclick: confirmCreate, text: label })));
  }

  function actionBar(summary, problem, button) {
    return el('div', { class: 'actionbar', role: 'region', 'aria-label': 'Ready to import' },
      el('div', { class: 'summary' }, el('strong', { text: summary }), problem ? el('span', { class: 'err small', text: problem }) : null), button);
  }

  function groupCard(g, i, n) {
    const st = S.state;
    const included = g.items.filter((k) => !st.excluded.has(k));
    const photos = included.filter((k) => st.items[k].kind === 'photo').length;
    const bytes = included.reduce((s, k) => s + st.items[k].size, 0);
    const allOut = included.length === 0;
    const organizing = S.organizing === g.key && !allOut;
    const title = el('input', { class: 'title', value: g.title, maxlength: '200', 'aria-label': 'Memory title' });
    title.addEventListener('change', () => { S.state = C.edits.rename(S.state, g.key, title.value); });
    const grid = el('div', { class: 'grid' });
    const shown = g.showAll ? g.items : g.items.slice(0, 30);
    for (const k of shown) grid.append(organizing ? pickTile(st.items[k]) : tile(st.items[k]));
    const redraw = () => viewReviewCreate();
    return el('section', { class: `group${allOut ? ' excluded' : ''}${organizing ? ' organizing' : ''}`, 'data-group': g.key, 'aria-label': g.title },
      el('div', { class: 'group-top' }, el('span', { class: 'num', text: `New memory ${i + 1} of ${n}` }),
        el('span', { class: 'muted small', text: allOut ? 'Won\'t be created' : `${counts(photos, included.length - photos)} · ${C.formatBytes(bytes)}` })),
      el('div', { class: 'group-head' }, title),
      dateEditor(g),
      descriptionBox(g),
      el('p', { class: 'folders', text: `From ${g.folders.map((f) => f || 'the files you chose').join(', ')}` }),
      allOut ? el('div', { class: 'note small' }, 'This memory won\'t be created. ',
        el('button', { class: 'link', onclick: () => { S.state = C.edits.excludeGroup(S.state, g.key, false); redraw(); }, text: 'Create it after all' })) : null,
      organizing ? organizePanel(g) : null,
      allOut ? null : grid,
      !allOut && g.items.length > shown.length ? el('button', { class: 'link', onclick: () => { g.showAll = true; redraw(); }, text: `Show all ${g.items.length}` }) : null,
      allOut ? null : el('div', { class: 'group-actions' },
        organizing ? null : el('button', { class: 'small secondary', 'aria-expanded': 'false', onclick: () => { S.organizing = g.key; S.selected = new Set(); redraw(); }, text: 'Organize photos' }),
        el('button', { class: 'link', onclick: () => { S.state = C.edits.excludeGroup(S.state, g.key, true); if (S.organizing === g.key) S.organizing = null; redraw(); }, text: 'Don\'t create this memory' })));
  }

  /** Optional description (the memory's story), saved with the memory. Kept in the review state as it is typed (no
   *  redraw, so the cursor stays put); every later redraw shows it again. Blank unless the member writes one. */
  function descriptionBox(g) {
    const box = el('textarea', { class: 'description', rows: '3', maxlength: String(C.MAX_DESCRIPTION), 'aria-label': 'Memory description',
      placeholder: 'Description (optional): what happened, who was there, what you want to remember' });
    box.value = g.description || '';
    box.addEventListener('input', () => { S.state = C.edits.describe(S.state, g.key, box.value); });
    return box;
  }

  /** Optional tools for one proposed memory: select photos, then move them to another proposed memory or make them a
   * separate memory; or combine the whole memory with another. */
  function organizePanel(g) {
    const st = S.state;
    const sel = [...S.selected].filter((k) => g.items.includes(k));
    const others = st.groups.filter((x) => x.key !== g.key);
    const redraw = () => viewReviewCreate();
    const name = (x) => `${x.title} (${C.dateLabel(x.date, x.precision)})`;
    const move = el('select', { 'aria-label': 'Move selected to another memory', disabled: !sel.length || !others.length || null },
      el('option', { value: '', text: sel.length ? `Move ${plural(sel.length, 'selected item')} to…` : 'Move selected to…' }), others.map((x) => el('option', { value: x.key, text: name(x) })));
    move.addEventListener('change', () => { if (move.value) { S.state = C.edits.moveItems(S.state, sel, move.value); S.selected = new Set(); redraw(); } });
    const combine = others.length ? el('select', { 'aria-label': 'Combine this whole memory with another' },
      el('option', { value: '', text: 'Combine this whole memory with…' }), others.map((x) => el('option', { value: x.key, text: name(x) }))) : null;
    if (combine) combine.addEventListener('change', () => { if (combine.value) { S.state = C.edits.merge(S.state, [combine.value, g.key]); S.organizing = null; S.selected = new Set(); redraw(); } });
    return el('div', { class: 'organize', role: 'region', 'aria-label': 'Organize photos' },
      el('p', { class: 'small', text: sel.length ? `${plural(sel.length, 'item')} selected.` : 'Click photos and videos below to select them, then choose what to do with them.' }),
      el('div', { class: 'actions' }, move,
        el('button', { class: 'small secondary', disabled: !sel.length || sel.length === g.items.length || null,
          onclick: () => { S.state = C.edits.split(S.state, g.key, sel, `${g.title} (2)`); S.selected = new Set(); redraw(); }, text: 'Make selected a separate memory' }),
        combine,
        el('button', { class: 'small', onclick: () => { S.organizing = null; S.selected = new Set(); redraw(); }, text: 'Done organizing' })));
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
      S.state = C.edits.setDate(S.state, g.key, date, p); viewReviewCreate();
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

  /** The picture inside a tile (photo thumbnail, video poster or a name). */
  function tileMedia(t, f) {
    const file = fileByKey.get(f.key);
    if (f.kind === 'photo' && f.canThumb) {
      let url = S.thumbs.get(f.key);
      if (!url) { url = URL.createObjectURL(file); S.thumbs.set(f.key, url); }
      t.append(el('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }));
    } else if (f.kind === 'video' && f.canPoster) {
      const img = el('img', { alt: '' }); t.append(img);
      const cached = S.thumbs.get(f.key);
      const scanId = S.scan;
      if (cached) img.src = cached;
      else posterBlob(file, 240).then((b) => {
        if (!b || scanId !== S.scan) return; // finished after Start over / a new selection: not for this screen
        const u = URL.createObjectURL(b); S.thumbs.set(f.key, u); img.src = u;
      });
    } else {
      t.append(el('span', { class: 'placeholder', text: f.kind === 'video' ? 'Video' : C.baseName(f.relativePath) }));
    }
    if (f.kind === 'video') t.append(el('span', { class: 'badge', text: `▶ ${Math.round(f.durationSeconds)}s · ${C.formatBytes(f.size)}` }));
    t.append(el('span', { class: 'name', text: C.baseName(f.relativePath) }));
  }

  /** A photo or video, included by default, with Remove / Put back. */
  function tile(f) {
    const off = S.state.excluded.has(f.key);
    const t = el('div', { class: `tile${off ? ' off' : ''}`, 'data-file': f.key, title: f.relativePath });
    tileMedia(t, f);
    if (off) t.append(el('span', { class: 'left-out', text: 'Left out' }));
    const redraw = () => (S.mode === 'create' ? viewReviewCreate() : viewReviewFiles());
    t.append(el('button', { type: 'button', class: 'tile-x', 'data-remove': f.key, 'aria-pressed': off ? 'true' : 'false',
      'aria-label': `Leave out ${f.relativePath}`, text: off ? 'Put back' : 'Remove',
      onclick: () => { S.state = C.edits.exclude(S.state, [f.key], !S.state.excluded.has(f.key)); redraw(); } }));
    return t;
  }

  /** While organizing: a tile is selected or not. */
  function pickTile(f) {
    const off = S.state.excluded.has(f.key);
    const on = S.selected.has(f.key);
    const t = el('button', { type: 'button', class: `tile pick${on ? ' on' : ''}${off ? ' off' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'data-file': f.key,
      title: f.relativePath, 'aria-label': `Select ${f.relativePath}${off ? ', left out' : ''}`,
      onclick: () => { if (S.selected.has(f.key)) S.selected.delete(f.key); else S.selected.add(f.key); viewReviewCreate(); } });
    tileMedia(t, f);
    t.append(el('span', { class: 'check', 'aria-hidden': 'true' }));
    return t;
  }

  // ------------------------------------------------------------------ 6b. review: Add to Existing Memory / Bulk Upload for Later
  function viewReviewFiles(fresh) {
    const st = S.state;
    const sum = C.summary(st);
    const over = isOver(sum);
    const n = sum.photos + sum.videos;
    const existing = S.mode === 'existing';
    const top = card(
      el('div', { class: 'row' }, el('h2', { text: existing ? `Add to ${quoted(S.target.title)}` : `Upload ${plural(n, 'file')} for later` }), startOver()),
      crumbs(),
      existing ? targetLine() : null,
      el('p', { class: 'lead', text: existing
        ? 'These photos and videos will be added to this memory. Its title, date and story stay as they are. Everything is included; choose Remove on anything you don\'t want.'
        : `These files will wait in ${S.profile.name}'s Add Past Memories in the DayCasion app. They won't become memories until you organize them there. Everything is included; choose Remove on anything you don't want.` }),
      S.skipped.length ? skippedList(S.skipped) : null);
    const sections = st.groups.map((g) => {
      const grid = el('div', { class: 'grid' });
      const shown = g.showAll ? g.items : g.items.slice(0, 60);
      for (const k of shown) grid.append(tile(st.items[k]));
      const inc = g.items.filter((k) => !st.excluded.has(k));
      const ph = inc.filter((k) => st.items[k].kind === 'photo').length;
      return el('section', { class: 'group files-only', 'data-group': g.key, 'aria-label': existing ? 'Files to add' : (g.folders[0] || 'Files you chose') },
        el('div', { class: 'group-top' }, el('strong', { text: existing ? 'Files to add' : (g.folders.join(', ') || 'Files you chose') }),
          el('span', { class: 'muted small', text: counts(ph, inc.length - ph) })),
        grid,
        g.items.length > shown.length ? el('button', { class: 'link', onclick: () => { g.showAll = true; viewReviewFiles(); }, text: `Show all ${g.items.length}` }) : null);
    });
    const label = existing ? `Add ${filesWord(n)} to This Memory` : `Upload ${filesWord(n)} for Later`;
    const tooMany = !existing && n > LATER_MAX;
    const all = st.groups.flatMap((g) => g.items);
    const limitNote = !existing && all.length > LATER_MAX ? el('div', { class: 'note limit', role: 'note', id: 'later-limit' },
      el('strong', { text: `Upload up to ${LATER_MAX} photos or videos at a time.` }),
      el('p', { text: `You chose ${plural(all.length, 'file')}${n !== all.length ? ` and ${n.toLocaleString()} ${n === 1 ? 'is' : 'are'} included` : ''}. Choose which ${LATER_MAX} to upload now: use Remove and Put back on each file, or the buttons below. You can upload the rest in another batch. For larger collections, try Bulk Import Memories to organize photos before uploading.` }),
      el('div', { class: 'actions' },
        el('button', { class: 'small', id: 'keep-first', onclick: () => { S.state = C.edits.exclude(C.edits.exclude(S.state, all, false), all.slice(LATER_MAX), true); viewReviewFiles(); }, text: `Include only the first ${LATER_MAX}` }),
        el('button', { class: 'small secondary', id: 'leave-all', onclick: () => { S.state = C.edits.exclude(S.state, all, true); viewReviewFiles(); }, text: 'Leave all out, then choose' }))) : null;
    const waitingNote = !existing ? el('p', { class: 'small muted', 'data-waiting': '' }) : null;
    if (waitingNote) waitingCount().then((c) => { waitingNote.textContent = waitingText(c); });
    if (limitNote || waitingNote) top.append(...[waitingNote, limitNote].filter(Boolean));
    (fresh ? show : redrawInPlace)(top, ...sections,
      actionBar(`${counts(sum.photos, sum.videos)} · ${C.formatBytes(sum.bytes)}`,
        tooMany ? `Upload for Later takes up to ${LATER_MAX} at a time: leave out ${plural(n - LATER_MAX, 'more file')} to continue.`
          : over ? `This is more than your remaining storage (${C.formatBytes(Math.max(0, storageLeft()))}). Remove some files, or add storage in the app.` : null,
        el('button', { id: 'upload', disabled: !n || over || tooMany || null, onclick: existing ? confirmExisting : confirmLater, text: label })));
  }

  function skippedList(skipped, open) {
    const list = (rows) => el('ul', { class: 'files' }, rows.slice(0, 200), rows.length > 200 ? el('li', { text: `…and ${rows.length - 200} more` }) : null);
    const dups = skipped.filter((s) => s.reason === 'duplicate_in_selection');
    const rest = skipped.filter((s) => s.reason !== 'duplicate_in_selection');
    const byReason = new Map();
    for (const s of rest) { const k = s.message || C.REASONS[s.reason] || s.reason; if (!byReason.has(k)) byReason.set(k, []); byReason.get(k).push(s.relativePath); }
    return el('details', { open: open || null }, el('summary', { text: C.skippedSummary(skipped) }),
      dups.length ? el('div', {}, el('h3', { text: `Duplicates (${dups.length})` }),
        el('p', { class: 'small muted', text: 'Each is the same file as one already in this import, so it\'s imported only once.' }),
        list(dups.map((d) => el('li', { class: 'dup' }, el('span', { class: 'path', text: d.relativePath }),
          el('span', { class: 'muted', text: `same as ${d.duplicateOf || (d.message || '').replace(/^Same file as /, '')}` }))))) : null,
      [...byReason].map(([why, paths]) => el('div', {}, el('h3', { text: `${why} (${paths.length})` }),
        list(paths.map((p) => el('li', {}, el('span', { class: 'path', text: p })))))));
  }

  // ------------------------------------------------------------------ 7. confirm
  async function confirmCreate() {
    const st = S.state;
    // A date the member started changing but didn't finish (e.g. Exact date without the day) is finished first.
    const unfinished = st.groups.filter((g) => g.chosenPrecision && g.items.some((k) => !st.excluded.has(k)));
    if (unfinished.length) {
      const go = await ask(unfinished.length === 1 ? 'One date isn\'t finished' : `${unfinished.length} dates aren't finished`,
        `${unfinished.map((g) => quoted(g.title)).slice(0, 5).join(', ')}${unfinished.length > 5 ? '…' : ''}: the date you started choosing is missing a part. Finish it, or choose a less precise date.`, 'Show me');
      if (go) {
        const sec = [...$app.querySelectorAll('section.group')].find((x) => x.getAttribute('data-group') === unfinished[0].key);
        if (sec) { sec.scrollIntoView({ block: 'center' }); const p = sec.querySelector('select[aria-label="How precise is the date"]'); if (p) p.focus({ preventScroll: true }); }
      }
      return;
    }
    const sum = C.summary(st);
    const ok = await ask(`Create ${plural(sum.groups, 'memory', 'memories')} for ${S.profile.name}?`,
      [`${countsAnd(sum.photos, sum.videos)} (${C.formatBytes(sum.bytes)}) will be uploaded, and each group becomes a saved memory in ${S.profile.name}'s Life Timeline with the title and date shown here.`,
        'You won\'t need to save them again in the app. Keep this page open until it finishes.'],
      `Create ${memoriesWord(sum.groups)}`);
    if (ok) startRun();
  }
  async function confirmExisting() {
    const sum = C.summary(S.state);
    const ok = await ask(`Add to ${quoted(S.target.title)}?`,
      [`${countsAnd(sum.photos, sum.videos)} (${C.formatBytes(sum.bytes)}) will be added to this memory of ${S.profile.name}'s.`, 'Its title, date and story stay as they are. No new memory is created.'],
      `Add ${filesWord(sum.photos + sum.videos)}`);
    if (ok) startRun();
  }
  async function confirmLater() {
    const sum = C.summary(S.state);
    if (sum.photos + sum.videos > LATER_MAX) return;
    const ok = await ask(`Upload ${plural(sum.photos + sum.videos, 'file')} for later?`,
      [`${countsAnd(sum.photos, sum.videos)} (${C.formatBytes(sum.bytes)}) will wait in ${S.profile.name}'s Add Past Memories in the DayCasion app.`, 'They won\'t become memories until you organize them there. Your files stay on this computer.'],
      `Upload ${filesWord(sum.photos + sum.videos)}`);
    if (ok) startRun();
  }

  // ------------------------------------------------------------------ 8. run: upload, then create or add
  /** The folders the member chose (for the import's name), e.g. "Audrey Photos". */
  function topFolders() {
    const tops = new Set(S.files.filter((f) => f.relativePath.includes('/')).map((f) => f.relativePath.split('/')[0]));
    return [...tops].slice(0, 3).join(', ').slice(0, 255);
  }

  async function startRun() {
    const view = runView();
    const started = await rpc('dc_import_start', { p_profile_id: S.profile.id, p_source_name: topFolders(), p_purpose: S.mode });
    if (!started.ok) return view.fail(errText(started, "We couldn't start the import. Please try again."));
    S.batch = started.data.batch_id;
    rememberRun(S.batch, { mode: S.mode, memoryId: S.target ? S.target.id : null, title: S.target ? S.target.title : null,
      descriptions: S.mode === 'create' ? descriptionsOf(S.state) : undefined });
    for (const call of C.toPayload(S.state)) {
      const r = await rpc('dc_import_add_items', { p_batch_id: S.batch, p_groups: call });
      if (!r.ok) return view.fail(errText(r, "We couldn't prepare the upload. Please try again."), true);
      for (const res of r.data) {
        if (res.result !== 'duplicate' && res.result !== 'rejected') continue;
        const f = S.state.items[res.key];
        S.skipped.push({ relativePath: f.relativePath, reason: res.reason, kind: f.kind,
          message: res.duplicate_of ? `${C.REASONS[res.reason] || res.reason} (${res.duplicate_of})` : C.REASONS[res.reason] });
      }
    }
    runBatch(view, S.files);
  }

  /** The descriptions written on the review screen, by proposed memory (only the ones filled in). */
  function descriptionsOf(state) {
    const out = {};
    for (const g of (state && state.groups) || []) { const d = String(g.description || '').trim(); if (d) out[g.key] = d; }
    return out;
  }

  function startResume(batch, profile) {
    clearSelection();
    S.profile = profile; S.resume = { batch };
    const info = runs()[batch.id] || {};
    // What the import is for, as DayCasion recorded it (Sort My Photos by Date finishes like a folder import: its
    // memory is saved with the reviewed title and date).
    S.mode = batch.purpose === 'organize' ? 'create' : (batch.purpose || info.mode || null);
    S.target = info.memoryId ? { id: info.memoryId, title: info.title || 'your memory' } : null;
    authed(`/rest/v1/import_items?select=id&batch_id=eq.${batch.id}&status=eq.pending`, { headers: { Prefer: 'count=exact', Range: '0-0' } }).then(countOf)
      .then((pending) => { if (pending) viewChoose(); else resumeRun([]); }).catch(() => {});
  }

  async function resumeRun(files) {
    S.batch = S.resume.batch.id;
    if (!S.mode) { // started before imports recorded what they were for, and not on this browser
      // Upload for Later holds at most 50 files: a larger import can only become memories.
      const all = await authed(`/rest/v1/import_items?select=id&batch_id=eq.${S.batch}`, { headers: { Prefer: 'count=exact', Range: '0-0' } }).then(countOf).catch(() => 0);
      const options = [{ label: 'Create memories from them now', value: 'create' }];
      if (all <= LATER_MAX) options.push({ label: 'Leave them for later', value: 'later', secondary: true });
      const m = await choose({ title: 'What should happen to these files?', body: all > LATER_MAX
        ? `This import was started earlier. It has ${plural(all, 'file')}, more than Upload for Later's ${LATER_MAX}, so it is finished by creating memories.`
        : 'This import was started earlier. Choose how to finish it.', options });
      if (!m) return viewProfiles();
      S.mode = m; rememberRun(S.batch, { mode: m });
    }
    runBatch(runView(), files);
  }

  /** The progress screen, shared by the three paths. */
  function runView() {
    const head = el('h2', { text: { create: 'Creating your memories', existing: 'Adding to your memory', later: 'Uploading for later' }[S.mode] || 'Uploading to DayCasion' });
    const line = el('p', { class: 'progress-line', text: 'Preparing…' });
    const bar = el('div', {});
    const list = el('ul', { class: S.mode === 'create' ? 'jobs' : 'files', 'aria-label': S.mode === 'create' ? 'Memories' : 'Files' });
    const msg = el('p', { class: 'err', role: 'alert' });
    const actions = el('div', { class: 'actions' });
    const leave = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', leave);
    S.leave = leave;
    show(card(head, line, el('div', { class: 'progress' }, bar),
      el('p', { class: 'small muted', text: 'Keep this page open until it finishes. If it stops, you can continue later: your files stay on your computer, and nothing is created twice.' }),
      msg, actions, list));
    return { head, line, bar, list, msg, actions, leave,
      fail(text, canCancel) { msg.textContent = text; window.removeEventListener('beforeunload', leave);
        actions.replaceChildren(el('button', { onclick: viewProfiles, text: 'Back' }), canCancel && S.batch ? el('button', { class: 'secondary', onclick: () => cancelBatch(S.batch, viewProfiles), text: 'Cancel import' }) : null); } };
  }

  /** Loads the import's proposed memories and files from DayCasion (the reviewed titles and dates were stored with them). */
  async function loadBatch(id) {
    const g = await authed(`/rest/v1/import_groups?select=id,client_key,title,occurred_on,date_precision,memory_id,status,target,sort_order&batch_id=eq.${id}&order=sort_order,created_at`);
    if (!g.ok) return null;
    const items = [];
    for (let from = 0; ; from += 1000) {
      const r = await authed(`/rest/v1/import_items?select=id,group_id,kind,status,relative_path,size_bytes,content_hash,mime_type,storage_path,display_path,poster_path,sort_order&batch_id=eq.${id}&order=sort_order,id`,
        { headers: { Range: `${from}-${from + 999}` } });
      if (!r.ok) return null;
      items.push(...r.data); if (r.data.length < 1000) break;
    }
    return { groups: g.data, items };
  }

  async function runBatch(view, files) {
    const data = await loadBatch(S.batch).catch(() => null);
    if (!data) return view.fail("We couldn't load this import. Please try again.", true);
    const byPath = new Map(files.map((f) => [f.relativePath, f]));
    // Descriptions: from this visit's review screen, or remembered for Continue it (this browser).
    const descriptions = S.mode === 'create' ? (S.state ? descriptionsOf(S.state) : ((runs()[S.batch] || {}).descriptions || {})) : {};
    const jobs = data.groups.map((g) => ({ id: g.id, key: g.client_key, title: g.title, description: descriptions[g.client_key] || '', date: g.occurred_on, precision: g.date_precision,
      memoryId: g.memory_id, target: g.target, items: [], state: g.status === 'saved' ? 'done' : 'waiting', error: null }));
    const jobOf = new Map(jobs.map((j) => [j.id, j]));
    const tasks = [];
    for (const it of data.items) {
      const job = jobOf.get(it.group_id); if (!job) continue;
      const f = byPath.get(it.relative_path);
      const t = { id: it.id, job, kind: it.kind, size: it.size_bytes, mime: it.mime_type, rel: it.relative_path, tries: 0, pct: 0,
        f: f ? { ...f, mime: it.mime_type } : { relativePath: it.relative_path, size: it.size_bytes, kind: it.kind },
        res: { item_id: it.id, storage_path: it.storage_path, display_path: it.display_path, poster_path: it.poster_path },
        state: it.status === 'organized' ? 'added' : it.status === 'ready' ? 'uploaded' : 'queued' };
      if (t.state === 'queued' && !(f && f.size === it.size_bytes && f.hash === it.content_hash)) { t.state = 'missing'; t.error = 'Not in the folder you chose'; }
      job.items.push(t); tasks.push(t);
    }
    S.run = { view, jobs: jobs.filter((j) => j.items.length || j.state === 'done'), tasks, stopped: false, saving: Promise.resolve(),
      memoryTitle: S.target ? S.target.title : null };
    runQueue(S.run);
  }

  function runQueue(R) {
    // One run at a time: a second start (e.g. Try again clicked twice) would see nothing left to upload and finish the
    // import, with a short summary, while the first run was still saving memories.
    if (R.running) return;
    R.running = true;
    const { view, jobs, tasks } = R;
    const saves = S.mode !== 'later';
    const rows = new Map();
    let paintTimer = null;
    const paint = () => { if (!paintTimer) paintTimer = setTimeout(() => { paintTimer = null; paintNow(); }, 200); };
    const total = tasks.reduce((n, t) => n + t.size, 0) || 1;
    const paintNow = () => {
      const up = tasks.filter((t) => t.state === 'uploaded' || t.state === 'added').length;
      const sent = tasks.reduce((n, t) => n + (t.state === 'uploaded' || t.state === 'added' ? t.size : t.state === 'uploading' ? t.size * (t.pct || 0) / 100 : 0), 0);
      const wanted = tasks.filter((t) => t.state !== 'rejected' && t.state !== 'missing').length;
      const failed = tasks.filter((t) => t.state === 'failed').length;
      if (S.mode === 'create') {
        const made = jobs.filter((j) => j.state === 'done').length;
        view.line.textContent = `${made.toLocaleString()} of ${plural(jobs.length, 'memory', 'memories')} created · ${up.toLocaleString()} of ${plural(wanted, 'file')} uploaded`;
      } else if (S.mode === 'existing') {
        const added = tasks.filter((t) => t.state === 'added').length;
        view.line.textContent = up < wanted ? `${up.toLocaleString()} of ${plural(wanted, 'file')} uploaded` : `${added.toLocaleString()} of ${plural(wanted, 'file')} added to ${quoted(R.memoryTitle || 'your memory')}`;
      } else {
        view.line.textContent = `${up.toLocaleString()} of ${wanted.toLocaleString()} files uploaded${failed ? ` · ${failed} need another try` : ''}`;
      }
      view.bar.style.width = `${Math.min(100, Math.round((100 * sent) / total))}%`;
      if (S.mode === 'create') {
        for (const j of jobs) {
          let li = rows.get(j);
          if (!li) { li = el('li', {}, el('span', { class: 'path' }, el('strong', { text: j.title }), ' ', el('span', { class: 'muted', text: C.dateLabel(j.date, j.precision) })), el('span', { class: 'st' })); rows.set(j, li); view.list.append(li); }
          const n = j.items.filter((t) => t.state !== 'rejected' && t.state !== 'missing').length;
          const u = j.items.filter((t) => t.state === 'uploaded' || t.state === 'added').length;
          const busy = j.items.some((t) => t.state === 'uploading');
          const st = li.lastChild;
          st.textContent = j.state === 'done' ? 'Created ✓' : j.state === 'saving' ? 'Saving…' : j.state === 'failed' ? (j.error || 'Didn\'t finish')
            : j.state === 'empty' ? 'Nothing new to add' : busy || u ? `Uploading ${u} of ${n}` : 'Waiting';
          st.className = `st ${j.state === 'failed' ? 'err' : j.state === 'done' ? 'ok' : ''}`;
        }
        return;
      }
      for (const t of tasks) {
        if (t.state === 'queued' || ((t.state === 'uploaded' || t.state === 'added') && !rows.has(t))) continue;
        let li = rows.get(t);
        if (!li) { li = el('li', {}, el('span', { class: 'path', text: t.rel }), el('span', { class: 'st' })); rows.set(t, li); view.list.prepend(li); }
        li.lastChild.textContent = t.state === 'uploading' ? `${t.pct}%` : t.state === 'uploaded' ? 'Uploaded' : t.state === 'added' ? 'Added' : (t.error || 'Failed');
        li.lastChild.className = `st ${t.state === 'failed' || t.state === 'rejected' || t.state === 'missing' ? 'err' : t.state === 'uploading' ? '' : 'ok'}`;
      }
      while (view.list.children.length > 300) { const last = view.list.lastChild; for (const [k, v] of rows) if (v === last) rows.delete(k); last.remove(); }
    };
    view.msg.textContent = '';
    view.actions.replaceChildren(el('button', { class: 'secondary', onclick: () => stopRun(R), text: S.mode === 'create' ? 'Stop' : 'Cancel import' }));

    // A memory is saved as soon as all of its files are uploaded (one at a time, in order).
    const settle = (j) => {
      if (!saves || j.state === 'done' || j.state === 'saving') return;
      if (j.items.some((t) => t.state === 'queued' || t.state === 'uploading')) return;
      if (j.items.some((t) => t.state === 'failed')) {
        const bad = j.items.filter((t) => t.state === 'failed');
        const why = [...new Set(bad.map((t) => t.error).filter(Boolean))];
        j.state = 'failed'; j.error = `${plural(bad.length, 'file')} didn't upload${why.length === 1 ? `: ${why[0]}` : ''}`; return;
      }
      j.state = 'saving'; paint();
      R.saving = R.saving.then(() => saveJob(R, j)).then(paint);
    };
    const worker = async () => {
      for (;;) {
        if (R.stopped) return;
        const t = tasks.find((x) => x.state === 'queued');
        if (!t) return;
        t.state = 'uploading'; paint();
        try { await uploadOne(t, () => paint()); t.state = 'uploaded'; }
        catch (e) {
          t.tries++;
          if (e && e.message === 'signed-out') { R.stopped = true; return; }
          if (e && e.message === 'rejected') { t.state = 'rejected'; t.error = e.userMessage; S.skipped.push({ relativePath: t.rel, reason: e.reason, kind: t.kind, message: e.userMessage }); }
          else if (t.tries < 4 && !(e && e.permanent)) { t.state = 'queued'; await wait([1000, 3000, 8000][t.tries - 1] || 8000); }
          else { t.state = 'failed'; t.error = (e && e.userMessage) || 'Upload failed'; }
        }
        settle(t.job);
        paint();
      }
    };
    paintNow();
    for (const j of jobs) if (j.state === 'failed' || j.state === 'waiting') { j.state = 'waiting'; j.error = null; settle(j); } // already uploaded (a retry or a resumed import)
    Promise.all(Array.from({ length: UPLOADS_AT_ONCE }, worker)).then(() => R.saving).then(async () => {
      R.running = false;
      paintNow();
      if (R.stopped) return;
      const failedFiles = tasks.filter((t) => t.state === 'failed');
      const failedJobs = jobs.filter((j) => j.state === 'failed');
      if (S.mode === 'later' && failedFiles.length) {
        view.head.textContent = 'Almost done';
        view.msg.textContent = `${plural(failedFiles.length, 'file')} didn't upload. The reason is shown next to each file; for a connection problem, try again.`;
        window.removeEventListener('beforeunload', view.leave);
        view.actions.replaceChildren(
          el('button', { onclick: () => retry(R), text: `Try again (${failedFiles.length})` }),
          el('button', { class: 'secondary', onclick: () => finishRun(R), text: 'Finish without them' }),
          el('button', { class: 'link', onclick: () => stopRun(R), text: 'Cancel import' }));
        return;
      }
      if (failedJobs.length) return viewPartial(R, failedJobs);
      finishRun(R);
    });
  }

  function retry(R) {
    if (R.running) return;
    // From the "didn't finish" screen: show the progress screen again, so the member sees the retry working.
    if (!document.body.contains(R.view.head)) R.view = runView();
    for (const t of R.tasks) if (t.state === 'failed') { t.state = 'queued'; t.tries = 0; t.error = null; }
    for (const j of R.jobs) if (j.state === 'failed') { j.state = 'waiting'; j.error = null; }
    window.addEventListener('beforeunload', R.view.leave);
    runQueue(R);
  }

  const storagePath = (memoryId, t) => `${session.user.id}/${memoryId}/${t.id}.${EXT[t.mime]}`;
  const displayPath = (memoryId, t) => `${session.user.id}/${memoryId}/${t.id}_display.jpg`;

  /** Saves one proposed memory with the app's own server steps:
   *  Create: dc_import_begin_save creates the memory exactly once (never again on a retry: a memory already started
   *  is only continued, so a story added in the app meanwhile is never overwritten).
   *  Existing: dc_import_begin_add_to_memory checks the memory (this member's, this profile's, writable).
   *  Then each file is moved into the memory and attached (dc_import_attach_item: plan, video and storage checks;
   *  attaching twice is impossible), and dc_import_finish_group closes the proposed memory. */
  async function saveJob(R, j) {
    if (R.stopped) { j.state = 'waiting'; return; }
    const ready = j.items.filter((t) => t.state === 'uploaded');
    const kept = j.items.filter((t) => t.state === 'uploaded' || t.state === 'added');
    if (!kept.length) { j.state = 'empty'; return; }
    try {
      let memoryId = j.memoryId;
      let base = 0;
      if (S.mode === 'existing') {
        const target = (S.target && S.target.id) || j.memoryId;
        const r = await rpc('dc_import_begin_add_to_memory', { p_group_id: j.id, p_memory_id: target, p_item_ids: kept.map((t) => t.id) });
        if (!r.ok) throw Object.assign(new Error('begin'), { userMessage: plainErr(r, "We couldn't add to this memory. Please try again.") });
        memoryId = r.data.memory_id; base = +r.data.base_sort_order || 0;
        if (r.data.title) R.memoryTitle = r.data.title;
      } else {
        if (!memoryId) { // an earlier try may have created it even though its answer never arrived
          const g = await authed(`/rest/v1/import_groups?select=memory_id&id=eq.${j.id}`);
          memoryId = g.ok && g.data && g.data[0] ? g.data[0].memory_id : null;
        }
        if (!memoryId) {
          const r = await rpc('dc_import_begin_save', { p_group_id: j.id, p_title: j.title, p_body: j.description || '', p_occurred_on: j.precision === 'unknown' ? null : j.date,
            p_date_precision: j.precision, p_item_ids: kept.map((t) => t.id) });
          if (!r.ok) throw Object.assign(new Error('begin'), { userMessage: plainErr(r, "We couldn't create this memory. Please try again.") });
          memoryId = r.data.memory_id;
        }
      }
      j.memoryId = memoryId;
      let problem = null;
      for (const t of ready) { // finished even when Stop is chosen meanwhile, so no memory is left without its files
        const sort = S.mode === 'existing' ? base + ready.indexOf(t) : j.items.indexOf(t);
        for (let attempt = 1; ; attempt++) {
          // Moving twice is harmless: the second move finds nothing to move, and attaching checks the file is in place.
          await authed('/storage/v1/object/move', { method: 'POST', body: { bucketId: 'memory-media', sourceKey: t.res.storage_path, destinationKey: storagePath(memoryId, t) } });
          if (t.res.display_path) await authed('/storage/v1/object/move', { method: 'POST', body: { bucketId: 'memory-media', sourceKey: t.res.display_path, destinationKey: displayPath(memoryId, t) } });
          const a = await rpc('dc_import_attach_item', { p_item_id: t.id, p_sort_order: sort });
          if (a.ok) { t.state = 'added'; break; }
          if ((a.offline || a.status >= 500) && attempt < 3) { await wait(1000 * attempt); continue; }
          problem = problem || plainErr(a, 'A file couldn\'t be added. Check your connection.');
          break;
        }
      }
      const fin = await rpc('dc_import_finish_group', { p_group_id: j.id });
      if (problem || !fin.ok || (fin.data && fin.data.remaining > 0 && j.items.some((t) => t.state === 'uploaded'))) {
        j.state = 'failed'; j.error = problem || 'Not finished. Please try again.';
        return;
      }
      j.state = 'done';
    } catch (e) {
      if (e && e.message === 'signed-out') { R.stopped = true; return; }
      j.state = 'failed'; j.error = (e && e.userMessage) || 'Not finished. Please try again.';
    }
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function uploadOne(t, onProgress) {
    const file = t.f.key ? fileByKey.get(t.f.key) : null;
    if (!file) throw Object.assign(new Error('missing'), { permanent: true, userMessage: 'The file is no longer available on this computer' });
    await stageFile(file, t.f.mime, t.res, (pct) => { t.pct = pct; onProgress(); });
  }

  /** Stores one staged import file and confirms it with DayCasion (dc_import_finalize_item: size, type, plan, video and
   *  storage are checked there). res: { item_id, storage_path, display_path, poster_path } from dc_import_add_items.
   *  With res.copy_from (an intentional reuse), the photo is copied inside DayCasion's storage from the member's own
   *  memory file instead of being uploaded again; if that copy can't be made, the file on this computer is uploaded. */
  async function stageFile(file, mime, res, onPct) {
    let copied = false;
    if (res.copy_from) {
      const c = await authed('/storage/v1/object/copy', { method: 'POST', body: { bucketId: 'memory-media', sourceKey: res.copy_from, destinationKey: res.storage_path } });
      copied = c.ok || /already exists|Duplicate/i.test(JSON.stringify(c.data || ''));
      if (copied && res.display_path && res.copy_display_from) {
        await authed('/storage/v1/object/copy', { method: 'POST', body: { bucketId: 'memory-media', sourceKey: res.copy_display_from, destinationKey: res.display_path } }).catch(() => null);
      }
      if (copied && onPct) onPct(100);
    }
    if (!copied) {
      if (!file) throw Object.assign(new Error('missing'), { permanent: true, userMessage: 'The file is no longer available on this computer' });
      // Optional preview copies first (small); a failure there never stops the photo itself.
      if (res.display_path) { try { const b = await displayBlob(file); if (b) await putObject(res.display_path, b, 'image/jpeg'); } catch (e) { /* optional */ } }
      if (res.poster_path) { try { const b = await posterBlob(file, 480); if (b) await putObject(res.poster_path, b, 'image/jpeg'); } catch (e) { /* optional */ } }
      await putObject(res.storage_path, file, mime, onPct);
    }
    let fin = await rpc('dc_import_finalize_item', { p_item_id: res.item_id });
    if (!fin.ok && /incomplete|did not finish/.test(errText(fin, '')) && file) {
      // A copy cut short (e.g. a connection dropped at the end): replace it once.
      await removeStored([res.storage_path]);
      await putObject(res.storage_path, file, mime, onPct);
      fin = await rpc('dc_import_finalize_item', { p_item_id: res.item_id });
    }
    if (!fin.ok) throw Object.assign(new Error('finalize'), { userMessage: errText(fin, 'Upload not confirmed'), permanent: fin.status === 400 && /match|incomplete/.test(errText(fin, '')) });
    if (fin.data && fin.data.status === 'rejected') {
      // DayCasion can't keep it now (storage full, plan or video plan ended): its copy is removed straight away.
      await removeStored([res.storage_path, res.display_path, res.poster_path].filter(Boolean));
      throw Object.assign(new Error('rejected'), { permanent: true, reason: fin.data.reason, userMessage: C.REASONS[fin.data.reason] || 'Not kept' });
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
          // Storage answers a size refusal as HTTP 400 with statusCode "413" (e.g. the project's upload size setting):
          // it is explained, and not repeated automatically (Try again repeats it once the setting allows it).
          let info = {}; try { info = JSON.parse(body) || {}; } catch (e) { /* not JSON */ }
          const tooBig = xhr.status === 413 || String(info.statusCode) === '413' || /maximum allowed size|payload too large/i.test(body);
          reject(Object.assign(new Error('upload'), { userMessage: tooBig ? 'too large for DayCasion\'s storage right now' : `Upload failed (${xhr.status})`,
            permanent: tooBig || xhr.status === 415 }));
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

  /** Stops a run. Memories already created stay; everything else of this import is removed from DayCasion (the
   *  memory being saved at that moment is finished first, so no memory is left without its files). */
  async function stopRun(R) {
    const ok = await ask(S.mode === 'create' ? 'Stop creating memories?' : 'Cancel this import?',
      S.mode === 'create' ? 'Memories already created stay in DayCasion. Photos and videos for the others are removed from DayCasion. Your files on this computer are not touched.'
        : 'Files already uploaded are removed from DayCasion. Your files on this computer are not touched.',
      S.mode === 'create' ? 'Stop' : 'Cancel the import');
    if (!ok) return;
    R.stopped = true;
    for (const xhr of [...S.active]) xhr.abort();
    R.view.line.textContent = 'Stopping…';
    await R.saving;
    cancelBatch(S.batch, viewProfiles);
  }

  /** Some memories didn't finish: the rest are done; these can be tried again (nothing is created twice). */
  function viewPartial(R, failedJobs) {
    window.removeEventListener('beforeunload', R.view.leave);
    const made = R.jobs.filter((j) => j.state === 'done');
    if (S.mode === 'existing') {
      return show(card(el('h2', { text: `Not everything was added to ${quoted(R.memoryTitle || 'your memory')}` }),
        el('p', { class: 'err', text: failedJobs[0].error || 'Some files weren\'t added.' }),
        el('p', { text: 'The files that weren\'t added yet are safe in DayCasion. Try again to finish; nothing is added twice.' }),
        el('div', { class: 'actions' }, el('button', { onclick: () => retry(R), text: 'Try again' }), el('button', { class: 'secondary', onclick: viewProfiles, text: 'Finish later' }))));
    }
    show(card(el('h2', { text: `${made.length.toLocaleString()} of ${memoriesWord(R.jobs.length)} Created` }),
      el('p', { class: 'err', text: `${plural(failedJobs.length, 'memory', 'memories')} didn't finish. ${failedJobs.length === 1 ? 'Its' : 'Their'} photos and videos are safe. Try again to finish ${failedJobs.length === 1 ? 'it' : 'them'}; memories already created won't be created twice.` }),
      el('ul', { class: 'jobs' }, failedJobs.map((j) => el('li', {}, el('span', { class: 'path' }, el('strong', { text: j.title }), ' ', el('span', { class: 'muted', text: C.dateLabel(j.date, j.precision) })),
        el('span', { class: 'st err', text: j.error || 'Didn\'t finish' })))),
      made.length ? el('p', { class: 'small muted', text: `The ${plural(made.length, 'memory', 'memories')} already created ${made.length === 1 ? 'is' : 'are'} saved in ${S.profile.name}'s Life Timeline.` }) : null,
      el('div', { class: 'actions' },
        el('button', { id: 'retry', onclick: () => retry(R), text: `Try again (${failedJobs.length})` }),
        el('button', { class: 'secondary', onclick: viewProfiles, text: 'Finish later' })),
      el('p', { class: 'small muted', text: `To finish later, come back here, choose ${S.profile.name} and Continue it.` }),
      S.skipped.length ? skippedList(S.skipped) : null));
  }

  /** What this import actually saved, from DayCasion: every file in a memory (this visit, an earlier try or a
   *  Continue it), by kind, and the proposed memories they are in. Null when it can't be read. */
  async function savedFromServer(batchId) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const r = await authed(`/rest/v1/import_items?select=kind,group_id&batch_id=eq.${batchId}&status=eq.organized&order=id`, { headers: { Range: `${from}-${from + 999}` } }).catch(() => null);
      if (!r || !r.ok || !Array.isArray(r.data)) return null;
      rows.push(...r.data); if (r.data.length < 1000) break;
    }
    const photos = rows.filter((x) => x.kind === 'photo').length;
    return { photos, videos: rows.length - photos, files: rows.length, groups: new Set(rows.map((x) => x.group_id)) };
  }

  async function finishRun(R) {
    if (R.running) return; // still saving: the summary comes when everything is done
    const r = await rpc('dc_import_finish', { p_batch_id: S.batch });
    window.removeEventListener('beforeunload', R.view.leave);
    if (!r.ok) {
      R.view.msg.textContent = errText(r, "We couldn't finish the import. Please try again.");
      R.view.actions.replaceChildren(el('button', { onclick: () => finishRun(R), text: 'Try again' }));
      return;
    }
    forgetRun(S.batch);
    const added = R.tasks.filter((t) => t.state === 'added');
    // The totals are what DayCasion holds for this import (falls back to this page's own record).
    const saved = await savedFromServer(S.batch) || { photos: added.filter((t) => t.kind === 'photo').length,
      videos: added.filter((t) => t.kind === 'video').length, files: added.length, groups: new Set(added.map((t) => t.job.id)) };
    const photos = saved.photos;
    const again = el('div', { class: 'actions' },
      el('button', { onclick: () => { clearSelection(); viewMode(); }, text: `Import more for ${S.profile.name}` }),
      el('button', { class: 'secondary', onclick: viewProfiles, text: 'Choose another profile' }));
    if (S.mode === 'create') {
      const made = R.jobs.filter((j) => saved.groups.has(j.id) || j.state === 'done');
      if (!made.length) return nothingNew(again);
      return show(card(el('h2', { class: 'done', text: `${memoriesWord(made.length)} Created in DayCasion` }),
        el('p', { class: 'lead', text: `${plural(made.length, 'memory', 'memories')} with ${countsAnd(photos, saved.videos)} ${made.length === 1 ? 'is' : 'are'} saved for ${S.profile.name}.` }),
        el('div', { class: 'note' }, el('strong', { text: 'There\'s nothing more to do.' }),
          el('p', { text: `${made.length === 1 ? 'It\'s' : 'They\'re'} already saved. Open DayCasion and go to ${S.profile.name}'s Life Timeline to see ${made.length === 1 ? 'it' : 'them'}. You can edit a title, date or story there whenever you like.` })),
        el('details', {}, el('summary', { text: `The ${plural(made.length, 'memory', 'memories')} created` }),
          el('ul', { class: 'jobs' }, made.map((j) => el('li', {}, el('span', { class: 'path' }, el('strong', { text: j.title }), ' ', el('span', { class: 'muted', text: C.dateLabel(j.date, j.precision) })),
            el('span', { class: 'st ok', text: counts(j.items.filter((t) => t.state === 'added' && t.kind === 'photo').length, j.items.filter((t) => t.state === 'added' && t.kind === 'video').length) }))))),
        S.skipped.length ? skippedList(S.skipped) : null, again));
    }
    if (S.mode === 'existing') {
      if (!saved.files) return nothingNew(again);
      const title = R.memoryTitle || (S.target && S.target.title) || 'your memory';
      return show(card(el('h2', { class: 'done', text: `${filesWord(saved.files)} Added to ${quoted(title)}` }),
        el('p', { class: 'lead', text: `${countsAnd(photos, saved.videos)} ${saved.files === 1 ? 'was' : 'were'} added to ${quoted(title)}${S.target && S.target.date !== undefined ? ` (${C.dateLabel(S.target.date, S.target.precision)})` : ''} for ${S.profile.name}.` }),
        el('div', { class: 'note' }, el('p', { text: 'Its title, date and story didn\'t change. Open the memory in DayCasion to see them.' })),
        S.skipped.length ? skippedList(S.skipped) : null, again));
    }
    const ready = r.data.ready || 0;
    if (!ready) return nothingNew(again);
    show(card(el('h2', { class: 'done', text: `${filesWord(ready)} Uploaded for Later` }),
      el('p', { class: 'lead', text: `${plural(ready, 'file')} ${ready === 1 ? 'is' : 'are'} waiting in ${S.profile.name}'s Add Past Memories. ${ready === 1 ? 'It isn\'t a memory' : 'They aren\'t memories'} yet and still need${ready === 1 ? 's' : ''} to be organized.` }),
      el('div', { class: 'note' }, el('strong', { text: 'When you\'re ready' }),
        el('ol', {}, el('li', { text: 'Open DayCasion on your phone.' }),
          el('li', { text: `Go to Import & Export Memories › Add Past Memories › choose ${S.profile.name} › From your computer.` }),
          el('li', { text: 'Tap Review & save on each group. Create a new memory, or add the files to a memory you already have.' }))),
      S.skipped.length ? skippedList(S.skipped) : null, again));
  }

  function nothingNew(again) {
    const known = new Set(['duplicate_in_selection', 'already_staged', 'already_in_a_memory']);
    const already = S.skipped.every((x) => known.has(x.reason));
    show(card(el('h2', { text: already ? 'Nothing new to import' : 'Nothing was imported' }),
      el('p', { text: already ? `These photos and videos are already in DayCasion for ${S.profile.name} (in a memory or waiting in Add Past Memories).`
        : 'None of these files could be added. The reason is listed for each one below. Your files on this computer are not touched.' }),
      S.skipped.length ? skippedList(S.skipped, true) : null, again));
  }

  async function cancelBatch(id, then) {
    for (const xhr of [...S.active]) xhr.abort(); // nothing of this import may land after it is cancelled
    S.active.clear();
    const r = await rpc('dc_import_cancel', { p_batch_id: id });
    // Stored copies are removed by DayCasion's clean-up; remove this import's folder now as well.
    if (r.ok) {
      forgetRun(id);
      const list = await authed('/storage/v1/object/list/memory-media', { method: 'POST', body: { prefix: `${session.user.id}/imports/${id}`, limit: 1000 } }).catch(() => null);
      const names = list && list.ok && Array.isArray(list.data) ? list.data.map((o) => `${session.user.id}/imports/${id}/${o.name}`) : [];
      for (let i = 0; i < names.length; i += 100) await authed('/storage/v1/object/memory-media', { method: 'DELETE', body: { prefixes: names.slice(i, i + 100) } }).catch(() => null);
    } else await ask('We couldn\'t cancel the import', errText(r, 'Please try again.'), 'OK');
    if (S.leave) window.removeEventListener('beforeunload', S.leave);
    then();
  }

  // ------------------------------------------------------------------ start
  session = loadSession();
  try { S.goEulogy = new URLSearchParams(window.location.search).get('go') === 'eulogy'; } catch (e) { S.goEulogy = false; }
  if (session && session.access_token) viewProfiles(); else viewSignIn();
  window.DcImportApp = { state: () => S }; // read-only hook for the automated tests
})();
