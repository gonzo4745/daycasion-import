/* DayCasion Desktop Import: Import My Eulogy. Two separate options, never one ambiguous upload:
 *   My Completed Eulogy (No AI): the member's finished eulogy (PDF, Word .docx or text). Kept exactly as written,
 *     never sent to AI; the Legacy Executor receives it with a copy of the original document.
 *   My Eulogy Information (AI-assisted): the completed Eulogy Preparation Guide or the member's own notes (up to 3 files).
 *     With the member's AI permission, DayCasion uses it to write the eulogy; the executor receives only the final eulogy.
 * Files go to the member's private folder (dc_my_eulogy_begin_upload -> storage -> legacy-eulogy-docs checks them).
 * Changes are possible until the Legacy process begins. No purchase is needed to prepare a eulogy; delivery still needs
 * Eulogy Only or the Complete Legacy Package. Plain DOM; all member text goes through textContent. */
(function () {
  'use strict';
  const GUIDE = [
    { file: 'guide/DayCasion-Eulogy-Preparation-Guide.docx', label: 'Word (.docx)', note: 'best for typing your answers' },
    { file: 'guide/DayCasion-Eulogy-Preparation-Guide.txt', label: 'Plain text (.txt)', note: 'opens in any text editor' },
    { file: 'guide/DayCasion-Eulogy-Preparation-Guide.pdf', label: 'Printable PDF', note: 'for planning on paper' },
  ];
  const MAX_BYTES = 10 * 1024 * 1024;
  const OPTION = {
    none: 'No eulogy',
    completed: 'My Completed Eulogy (No AI)',
    ai: 'My Eulogy Information (AI-assisted)',
  };
  const QUESTIONS = { remember: 1, people: 2, accomplishments: 3, happy_memories: 4, challenges: 5, stories: 7, values: 6, messages: 8, leave_out: 9, tone: 10 };
  let X = null; // helpers from app.js
  let info = null; // dc_my_eulogy_get()
  const h = (...a) => X.el(...a);

  window.DcEulogy = { open(ctx) { X = ctx; viewHome(); } };

  // ------------------------------------------------------------------ data
  async function load() {
    const r = await X.rpc('dc_my_eulogy_get');
    if (!r.ok) throw Object.assign(new Error('load'), { userMessage: X.plainErr(r, "We couldn't load My Eulogy. Please reload the page.") });
    info = r.data;
    return info;
  }
  const docs = (kind) => (info.documents || []).filter((d) => d.kind === kind);
  const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const fmtDate = (s) => { try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return ''; } };
  const typeName = (t) => ({ pdf: 'PDF', docx: 'Word document', txt: 'Text file' }[t] || 'Document');
  const back = (label, fn) => h('button', { class: 'link', onclick: fn, text: label });
  const heading = (title, backFn, backLabel) => h('div', { class: 'row' }, h('h2', { text: title }), back(backLabel || 'Back', backFn));
  const errorCard = (message) => X.card(h('p', { class: 'err', role: 'alert', text: message }), h('div', { class: 'actions' }, h('button', { onclick: viewHome, text: 'Try again' })));

  function statusNotes() {
    const out = [];
    if (info.locked) out.push(h('div', { class: 'note', role: 'status' }, h('strong', { text: 'Your legacy process has begun.' }),
      h('p', { class: 'small', text: 'Your eulogy can no longer be changed.' })));
    else if (!info.entitled) out.push(h('div', { class: 'note locked-note', id: 'eu-purchase', role: 'status' }, h('strong', { text: '🔒 My Eulogy is unlocked with a one-time purchase' }),
      h('p', { class: 'small', text: 'Eulogy Only or the Complete Legacy Package includes all three: My Completed Eulogy (No AI), My Eulogy Information (AI-assisted) and a Personal Video Eulogy. Buy it in the DayCasion app: Settings > Legacy Executor. Legacy Access on its own does not include a eulogy.' }),
      h('p', { class: 'small muted', text: 'Until then you can look around and download the Eulogy Preparation Guide. Uploading, saving and choosing a eulogy are unlocked after purchase.' +
        ((info.documents || []).length || info.video ? ' Anything you already uploaded is kept; you can still review or delete it.' : '') })));
    return out;
  }

  /** What the executor would receive today, in plain words, and where that setting came from. */
  function currentChoice(completed, infos) {
    const P = 'Your choice for your executor: ';
    if (info.option === 'completed') {
      return { line: `${P}${OPTION.completed}.`,
        note: completed ? 'Your executor receives your eulogy exactly as you wrote it. It is never sent to AI.'
          : 'You haven\'t uploaded your completed eulogy yet. Until you do, there is no eulogy for your executor.' };
    }
    if (info.option === 'ai') {
      const src = [];
      if (info.ai_information) src.push('your information files');
      if (info.ai_memories) src.push('your memory descriptions');
      if (info.ai_life_story) src.push('your Life Story');
      const from = src.length ? src.length === 1 ? src[0] : `${src.slice(0, -1).join(', ')} and ${src[src.length - 1]}` : null;
      if (info.legacy_setting) {
        return { line: `${P}an AI-assisted eulogy${from ? ` written from ${from}` : ''}.`,
          note: 'This is the eulogy permission you turned on in the DayCasion app. You haven\'t chosen an option on this page. ' +
            'To give DayCasion your own eulogy information, or to have your executor receive a eulogy you wrote yourself (no AI), choose an option below.' };
      }
      return { line: `${P}My Eulogy Information.`,
        note: (from ? `DayCasion will write your eulogy with AI from ${from}.` : 'DayCasion will write your eulogy with AI.') +
          (info.ai_information && !infos.length ? ' You haven\'t uploaded any information files yet.' : '') };
    }
    return { line: `${P}No eulogy`, note: 'Choose an option below to prepare one.' };
  }

  // ------------------------------------------------------------------ home: the two options
  async function viewHome() {
    X.show(X.card(h('p', { class: 'muted', text: 'Loading My Eulogy…' })));
    try { await load(); } catch (e) { if (e.message !== 'signed-out') X.show(errorCard(e.userMessage || 'Please reload the page.')); return; }
    const completed = docs('completed')[0];
    const infos = docs('information');
    const current = currentChoice(completed, infos);
    // The card for the current choice is marked. An AI setting made earlier in the app (memories and Life Story, no
    // uploads) is not this page's information option, so neither card is marked for it.
    const marked = info.legacy_setting ? null : info.option;
    const option = (id, key, icon, title, text, status, onclick) => h('button', { class: 'choice' + (marked === key ? ' selected' : ''), id, onclick,
      'aria-pressed': String(marked === key) },
      h('span', { class: 'choice-icon', 'aria-hidden': 'true', text: icon }),
      marked === key ? h('span', { class: 'choice-badge', text: 'Selected' }) : null, h('strong', { text: title }),
      h('span', { class: 'choice-text', text }), h('span', { class: 'choice-hint', text: status }));
    X.show(X.card(heading('Import My Eulogy', X.back),
      h('p', { class: 'muted small', text: (info.my_life_profile ? `For ${info.my_life_profile.name}. ` : '') +
        'Your eulogy is private. Only your Legacy Executor receives the final eulogy, through DayCasion\'s secure Legacy process.' }),
      h('p', { id: 'eu-selected', text: current.line }),
      current.note ? h('p', { class: 'small muted', id: 'eu-selected-note', text: current.note }) : null,
      ...statusNotes(),
      h('div', { class: 'choices' },
        option('eu-completed', 'completed', '✓', OPTION.completed,
          'Upload your finished eulogy. It is kept exactly as you wrote it and never sent to AI. Your executor receives it with a copy of your original document.',
          completed ? `Uploaded: ${completed.file_name}` : 'Nothing uploaded yet', () => viewCompleted()),
        option('eu-information', 'ai', '✎', OPTION.ai,
          'Download the Eulogy Preparation Guide, answer any questions you like, and upload it or your own notes. DayCasion writes your eulogy with AI. Your executor receives only the finished eulogy.',
          infos.length ? `${infos.length} information ${infos.length === 1 ? 'file' : 'files'} uploaded` : 'Nothing uploaded yet', () => viewInformation())),
      videoSummary(),
      h('p', { class: 'small muted', text: 'You can upload, review, replace or delete your files here at any time until your legacy process begins.' })));
  }

  // ------------------------------------------------------------------ My Completed Eulogy (No AI)
  /** Only a real note (text or an element) is shown; anything else, such as a click event, is ignored. */
  const noteOf = (m) => (typeof m === 'string' ? (m ? h('p', { text: m }) : null) : m instanceof Node ? m : null);

  async function viewCompleted(message) {
    try { await load(); } catch (e) { return X.show(errorCard(e.userMessage || 'Please reload the page.')); }
    const d = docs('completed')[0];
    const parts = [heading(OPTION.completed, viewHome, 'Back to My Eulogy'),
      h('p', { text: 'Your own finished eulogy, delivered word for word. DayCasion never sends it to AI and never changes it.' }),
      ...statusNotes(), noteOf(message)];
    if (d) {
      parts.push(h('div', { class: 'note target', id: 'eu-doc' }, h('strong', { text: d.file_name }),
        h('span', { class: 'small muted', text: `${typeName(d.file_type)} · ${fmtSize(d.size_bytes)} · uploaded ${fmtDate(d.ready_at)}` }),
        h('p', { class: 'small', text: d.has_text ? 'Your executor will read these words exactly as written, and can download your original document.'
          : 'We couldn\'t read text from this document (for example, a scanned page). That\'s fine: your executor will receive the document itself.' })));
      const acts = [d.has_text ? h('button', { class: 'secondary', onclick: () => viewText(d, viewCompleted), text: 'Review the text' }) : null,
        h('button', { class: 'secondary', onclick: () => openOriginal(d), text: 'Open my file' })];
      if (canPrepare()) acts.push(pickButton('Replace', 'completed', d.id));
      if (!info.locked) acts.push(h('button', { class: 'secondary', onclick: () => remove(d, viewCompleted), text: 'Delete' }));
      parts.push(h('div', { class: 'actions' }, acts));
      if (canPrepare() && info.option !== 'completed') {
        parts.push(h('div', { class: 'note' }, h('strong', { text: 'Use this as your eulogy?' }),
          h('p', { class: 'small', text: info.option === 'ai'
            ? 'You currently have My Eulogy Information (AI-assisted) selected. Choosing your completed eulogy means AI won\'t write one, and your AI permission is withdrawn.'
            : 'Your executor receives your completed eulogy only once you choose it.' }),
          h('div', { class: 'actions' }, h('button', { id: 'eu-use-completed', onclick: () => setOption('completed', null, viewCompleted), text: 'Use My Completed Eulogy' }))));
      } else if (info.option === 'completed') {
        parts.push(h('p', { class: 'small', text: '✓ Selected: your executor will receive this eulogy.' }));
      }
    } else if (canPrepare()) {
      parts.push(uploadArea('completed', null, 'Choose your eulogy file'));
    } else if (!info.locked) {
      parts.push(h('p', { class: 'muted', text: 'Uploading is unlocked with Eulogy Only or the Complete Legacy Package.' }));
    } else parts.push(h('p', { class: 'muted', text: 'No completed eulogy was uploaded.' }));
    X.show(X.card(...parts));
  }

  // ------------------------------------------------------------------ My Eulogy Information (AI-assisted)
  async function viewInformation(message) {
    try { await load(); } catch (e) { return X.show(errorCard(e.userMessage || 'Please reload the page.')); }
    const list = docs('information');
    const max = (info.limits && info.limits.max_information_documents) || 3;
    const guide = h('div', { class: 'note', id: 'eu-guide' }, h('strong', { text: 'Eulogy Preparation Guide' }),
      h('p', { class: 'small', text: 'Ten optional questions, plus room for anything else you want included. Answer as many or as few as you like, in your own words, with no length limit. Type your answers on your computer, save, and upload the file here.' }),
      h('div', { class: 'actions' }, GUIDE.map((g) => h('a', { class: 'btn secondary', href: g.file, download: g.file.split('/').pop(), title: g.note, text: `Download: ${g.label}` }))));
    const parts = [heading(OPTION.ai, viewHome, 'Back to My Eulogy'),
      h('p', { text: 'Tell DayCasion what you want said about your life. With your permission, DayCasion uses AI to write your eulogy from what you upload, and never invents details. Your executor receives only the finished eulogy, never your guide, answers or notes.' }),
      ...statusNotes(), noteOf(message), guide];
    if (list.length) {
      const ul = h('ul', { class: 'eu-files', id: 'eu-info-list' });
      for (const d of list) {
        const what = d.guide_detected ? guideSummary(d.guide_answers || []) : 'Your own notes';
        ul.append(h('li', {}, h('strong', { text: d.file_name }),
          h('span', { class: 'small muted', text: ` · ${what} · ${d.text_chars.toLocaleString()} characters · uploaded ${fmtDate(d.ready_at)}` }),
          h('div', { class: 'actions' }, h('button', { class: 'small secondary', onclick: () => viewText(d, viewInformation), text: 'Review' }),
            canPrepare() ? pickButton('Replace', 'information', d.id, 'small secondary') : null,
            info.locked ? null : h('button', { class: 'small secondary', onclick: () => remove(d, viewInformation), text: 'Delete' }))));
      }
      parts.push(h('h3', { text: 'Your information files' }), ul);
    }
    if (canPrepare()) {
      if (list.length < max) parts.push(uploadArea('information', null, list.length ? 'Add another file' : 'Choose your file'));
      else parts.push(h('p', { class: 'small muted', text: `You have ${max} information files, the most you can keep. Replace or delete one to add another.` }));
    }
    parts.push(aiPermissionPanel());
    X.show(X.card(...parts));
  }
  function guideSummary(keys) {
    const qs = keys.filter((k) => QUESTIONS[k]).length;
    return `Guide: ${qs} of 10 questions answered${keys.includes('additional') ? ' + Additional Information' : ''}`;
  }
  function sourcesText() {
    return ['your information files', info.ai_memories ? 'your memory descriptions' : null, info.ai_life_story ? 'your Life Story' : null]
      .filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1');
  }
  function aiPermissionPanel() {
    if (info.option === 'ai' && info.ai_consent) {
      return h('div', { class: 'note', id: 'eu-ai-on' }, h('strong', { text: '✓ AI-assisted eulogy selected' }),
        h('p', { class: 'small', text: `When your legacy process begins, DayCasion writes your eulogy with AI from ${sourcesText()}. Photos, videos, voice recordings and your completed-eulogy file are never used.` }),
        canPrepare() ? h('div', { class: 'actions' }, h('button', { class: 'small secondary', onclick: chooseAi, text: 'Change what AI may use' })) : null);
    }
    if (!canPrepare()) return null;
    return h('div', { class: 'note' }, h('strong', { text: 'Use AI-assisted eulogy?' }),
      h('p', { class: 'small', text: info.option === 'completed'
        ? 'You currently have My Completed Eulogy (No AI) selected. Choosing AI-assisted means your executor receives the AI-written eulogy instead.'
        : 'Your information is used only after you allow it.' }),
      h('div', { class: 'actions' }, h('button', { id: 'eu-choose-ai', onclick: chooseAi, text: 'Allow and use AI-assisted eulogy' })));
  }
  async function chooseAi() {
    const mem = h('input', { type: 'checkbox', id: 'eu-src-memories' }); mem.checked = !!info.ai_memories;
    const ls = h('input', { type: 'checkbox', id: 'eu-src-lifestory' }); ls.checked = !!info.ai_life_story;
    const ok = await X.choose({ title: 'Allow DayCasion to write your eulogy with AI?', body: [
      'When your legacy process begins, DayCasion sends the information files you uploaded here to OpenAI, only to write your eulogy for your Legacy Executor. OpenAI doesn\'t keep it or use it for training.',
      'AI follows the tone you asked for and leaves out the topics you asked it to leave out. It never invents names, places, events or quotations.',
      h('p', { class: 'small', text: 'You can also let AI use (optional):' }),
      h('label', { class: 'check' }, mem, ' My memory descriptions (the written stories of my My Life profile)'),
      h('label', { class: 'check' }, ls, ' My Life Story'),
      h('p', { class: 'small muted', text: 'Photos, videos, voice recordings and your completed-eulogy file are never sent. You can change or withdraw this until your legacy process begins.' }),
    ], options: [{ label: 'Allow and use AI-assisted eulogy', value: true }] });
    if (!ok) return;
    await setOption('ai', { memories: mem.checked, lifeStory: ls.checked }, viewInformation);
  }

  async function setOption(option, src, then) {
    const r = await X.rpc('dc_my_eulogy_set_option', { p_option: option, p_ai_memories: !!(src && src.memories),
      p_ai_life_story: !!(src && src.lifeStory), p_ai_permission: option === 'ai' });
    if (!r.ok) return then(h('p', { class: 'err', role: 'alert', text: X.plainErr(r, 'That didn\'t save. Please try again.') }));
    then(h('p', { class: 'ok', role: 'status', text: option === 'ai' ? 'Saved. AI-assisted eulogy is selected.' : option === 'completed' ? 'Saved. Your completed eulogy is selected.' : 'Saved.' }));
  }

  // ------------------------------------------------------------------ files: pick, upload, check
  function pickButton(label, kind, replaces, cls) {
    const input = h('input', { type: 'file', accept: '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain', hidden: true,
      'aria-label': label, onchange: () => { const f = input.files && input.files[0]; input.value = ''; if (f) upload(kind, f, replaces); } });
    return h('span', {}, input, h('button', { class: cls || 'secondary', onclick: () => input.click(), text: label }));
  }
  function uploadArea(kind, replaces, label) {
    const zone = h('div', { class: 'drop', id: `eu-drop-${kind}` },
      h('p', { text: 'Drop your file here, or' }),
      h('div', { class: 'actions' }, pickButton(label, kind, replaces, 'primary')),
      h('p', { class: 'small muted', text: 'PDF, Word (.docx) or text (.txt), up to 10 MB.' + (kind === 'information' ? ' Typed text only: scanned or handwritten pages can\'t be read.' : '') }));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) upload(kind, f, replaces); });
    return zone;
  }
  function localCheck(f) {
    const ext = (f.name.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1];
    const e = (ext || '').toLowerCase();
    if (e === 'doc') return 'Older Word files (.doc) can\'t be used. In Word, choose File > Save As and pick Word Document (.docx), then upload that file.';
    if (['docm', 'dotm', 'dot', 'dotx'].includes(e)) return 'Word files with macros or templates can\'t be uploaded. Save the document as a Word Document (.docx) and upload that file.';
    if (!['pdf', 'docx', 'txt'].includes(e)) return 'Please choose a PDF (.pdf), Word (.docx) or text (.txt) file.';
    if (!f.size) return 'This file is empty.';
    if (f.size > MAX_BYTES) return 'This file is larger than 10 MB. Please upload a smaller file.';
    return null;
  }
  async function upload(kind, file, replaces) {
    const again = kind === 'completed' ? viewCompleted : viewInformation;
    const bad = localCheck(file);
    if (bad) return again(h('p', { class: 'err', role: 'alert', text: bad }));
    const bar = h('progress', { max: '100', value: '0', 'aria-label': 'Upload progress' });
    const status = h('p', { role: 'status', text: `Uploading ${file.name}…` });
    X.show(X.card(h('h2', { text: kind === 'completed' ? OPTION.completed : OPTION.ai }), status, bar));
    try {
      const b = await X.rpc('dc_my_eulogy_begin_upload', { p_kind: kind, p_file_name: file.name, p_size: file.size, p_replaces: replaces || null });
      if (!b.ok) throw Object.assign(new Error('begin'), { userMessage: X.plainErr(b, 'The upload couldn\'t start. Please try again.') });
      await putObject(b.data.path, file, b.data.mime_type, (pct) => { bar.value = String(pct); });
      status.textContent = 'Checking your file…'; bar.removeAttribute('value');
      const r = await X.authed('/functions/v1/legacy-eulogy-docs', { method: 'POST', body: { action: 'finish', id: b.data.id } });
      if (!r.ok) throw Object.assign(new Error('finish'), { userMessage: X.plainErr(r, 'We couldn\'t check this file. Please try again.') });
      const d = (await load(), (info.documents || []).find((x) => x.id === b.data.id));
      if (!d) return again();
      return viewText(d, again, true);
    } catch (e) {
      if (e.message === 'signed-out') return;
      again(h('p', { class: 'err', role: 'alert', text: e.userMessage || 'The upload didn\'t complete. Please try again.' }));
    }
  }
  function putObject(path, blob, type, onPct) {
    return new Promise((resolve, reject) => {
      const s = X.session();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${X.url}/storage/v1/object/legacy-documents/${path.split('/').map(encodeURIComponent).join('/')}`);
      xhr.setRequestHeader('Authorization', 'Bearer ' + s.access_token);
      xhr.setRequestHeader('apikey', X.key);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('Content-Type', type);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve()
        : reject(Object.assign(new Error('upload'), { userMessage: xhr.status === 413 ? 'This file is larger than 10 MB. Please upload a smaller file.' : 'The upload didn\'t complete. Please try again.' })));
      xhr.onerror = () => reject(Object.assign(new Error('upload'), { userMessage: 'The connection was interrupted. Please try again.' }));
      xhr.send(blob);
    });
  }

  // ------------------------------------------------------------------ Personal Video Eulogy (No AI)
  // One video (MP4 or MOV, up to 60 minutes), alongside either written choice or on its own. It uses the member's own
  // plan storage (no extra storage is included). Uploaded in 6 MB pieces (resumable), checked by DayCasion, never sent to AI.
  const canPrepare = () => info.can_prepare !== false && !info.locked;
  const VIDEO_TYPES = '.mp4,.mov,.m4v,video/mp4,video/quicktime';
  const MAX_VIDEO_SECONDS = 3600;
  const CHUNK = 6 * 1024 * 1024; // Supabase resumable uploads: 6 MB pieces
  const fmtBytes = (b) => { b = Number(b) || 0; if (b <= 0) return '0 KB'; if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`; if (b >= 1048576) return `${Math.round(b / 1048576)} MB`; return `${Math.max(1, Math.ceil(b / 1024))} KB`; };
  const clock = (s) => { s = Math.round(Number(s) || 0); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`; };

  function videoSummary() {
    const v = info.video;
    return h('section', { class: 'note video-card', id: 'eu-video-card' },
      h('strong', { text: 'Add a Personal Video Eulogy' }),
      h('p', { class: 'small', text: 'Leave a personal message in your own voice. Upload a video up to 60 minutes long to be delivered to your Legacy Executor alongside your written eulogy, if you have one.' }),
      h('p', { class: 'small muted', id: 'eu-video-status', text: v ? `Your video: ${clock(v.duration_seconds)} · ${fmtBytes(v.size_bytes)} · uploaded ${fmtDate(v.ready_at)}` : 'No video uploaded yet.' }),
      h('div', { class: 'actions' }, h('button', { id: 'eu-video', class: v ? 'secondary' : '', onclick: () => viewVideo(), text: v ? 'Preview, replace or delete' : (canPrepare() ? 'Upload Video' : 'View') })));
  }

  async function viewVideo(message) {
    try { await load(); } catch (e) { return X.show(errorCard(e.userMessage || 'Please reload the page.')); }
    const v = info.video;
    const parts = [heading('Personal Video Eulogy', viewHome, 'Back to My Eulogy'), ...statusNotes(), noteOf(message)];
    if (v) {
      const player = h('video', { controls: '', preload: 'metadata', playsinline: '', id: 'eu-video-player', 'aria-label': 'Your video eulogy' });
      signedVideoUrl(v.storage_path).then((u) => { if (u) player.src = u; });
      parts.push(h('div', { class: 'note target', id: 'eu-video-current' }, h('strong', { text: v.file_name }),
        h('span', { class: 'small muted', id: 'eu-video-facts', text: `${clock(v.duration_seconds)} long · ${fmtBytes(v.size_bytes)} · uploaded ${fmtDate(v.ready_at)}` }),
        player,
        h('p', { class: 'small', text: info.executor_receives_video ? 'Your Legacy Executor will receive this video exactly as you uploaded it, alongside any written eulogy.'
          : 'Your Legacy Executor receives this video only with Eulogy Only or the Complete Legacy Package.' })),
        h('div', { class: 'actions' }, canPrepare() ? videoPickButton('Replace Video', true) : null,
          !info.locked ? h('button', { class: 'secondary', id: 'eu-video-delete', onclick: () => deleteVideo(v), text: 'Delete Video' }) : null));
    } else if (info.locked) {
      parts.push(h('p', { class: 'muted', text: 'No video eulogy was uploaded.' }));
    }
    if (!v && canPrepare()) {
      parts.push(h('h3', { text: 'Upload Your Video Eulogy' }),
        h('p', { text: 'Record a personal message for your loved ones or upload a completed video eulogy, up to 60 minutes long. Your video counts toward your existing DayCasion subscription storage. No additional storage is included with this feature.' }),
        storagePanel(null), videoDrop());
    } else if (!v && !info.locked) {
      parts.push(h('p', { text: 'Record a personal message for your loved ones or upload a completed video eulogy, up to 60 minutes long. Your video counts toward your existing DayCasion subscription storage.' }),
        h('p', { class: 'muted', text: 'Uploading a video is unlocked with Eulogy Only or the Complete Legacy Package.' }));
    } else if (v && canPrepare()) {
      parts.push(h('p', { class: 'small muted', text: 'Replacing: your current video stays until the new one has uploaded and been checked. Only the difference in size counts toward your storage.' }));
    }
    X.show(X.card(...parts));
  }

  async function signedVideoUrl(path) {
    const s = await X.authed(`/storage/v1/object/sign/legacy-videos/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', body: { expiresIn: 3600 } });
    const signed = s.ok && s.data && (s.data.signedURL || s.data.signedUrl);
    return signed ? `${X.url}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}` : null;
  }

  /** The storage figures (from the member's account) with an optional selected file; replacing counts the released video. */
  function storagePanel(file) {
    const st = info.storage || {};
    const total = Number(st.allowance_bytes) || 0, usedB = Number(st.used_bytes) || 0;
    const current = file && file.replacing ? Number(st.current_video_bytes) || 0 : 0;
    const avail = Math.max(total - usedB, 0);
    const size = file ? file.size : 0;
    const after = total - usedB + current - size;
    const pct = (x) => `${Math.max(0, Math.min(100, total ? (x / total) * 100 : 0)).toFixed(2)}%`;
    // Widths are set through the style property (the page's security policy blocks inline style attributes).
    const usedBar = h('span', { class: 'used' }); usedBar.style.width = pct(usedB - current);
    const videoBar = file ? h('span', { class: after < 0 ? 'video over' : 'video' }) : null;
    if (videoBar) videoBar.style.width = after < 0 ? pct(Math.max(total - usedB + current, 0)) : pct(size);
    const bar = h('div', { class: 'storage-bar', role: 'img', 'aria-label': `Storage: ${fmtBytes(usedB)} of ${fmtBytes(total)} used` + (file ? `, plus this video ${fmtBytes(size)}` : '') },
      usedBar, videoBar);
    const row = (k, v, cls) => h('div', { class: 'srow' + (cls ? ' ' + cls : '') }, h('span', { text: k }), h('strong', { text: v }));
    const rows = [row('Plan', st.plan || (total ? 'Storage add-on' : 'No plan')), row('Total storage', fmtBytes(total)), row('Currently used', fmtBytes(usedB)),
      row('Available before upload', fmtBytes(avail))];
    if (file) {
      if (current) rows.push(row('Current video (replaced)', `− ${fmtBytes(current)}`));
      rows.push(row('Selected video', fmtBytes(size)), row('Available after upload', after >= 0 ? fmtBytes(after) : `${fmtBytes(-after)} short`, after >= 0 ? 'total-row' : 'total-row err'));
    }
    return h('div', { class: 'storage-panel', id: 'eu-storage' }, h('strong', { text: 'Your Storage' }), bar, ...rows);
  }

  function videoPickButton(label, replacing, cls) {
    const input = h('input', { type: 'file', accept: VIDEO_TYPES, hidden: true, 'aria-label': label,
      onchange: () => { const f = input.files && input.files[0]; input.value = ''; if (f) selectVideo(f, replacing); } });
    return h('span', { id: 'eu-video-pick' }, input, h('button', { class: cls || 'secondary', onclick: () => input.click(), text: label }));
  }
  function videoDrop() {
    const zone = h('div', { class: 'drop', id: 'eu-drop-video' }, h('p', { text: 'Drop your video here, or' }),
      h('div', { class: 'actions' }, videoPickButton('Upload Video', false, 'primary')),
      h('p', { class: 'small muted', text: 'MP4 or MOV, up to 60 minutes. 1080p and other common resolutions are fine. No separate size limit: it only needs to fit in your available storage.' }));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) selectVideo(f, !!info.video); });
    return zone;
  }

  /** Reads the selected file's length and picture size in the browser (the server checks the length again). */
  function readVideoMeta(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file); const v = document.createElement('video'); let done = false;
      const finish = (m) => { if (done) return; done = true; URL.revokeObjectURL(url); v.removeAttribute('src'); resolve(m); };
      v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = () => finish({ duration: Number.isFinite(v.duration) ? v.duration : null, width: v.videoWidth || null, height: v.videoHeight || null });
      v.onerror = () => finish({ duration: null, width: null, height: null });
      setTimeout(() => finish({ duration: null, width: null, height: null }), 15000);
      v.src = url;
    });
  }

  async function selectVideo(file, replacing) {
    const ext = ((file.name.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || '').toLowerCase();
    if (!['mp4', 'mov', 'm4v'].includes(ext)) return viewVideo(h('p', { class: 'err', role: 'alert', text: 'Please choose an MP4 (.mp4) or MOV (.mov) video.' }));
    if (!file.size) return viewVideo(h('p', { class: 'err', role: 'alert', text: 'This video file is empty.' }));
    X.show(X.card(h('h2', { text: 'Upload Your Video Eulogy' }), h('p', { role: 'status', text: `Reading ${file.name}…` })));
    const meta = await readVideoMeta(file);
    if (meta.duration && meta.duration >= MAX_VIDEO_SECONDS + 1) {
      return viewVideo(h('p', { class: 'err', role: 'alert', text: `This video is ${clock(meta.duration)} long. Videos can be up to 60 minutes. Please choose a shorter video.` }));
    }
    try { await load(); } catch (e) { return X.show(errorCard(e.userMessage || 'Please reload the page.')); }
    replacing = replacing && !!info.video;
    const st = info.storage || {};
    const after = Number(st.allowance_bytes) - Number(st.used_bytes) + (replacing ? Number(st.current_video_bytes) || 0 : 0) - file.size;
    const parts = [h('h2', { text: replacing ? 'Replace Your Video Eulogy' : 'Upload Your Video Eulogy' }),
      h('p', { text: 'Record a personal message for your loved ones or upload a completed video eulogy, up to 60 minutes long. Your video counts toward your existing DayCasion subscription storage. No additional storage is included with this feature.' }),
      h('p', { class: 'small', id: 'eu-video-selected', text: `${file.name} · ${fmtBytes(file.size)}` + (meta.duration ? ` · ${clock(meta.duration)} long` : '') + (meta.height ? ` · ${meta.height}p` : '') }),
      storagePanel({ size: file.size, replacing })];
    if (after < 0) {
      parts.push(h('div', { class: 'note', role: 'alert', id: 'eu-storage-short' }, h('strong', { text: 'Not enough storage for this video' }),
        h('p', { class: 'small', text: `This video needs ${fmtBytes(file.size)}, but you have ${fmtBytes(Math.max(file.size + after, 0))} available${replacing ? ' (including the video it replaces)' : ''}. You need ${fmtBytes(-after)} more.` }),
        h('p', { class: 'small', text: 'Add Storage in the DayCasion app: Settings > Profile Subscriptions > Add Storage. Or choose a shorter or smaller video.' })),
        h('div', { class: 'actions' }, h('button', { class: 'secondary', onclick: () => viewVideo(), text: 'Back' })));
      return X.show(X.card(...parts));
    }
    if (!meta.duration) parts.push(h('p', { class: 'small muted', text: 'Your browser couldn\'t read this video\'s length. DayCasion checks it after uploading (up to 60 minutes).' }));
    parts.push(h('div', { class: 'note', id: 'eu-video-confirm' },
      h('p', { text: `This video will use ${fmtBytes(file.size)} of your DayCasion storage. You will have approximately ${fmtBytes(after)} available after uploading.` }),
      replacing ? h('p', { class: 'small muted', text: 'Your current video stays until this one has uploaded and been checked, then it is removed.' }) : null,
      h('div', { class: 'actions' }, h('button', { class: 'primary', id: 'eu-video-continue', onclick: () => uploadVideo(file, meta), text: 'Continue Upload' }),
        h('button', { class: 'secondary', onclick: () => viewVideo(), text: 'Cancel' }))));
    X.show(X.card(...parts));
  }

  let activeUpload = null;
  async function uploadVideo(file, meta) {
    const bar = h('progress', { max: '100', value: '0', id: 'eu-video-progress', 'aria-label': 'Upload progress' });
    const status = h('p', { role: 'status', id: 'eu-video-upload-status', text: `Starting ${file.name}…` });
    const cancel = h('button', { class: 'secondary', id: 'eu-video-cancel', text: 'Cancel Upload', onclick: () => { if (activeUpload) activeUpload.cancel(); } });
    X.show(X.card(h('h2', { text: 'Uploading Your Video Eulogy' }), status, bar,
      h('p', { class: 'small muted', text: 'Keep this page open until the upload finishes. Large videos can take a while; if the connection drops, the upload continues where it stopped.' }),
      h('div', { class: 'actions' }, cancel)));
    let begun = null;
    try {
      const b = await X.rpc('dc_my_eulogy_video_begin', { p_file_name: file.name, p_size: file.size,
        p_duration_seconds: meta.duration ? Math.round(meta.duration * 1000) / 1000 : null, p_width: meta.width, p_height: meta.height });
      if (!b.ok) throw Object.assign(new Error('begin'), { userMessage: X.plainErr(b, 'The upload couldn\'t start. Please try again.') });
      begun = b.data;
      const t0 = Date.now();
      await resumableUpload(begun, file, (sent) => {
        bar.value = String(Math.floor((sent / file.size) * 100));
        const secs = (Date.now() - t0) / 1000; const rate = sent / Math.max(secs, 1);
        const left = rate > 0 ? (file.size - sent) / rate : 0;
        status.textContent = `Uploading ${fmtBytes(sent)} of ${fmtBytes(file.size)}` + (sent < file.size && secs > 5 ? ` · about ${left > 90 ? Math.ceil(left / 60) + ' minutes' : Math.ceil(left) + ' seconds'} left` : '');
      });
      cancel.disabled = true; bar.removeAttribute('value'); status.textContent = 'Checking your video…';
      const r = await X.authed('/functions/v1/legacy-eulogy-docs', { method: 'POST', body: { action: 'finish_video', id: begun.id } });
      if (!r.ok) throw Object.assign(new Error('finish'), { userMessage: X.plainErr(r, 'We couldn\'t check this video. Please try again.'), kept: true });
      await load();
      const v = info.video;
      viewVideo(h('p', { class: 'ok', role: 'status', id: 'eu-video-saved', text: `✓ Your video eulogy was uploaded and saved privately${v ? ` (${clock(v.duration_seconds)}, ${fmtBytes(v.size_bytes)})` : ''}. You have ${fmtBytes(info.storage && info.storage.available_bytes)} of storage available.` }));
    } catch (e) {
      if (e.message === 'signed-out') return;
      if (begun && !e.kept) await X.rpc('dc_my_eulogy_video_delete', { p_id: begun.id }).catch(() => {});
      releaseVideos();
      viewVideo(h('p', { class: e.cancelled ? 'muted' : 'err', role: e.cancelled ? 'status' : 'alert',
        text: e.cancelled ? 'Upload cancelled. Nothing was changed.' : (e.userMessage || 'The upload didn\'t complete. Please try again.') + (info.video ? ' Your current video is unchanged.' : '') }));
    } finally { activeUpload = null; }
  }

  /** tus 1.0 resumable upload to Supabase Storage (POST to create, PATCH 6 MB pieces, HEAD to resume after an error). */
  function resumableUpload(begun, file, onProgress) {
    const endpoint = `${X.url}/storage/v1/upload/resumable`;
    const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
    let location = null; let offset = 0; let xhr = null; let cancelled = false;
    const fail = (msg, extra) => Object.assign(new Error('upload'), { userMessage: msg }, extra || {});
    const request = async (method, url, headers, body, onUp) => new Promise((resolve, reject) => {
      (async () => {
        const token = await X.token();
        xhr = new XMLHttpRequest(); xhr.open(method, url);
        const all = { 'Tus-Resumable': '1.0.0', apikey: X.key, Authorization: `Bearer ${token}`, ...headers };
        for (const [k, v] of Object.entries(all)) xhr.setRequestHeader(k, v);
        if (onUp) xhr.upload.onprogress = (e) => onUp(e.loaded);
        xhr.onload = () => resolve(xhr);
        xhr.onerror = () => reject(fail('The connection was interrupted.', { network: true }));
        xhr.onabort = () => reject(fail('Upload cancelled.', { cancelled: true }));
        xhr.send(body ?? null);
      })().catch(reject);
    });
    const run = (async () => {
      const meta = { bucketName: 'legacy-videos', objectName: begun.path, contentType: begun.mime_type, cacheControl: '3600' };
      const c = await request('POST', endpoint, { 'Upload-Length': String(file.size), 'x-upsert': 'false',
        'Upload-Metadata': Object.entries(meta).map(([k, v]) => `${k} ${b64(v)}`).join(',') });
      if (c.status === 413) throw fail('This video is too large to upload in one piece right now. Please contact info@daycasion.com.');
      if (c.status === 403 || c.status === 401) throw fail('This upload wasn\'t allowed. Please reload the page and try again.');
      if (c.status !== 201) throw fail('The upload couldn\'t start. Please try again.');
      location = c.getResponseHeader('Location');
      if (location && location.startsWith('/')) location = new URL(location, X.url).href;
      let retries = 0;
      while (offset < file.size) {
        if (cancelled) throw fail('Upload cancelled.', { cancelled: true });
        const end = Math.min(offset + CHUNK, file.size);
        try {
          const p = await request('PATCH', location, { 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
            file.slice(offset, end), (n) => onProgress(offset + n));
          if (p.status === 204) { offset = Number(p.getResponseHeader('Upload-Offset')) || end; retries = 0; onProgress(offset); continue; }
          if (p.status === 409) throw fail('offset', { network: true }); // ask the server where to continue
          throw fail('The upload didn\'t complete. Please try again.', { status: p.status });
        } catch (e) {
          if (e.cancelled) throw e;
          if (!e.network || ++retries > 8) throw e.network ? fail('The connection was interrupted several times. Please check your internet connection and try again.') : e;
          await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** retries)));
          const hd = await request('HEAD', location, {}).catch(() => null);
          if (hd && hd.status === 200) offset = Number(hd.getResponseHeader('Upload-Offset')) || offset;
        }
      }
    })();
    activeUpload = { cancel: () => { cancelled = true; if (xhr) xhr.abort(); if (location) request('DELETE', location, {}).catch(() => {}); } };
    return run;
  }

  /** Frees the storage of deleted, replaced or cancelled videos straight away (the cleanup job would do it later). */
  const releaseVideos = () => X.authed('/functions/v1/legacy-eulogy-docs', { method: 'POST', body: { action: 'release_video' } }).catch(() => null);

  async function deleteVideo(v) {
    if (!await X.ask('Delete your video eulogy?', ['Your executor won\'t receive a video unless you upload another one. Its storage is released.', 'The video on your computer is not touched.'], 'Delete Video')) return;
    const r = await X.rpc('dc_my_eulogy_video_delete', { p_id: v.id });
    if (r.ok) await releaseVideos();
    viewVideo(r.ok ? h('p', { class: 'ok', role: 'status', text: 'Deleted your video eulogy. Its storage has been released.' }) : h('p', { class: 'err', role: 'alert', text: X.plainErr(r, 'That didn\'t work. Please try again.') }));
  }

  // ------------------------------------------------------------------ review, open, delete
  async function viewText(d, back, justUploaded) {
    const r = await X.authed(`/rest/v1/legacy_eulogy_documents?select=text_content,storage_path&id=eq.${encodeURIComponent(d.id)}`);
    const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
    const completed = d.kind === 'completed';
    const text = row && row.text_content ? row.text_content : '';
    const intro = completed
      ? (text ? 'This is the text your executor will read, exactly as written. They can also download your original document.'
              : 'We couldn\'t read text from this document (for example, a scanned page). Your executor will receive the document itself.')
      : (d.guide_detected ? `This is what DayCasion read from your guide (${guideSummary(d.guide_answers || [])}). The guide's own instructions are left out. AI uses all of this, including anything beyond the questions.`
                          : 'This is what DayCasion read from your notes. AI uses all of it.');
    X.show(X.card(heading(justUploaded ? 'Uploaded' : d.file_name, () => back(), justUploaded ? 'Done' : 'Back'),
      justUploaded ? h('p', { class: 'ok', role: 'status', text: `✓ ${d.file_name} was checked and saved privately.` }) : null,
      h('p', { class: 'small', text: intro }),
      text ? h('div', { class: 'eu-text', id: 'eu-text', tabindex: '0', text }) : null,
      h('div', { class: 'actions' }, h('button', { onclick: () => back(), text: justUploaded ? 'Done' : 'Back' }),
        row ? h('button', { class: 'secondary', onclick: () => openOriginal(d, row.storage_path), text: 'Open my file' }) : null)));
  }
  async function openOriginal(d, knownPath) {
    let path = knownPath;
    if (!path) {
      const r = await X.authed(`/rest/v1/legacy_eulogy_documents?select=storage_path&id=eq.${encodeURIComponent(d.id)}`);
      path = r.ok && r.data && r.data[0] ? r.data[0].storage_path : null;
    }
    if (!path) return;
    const s = await X.authed(`/storage/v1/object/sign/legacy-documents/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', body: { expiresIn: 60 } });
    const signed = s.ok && s.data && (s.data.signedURL || s.data.signedUrl);
    if (!signed) return X.ask('We couldn\'t open this file', 'Please try again.', 'OK');
    const a = h('a', { href: `${X.url}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}${signed.includes('?') ? '&' : '?'}download=${encodeURIComponent(d.file_name)}`, rel: 'noopener' });
    document.body.append(a); a.click(); a.remove();
  }
  async function remove(d, then) {
    const msg = d.kind === 'completed'
      ? (info.option === 'completed' ? 'This is the eulogy your executor would receive. If you delete it, they won\'t receive a eulogy unless you upload another one or choose AI-assisted.' : 'It is removed from DayCasion.')
      : 'It is removed from DayCasion and AI won\'t use it.';
    if (!await X.ask(`Delete ${d.file_name}?`, [msg, 'The file on your computer is not touched.'], 'Delete')) return;
    const r = await X.rpc('dc_my_eulogy_delete', { p_id: d.id });
    then(r.ok ? h('p', { class: 'ok', role: 'status', text: `Deleted ${d.file_name}.` }) : h('p', { class: 'err', role: 'alert', text: X.plainErr(r, 'That didn\'t work. Please try again.') }));
  }
})();
