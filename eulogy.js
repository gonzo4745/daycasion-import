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
    else if (!info.entitled) out.push(h('div', { class: 'note' }, h('strong', { text: 'You can prepare your eulogy now.' }),
      h('p', { class: 'small', text: 'Your Legacy Executor receives it only with Eulogy Only or the Complete Legacy Package, a one-time purchase in the DayCasion app (Settings > Legacy Executor). Legacy Access on its own does not include a eulogy.' })));
    return out;
  }

  // ------------------------------------------------------------------ home: the two options
  async function viewHome() {
    X.show(X.card(h('p', { class: 'muted', text: 'Loading My Eulogy…' })));
    try { await load(); } catch (e) { if (e.message !== 'signed-out') X.show(errorCard(e.userMessage || 'Please reload the page.')); return; }
    const completed = docs('completed')[0];
    const infos = docs('information');
    const selected = OPTION[info.option] || OPTION.none;
    const option = (id, icon, title, text, status, onclick) => h('button', { class: 'choice', id, onclick },
      h('span', { class: 'choice-icon', 'aria-hidden': 'true', text: icon }), h('strong', { text: title }),
      h('span', { class: 'choice-text', text }), h('span', { class: 'choice-hint', text: status }));
    X.show(X.card(heading('Import My Eulogy', X.back),
      h('p', { class: 'muted small', text: (info.my_life_profile ? `For ${info.my_life_profile.name}. ` : '') +
        'Your eulogy is private. Only your Legacy Executor receives the final eulogy, through DayCasion\'s secure Legacy process.' }),
      h('p', { id: 'eu-selected', text: `Your choice for your executor: ${selected}` + (info.option === 'none' ? '' : '.') }),
      ...statusNotes(),
      h('div', { class: 'choices' },
        option('eu-completed', '✓', OPTION.completed,
          'Upload your finished eulogy. It is kept exactly as you wrote it and never sent to AI. Your executor receives it with a copy of your original document.',
          completed ? `Uploaded: ${completed.file_name}` : 'Nothing uploaded yet', () => viewCompleted()),
        option('eu-information', '✎', OPTION.ai,
          'Download the Eulogy Preparation Guide, answer any questions you like, and upload it or your own notes. DayCasion writes your eulogy with AI. Your executor receives only the finished eulogy.',
          infos.length ? `${infos.length} information ${infos.length === 1 ? 'file' : 'files'} uploaded` : 'Nothing uploaded yet', () => viewInformation())),
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
      if (!info.locked) acts.push(pickButton('Replace', 'completed', d.id), h('button', { class: 'secondary', onclick: () => remove(d, viewCompleted), text: 'Delete' }));
      parts.push(h('div', { class: 'actions' }, acts));
      if (!info.locked && info.option !== 'completed') {
        parts.push(h('div', { class: 'note' }, h('strong', { text: 'Use this as your eulogy?' }),
          h('p', { class: 'small', text: info.option === 'ai'
            ? 'You currently have My Eulogy Information (AI-assisted) selected. Choosing your completed eulogy means AI won\'t write one, and your AI permission is withdrawn.'
            : 'Your executor receives your completed eulogy only once you choose it.' }),
          h('div', { class: 'actions' }, h('button', { id: 'eu-use-completed', onclick: () => setOption('completed', null, viewCompleted), text: 'Use My Completed Eulogy' }))));
      } else if (info.option === 'completed') {
        parts.push(h('p', { class: 'small', text: '✓ Selected: your executor will receive this eulogy.' }));
      }
    } else if (!info.locked) {
      parts.push(uploadArea('completed', null, 'Choose your eulogy file'));
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
            info.locked ? null : pickButton('Replace', 'information', d.id, 'small secondary'),
            info.locked ? null : h('button', { class: 'small secondary', onclick: () => remove(d, viewInformation), text: 'Delete' }))));
      }
      parts.push(h('h3', { text: 'Your information files' }), ul);
    }
    if (!info.locked) {
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
        info.locked ? null : h('div', { class: 'actions' }, h('button', { class: 'small secondary', onclick: chooseAi, text: 'Change what AI may use' })));
    }
    if (info.locked) return null;
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
