/* DayCasion Desktop Import: core logic (no DOM). Folder understanding, file rules, metadata, suggested memories and
 * the edits made in the preview. Used by app.js in the browser and by the Node tests (module.exports). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DcImport = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- limits (same as the DayCasion app and server)
  const MAX_BYTES = 52428800; // photos: 50 MB
  // Videos: the server's limit (app_config max_video_bytes, 100 MB). 50 MB until the page has read it.
  const LIMITS = { videoBytes: 52428800 };
  function setLimits(l) { if (l && l.videoBytes >= MAX_BYTES) LIMITS.videoBytes = l.videoBytes; }
  const mb = (b) => `${Math.round(b / 1048576)} MB`;
  const MAX_VIDEO_SECONDS = 30.5; // the app's 30-second limit (memory_media_video_length_check)
  const MAX_FILES = 10000; // per import (dc_import_add_items)
  const DISPLAY_WIDTH = 1024; // display copy, as the app makes (_dcMakeDisplayCopy)

  const TYPES = {
    jpg: ['photo', 'image/jpeg'], jpeg: ['photo', 'image/jpeg'], jpe: ['photo', 'image/jpeg'],
    png: ['photo', 'image/png'], heic: ['photo', 'image/heic'], heif: ['photo', 'image/heif'],
    webp: ['photo', 'image/webp'], mp4: ['video', 'video/mp4'], m4v: ['video', 'video/mp4'],
    mov: ['video', 'video/quicktime'],
  };
  const UNSUPPORTED = {
    gif: 'GIF images', tif: 'TIFF images', tiff: 'TIFF images', bmp: 'BMP images', svg: 'SVG images',
    psd: 'Photoshop files', dng: 'RAW camera files', cr2: 'RAW camera files', cr3: 'RAW camera files',
    nef: 'RAW camera files', arw: 'RAW camera files', orf: 'RAW camera files', rw2: 'RAW camera files',
    raf: 'RAW camera files', srw: 'RAW camera files', pef: 'RAW camera files', avi: 'AVI videos',
    mkv: 'MKV videos', wmv: 'WMV videos', mpg: 'MPEG videos', mpeg: 'MPEG videos', '3gp': '3GP videos',
    webm: 'WebM videos', flv: 'Flash videos', mts: 'AVCHD videos', m2ts: 'AVCHD videos', vob: 'DVD videos',
    zip: 'ZIP files (open the ZIP first, then choose its folder)',
  };
  // Never offered, never reported: system files, sidecars and thumbnail caches.
  const IGNORED_FILE = /^(\.|thumbs\.db$|desktop\.ini$|picasa\.ini$|icon\r?$)/i;
  const IGNORED_EXT = new Set(['aae', 'xmp', 'thm', 'lrv', 'ini', 'db', 'ds_store']);
  const IGNORED_FOLDER = /^(\.|@eadir$|__macosx$|\$recycle\.bin$|system volume information$|\.thumbnails$)/i;
  // Folders that hold versions of the same event rather than a new event: merged into their parent folder's memory.
  const GENERIC_FOLDER = /^(edited|edits|originals?|raw|jpe?g|heic|selects?|selected|favou?rites|best|best of|exports?|exported|camera|camera roll|iphone|android|phone|dcim|misc|miscellaneous|other|more|extras?|unsorted|photos?|pictures?|pics|images?|videos?|movies?|clips|new folder|untitled folder|\d{3}[a-z_]{5}|\d{3}apple|\d{3}_?(pana|fuji|canon|nikon|gopro|msdcf|olymp|sony))$/i;

  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
    'october', 'november', 'december'];
  const MONTH_ABBR = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const MONTH_LABEL = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1));

  // ---------------------------------------------------------------- small helpers
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m || 1)}-${pad(d || 1)}`;
  const validDay = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  };
  const okYear = (y) => y >= 1826 && y <= 2100;
  const extOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
  const baseName = (p) => p.split('/').pop();
  const dirName = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
  const cleanText = (s) => s.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–—.,:;#]+|[\s\-–—.,:;#]+$/g, '').trim();
  const naturalCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  function monthFromWord(w) {
    const s = w.toLowerCase().replace(/\.$/, '');
    const full = MONTHS.indexOf(s);
    if (full >= 0) return full + 1;
    return MONTH_ABBR[s] || null;
  }

  /** What a folder name says about dates, and the rest of its text (an event name, if any). */
  function parseFolderName(name) {
    const s = name.trim();
    let m;
    // 2026-11-14 Birthday / 2026_11_14 / 2026.11.14 / 20261114 Birthday
    if ((m = s.match(/^(\d{4})[-_. ]?(\d{2})[-_. ]?(\d{2})(?![\d])\s*[-_–—,:]*\s*(.*)$/))) {
      const y = +m[1], mo = +m[2], d = +m[3];
      if (okYear(y) && validDay(y, mo, d)) return { year: y, month: mo, day: d, rest: cleanText(m[4]) };
    }
    // 14.11.2026 / 14-11-2026 (day first, as written outside the US) and 11-14-2026 when unambiguous
    if ((m = s.match(/^(\d{1,2})[-_. ](\d{1,2})[-_. ](\d{4})(?![\d])\s*[-_–—,:]*\s*(.*)$/))) {
      const a = +m[1], b = +m[2], y = +m[3];
      if (okYear(y)) {
        if (a > 12 && validDay(y, b, a)) return { year: y, month: b, day: a, rest: cleanText(m[4]) };
        if (b > 12 && validDay(y, a, b)) return { year: y, month: a, day: b, rest: cleanText(m[4]) };
        if (a <= 12 && b <= 12) return { year: y, rest: cleanText(m[4]) }; // ambiguous day/month: keep only the year
      }
    }
    // 2026-11 Thanksgiving / 2026_11
    if ((m = s.match(/^(\d{4})[-_. ](\d{1,2})(?![\d])\s*[-_–—,:]*\s*(.*)$/))) {
      const y = +m[1], mo = +m[2];
      if (okYear(y) && mo >= 1 && mo <= 12) return { year: y, month: mo, rest: cleanText(m[3]) };
    }
    // 11 - November / 11 November / 11_Nov
    if ((m = s.match(/^(\d{1,2})[\s\-_.]+([a-z]+\.?)$/i)) && monthFromWord(m[2]) === +m[1]) return { month: +m[1], rest: '' };
    // November 2026 / Nov-2026 / 2026 November / November
    if ((m = s.match(/^([a-z]+\.?)[\s\-_,]*(\d{4})?$/i)) && monthFromWord(m[1])) {
      const y = m[2] ? +m[2] : null;
      if (!y || okYear(y)) return { year: y || undefined, month: monthFromWord(m[1]), rest: '' };
    }
    if ((m = s.match(/^(\d{4})[\s\-_,]+([a-z]+\.?)$/i)) && monthFromWord(m[2]) && okYear(+m[1])) {
      return { year: +m[1], month: monthFromWord(m[2]), rest: '' };
    }
    // 2026
    if ((m = s.match(/^(\d{4})$/)) && okYear(+m[1])) return { year: +m[1], rest: '' };
    // 01 .. 12 (a month only when a parent folder gives the year)
    if ((m = s.match(/^(\d{1,2})$/)) && +m[1] >= 1 && +m[1] <= 12) return { monthNumber: +m[1], rest: '' };
    // 2019 Beach Trip / 2019 - Beach Trip
    if ((m = s.match(/^(\d{4})\s*[-_–—,:]+\s*(.+)$/)) || (m = s.match(/^(\d{4})\s+(\D.*)$/))) {
      if (okYear(+m[1])) return { year: +m[1], rest: cleanText(m[2]) };
    }
    // Beach Trip 2019 / Beach Trip (2019) / Christmas '99 is left as text
    if ((m = s.match(/^(.*\D)\s*[-_–—,(\[]*\s*(\d{4})\s*[)\]]?$/)) && okYear(+m[2])) {
      return { year: +m[2], rest: cleanText(m[1]) };
    }
    return { rest: cleanText(s) };
  }

  // ---------------------------------------------------------------- file rules
  /** photo/video with its MIME type, or why it's skipped (null reason = silently ignored). */
  function classify(relativePath, size) {
    const name = baseName(relativePath);
    const parts = relativePath.split('/');
    if (parts.slice(0, -1).some((p) => IGNORED_FOLDER.test(p))) return { ignore: true };
    const ext = extOf(name);
    if (IGNORED_FILE.test(name) || IGNORED_EXT.has(ext) || name.startsWith('._')) return { ignore: true };
    const t = TYPES[ext];
    if (!t) {
      return { skip: true, reason: 'unsupported_type',
        message: UNSUPPORTED[ext] ? `${UNSUPPORTED[ext]} can't be added yet` : 'Not a photo or video DayCasion can add' };
    }
    if (!size) return { skip: true, reason: 'empty_file', message: 'The file is empty' };
    if (size > (t[0] === 'video' ? LIMITS.videoBytes : MAX_BYTES)) {
      return { skip: true, reason: 'file_too_large', kind: t[0],
        message: t[0] === 'video' ? `Videos can be up to ${mb(LIMITS.videoBytes)}. Please trim it or export a smaller copy.` : 'Photos can be up to 50 MB' };
    }
    return { kind: t[0], mime: t[1] };
  }

  function checkVideoLength(seconds) {
    if (!(seconds > 0)) return { skip: true, reason: 'video_length_unknown', message: "DayCasion couldn't read this video's length. Please re-export it as MP4 or MOV." };
    if (seconds > MAX_VIDEO_SECONDS) return { skip: true, reason: 'video_too_long', message: `Videos can be up to 30 seconds (this one is ${Math.round(seconds)} s). Please trim it first.` };
    return null;
  }

  const REASONS = {
    unsupported_type: 'Not a photo or video DayCasion can add', empty_file: 'The file is empty',
    file_too_large: 'Photos can be up to 50 MB and videos up to 100 MB', video_too_long: 'Videos can be up to 30 seconds',
    profile_not_subscribed: 'A DayCasion plan is needed', 
    video_length_unknown: "DayCasion couldn't read this video's length", video_not_included: 'Videos are part of the Video plan',
    storage_full: 'Not enough storage left', already_staged: 'Already waiting in Add Past Memories',
    already_in_a_memory: 'Already added to a memory', duplicate_in_selection: 'The same file is also in another folder you chose',
    invalid: "This file couldn't be read", unreadable: "This file couldn't be read",
  };

  // ---------------------------------------------------------------- metadata: EXIF (JPEG, HEIC) and MP4/MOV
  function readTiff(view, start) {
    const out = {};
    if (start + 8 > view.byteLength) return out;
    const le = view.getUint16(start) === 0x4949;
    if (!le && view.getUint16(start) !== 0x4d4d) return out;
    const u16 = (o) => view.getUint16(start + o, le);
    const u32 = (o) => view.getUint32(start + o, le);
    const str = (o, n) => { let s = ''; for (let i = 0; i < n && start + o + i < view.byteLength; i++) { const c = view.getUint8(start + o + i); if (!c) break; s += String.fromCharCode(c); } return s.trim(); };
    const readIfd = (off, tags) => {
      if (off + 2 > view.byteLength - start) return;
      const n = u16(off);
      for (let i = 0; i < n && i < 400; i++) {
        const e = off + 2 + i * 12;
        if (start + e + 12 > view.byteLength) return;
        const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        const valOff = (type === 2 && count > 4) || (type === 5) ? u32(e + 8) : e + 8;
        const val = type === 3 ? u16(e + 8) : type === 4 ? u32(e + 8) : null;
        tags(tag, type, count, valOff, val);
      }
    };
    let exifOff = null;
    readIfd(u32(4), (tag, type, count, vo, val) => {
      if (tag === 0x010f) out.make = str(vo, count);
      else if (tag === 0x0110) out.model = str(vo, count);
      else if (tag === 0x0112) out.orientation = val;
      else if (tag === 0x0132) out.dateTime = str(vo, count);
      else if (tag === 0x8769) exifOff = val;
    });
    if (exifOff) {
      readIfd(exifOff, (tag, type, count, vo, val) => {
        if (tag === 0x9003) out.dateTimeOriginal = str(vo, count);
        else if (tag === 0x9004) out.dateTimeDigitized = str(vo, count);
        else if (tag === 0x9011) out.offsetTimeOriginal = str(vo, count);
        else if (tag === 0xa002) out.width = val;
        else if (tag === 0xa003) out.height = val;
      });
    }
    return out;
  }

  function readJpegExif(buf) {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let o = 2;
    while (o + 4 <= v.byteLength) {
      if (v.getUint8(o) !== 0xff) return null;
      const marker = v.getUint8(o + 1);
      if (marker === 0xda || marker === 0xd9) return null;
      const len = v.getUint16(o + 2);
      if (marker === 0xe1 && o + 10 <= v.byteLength && v.getUint32(o + 4) === 0x45786966 && v.getUint16(o + 8) === 0) {
        return readTiff(v, o + 10);
      }
      o += 2 + len;
    }
    return null;
  }

  /** HEIC/HEIF and PNG: find the Exif block ("Exif\0\0" + TIFF header, or a TIFF header after an offset). */
  function readEmbeddedExif(buf) {
    const b = new Uint8Array(buf);
    const limit = Math.min(b.length - 12, 4 * 1024 * 1024);
    for (let i = 0; i < limit; i++) {
      if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 && b[i + 4] === 0 && b[i + 5] === 0) {
        const t = i + 6;
        if ((b[t] === 0x4d && b[t + 1] === 0x4d && b[t + 3] === 0x2a) || (b[t] === 0x49 && b[t + 1] === 0x49 && b[t + 2] === 0x2a)) {
          return readTiff(new DataView(buf), t);
        }
      }
    }
    return null;
  }

  /** MP4/MOV: duration and creation time from the movie header (mvhd); size from the first video track (tkhd). */
  function readMp4(buf) {
    const v = new DataView(buf);
    const out = {};
    const walk = (start, end, depth) => {
      let o = start;
      while (o + 8 <= end) {
        let size = v.getUint32(o);
        const type = String.fromCharCode(v.getUint8(o + 4), v.getUint8(o + 5), v.getUint8(o + 6), v.getUint8(o + 7));
        let header = 8;
        if (size === 1 && o + 16 <= end) { size = Number(v.getBigUint64(o + 8)); header = 16; }
        if (size === 0) size = end - o;
        if (size < header || o + size > end) return;
        if (type === 'moov' || type === 'trak') walk(o + header, o + size, depth + 1);
        else if (type === 'mvhd') {
          const ver = v.getUint8(o + header);
          const b = o + header + 4;
          let created, scale, dur;
          if (ver === 1) { created = Number(v.getBigUint64(b)); scale = v.getUint32(b + 16); dur = Number(v.getBigUint64(b + 20)); }
          else { created = v.getUint32(b); scale = v.getUint32(b + 8); dur = v.getUint32(b + 12); }
          if (scale > 0) out.durationSeconds = dur / scale;
          const unix = created - 2082844800; // seconds from 1904 to 1970
          if (created > 0 && unix > 31536000 && unix < 4102444800) out.created = new Date(unix * 1000);
        } else if (type === 'tkhd' && !out.width) {
          const ver = v.getUint8(o + header);
          const wOff = o + header + (ver === 1 ? 88 : 76);
          if (wOff + 8 <= o + size) {
            const w = v.getUint32(wOff) / 65536, h = v.getUint32(wOff + 4) / 65536;
            if (w > 1 && h > 1) { out.width = Math.round(w); out.height = Math.round(h); }
          }
        }
        o += size;
      }
    };
    try { walk(0, v.byteLength, 0); } catch (e) { /* damaged file: whatever was read */ }
    return out;
  }

  /** "2026:11:14 15:02:00" (+ optional "+02:00") -> capture info. The calendar day is taken as written. */
  function exifCapture(exif) {
    const s = exif && (exif.dateTimeOriginal || exif.dateTimeDigitized);
    const m = s && s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m || !okYear(+m[1]) || !validDay(+m[1], +m[2], +m[3])) return null;
    const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    const off = exif.offsetTimeOriginal && /^[+-]\d{2}:\d{2}$/.test(exif.offsetTimeOriginal) ? exif.offsetTimeOriginal : null;
    return { day: `${m[1]}-${m[2]}-${m[3]}`, local, at: off ? new Date(local + off).toISOString() : null, source: 'exif' };
  }

  function videoCapture(mp4) {
    if (!mp4 || !mp4.created) return null;
    const d = mp4.created;
    return { day: iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), local: null, at: d.toISOString(), source: 'video' };
  }

  /** Everything DayCasion keeps about one file, from its bytes. */
  function readMetadata(kind, mime, buf) {
    if (kind === 'video') {
      const mp4 = readMp4(buf);
      return { durationSeconds: mp4.durationSeconds || null, capture: videoCapture(mp4),
        width: mp4.width || null, height: mp4.height || null, extra: {} };
    }
    const exif = mime === 'image/jpeg' ? readJpegExif(buf) : (mime === 'image/heic' || mime === 'image/heif' || mime === 'image/png' || mime === 'image/webp') ? readEmbeddedExif(buf) : null;
    const extra = {};
    if (exif) {
      if (exif.make) extra.camera_make = exif.make.slice(0, 60);
      if (exif.model) extra.camera_model = exif.model.slice(0, 60);
      if (exif.orientation) extra.orientation = exif.orientation;
    }
    return { durationSeconds: null, capture: exifCapture(exif), width: (exif && exif.width) || null, height: (exif && exif.height) || null, extra };
  }

  // ---------------------------------------------------------------- suggested memories
  function folderContexts(folderPath) {
    // Walks the folders from the chosen top folder down, collecting date context and the deepest event folder.
    const segs = folderPath ? folderPath.split('/') : [];
    const ctx = { year: null, month: null, day: null };
    let groupIndex = segs.length - 1;
    // Version folders ("Edited", "Originals", "100APPLE") belong to their parent folder's memory.
    while (groupIndex > 0 && GENERIC_FOLDER.test(segs[groupIndex].trim())) groupIndex--;
    let title = '';
    for (let i = 0; i <= groupIndex; i++) {
      const p = parseFolderName(segs[i]);
      if (p.monthNumber && ctx.year) { ctx.month = p.monthNumber; ctx.day = null; }
      if (p.year) { if (p.year !== ctx.year) { ctx.month = null; ctx.day = null; } ctx.year = p.year; }
      if (p.month) { ctx.month = p.month; ctx.day = null; }
      if (p.day) ctx.day = p.day;
      if (i === groupIndex) title = p.monthNumber && !ctx.year ? segs[i].trim() : p.rest;
    }
    if (ctx.month && !ctx.year) ctx.month = null; // a month without a year is not a usable date
    return { ctx, groupFolder: segs.slice(0, groupIndex + 1).join('/'), title, depth: groupIndex };
  }

  function dateLabel(date, precision) {
    if (!date || precision === 'unknown') return 'Date not known'; // as in the app
    const [y, m, d] = date.split('-').map(Number);
    if (precision === 'year') return String(y);
    if (precision === 'approximate') return `Around ${y}`;
    if (precision === 'month') return `${MONTH_LABEL[m - 1]} ${y}`;
    if (precision === 'approximate_month') return `Around ${MONTH_LABEL[m - 1]} ${y}`;
    return `${MONTH_LABEL[m - 1]} ${d}, ${y}`;
  }

  /** Date for a group: the folders' date context first; capture dates only refine it (or stand in when the folders
   *  give none). A day is never invented: day precision needs a dated folder or photos all from that one day. */
  function groupDate(ctx, items) {
    const days = items.map((i) => i.capture && i.capture.day).filter(Boolean).sort();
    const sameDay = days.length > 0 && days.length === items.length && days[0] === days[days.length - 1];
    const inside = (d) => (!ctx.year || +d.slice(0, 4) === ctx.year) && (!ctx.month || +d.slice(5, 7) === ctx.month);
    if (ctx.year && ctx.month && ctx.day) return { date: iso(ctx.year, ctx.month, ctx.day), precision: 'day', source: 'folders' };
    if (ctx.year && ctx.month) {
      if (sameDay && inside(days[0])) return { date: days[0], precision: 'day', source: 'photos' };
      return { date: iso(ctx.year, ctx.month, 1), precision: 'month', source: 'folders' };
    }
    if (ctx.year) {
      const dayInYear = sameDay && inside(days[0]);
      if (dayInYear) return { date: days[0], precision: 'day', source: 'photos' };
      const months = new Set(days.filter(inside).map((d) => d.slice(0, 7)));
      if (days.length === items.length && days.length > 0 && months.size === 1 && days.every(inside)) {
        return { date: `${[...months][0]}-01`, precision: 'month', source: 'photos' };
      }
      return { date: iso(ctx.year, 1, 1), precision: 'year', source: 'folders' };
    }
    if (!days.length || days.length < items.length) return { date: null, precision: 'unknown', source: null };
    const first = days[0], last = days[days.length - 1];
    if (first === last) return { date: first, precision: 'day', source: 'photos' };
    if (first.slice(0, 7) === last.slice(0, 7)) return { date: first.slice(0, 7) + '-01', precision: 'month', source: 'photos' };
    if (first.slice(0, 4) === last.slice(0, 4)) return { date: first.slice(0, 4) + '-01-01', precision: 'year', source: 'photos' };
    return { date: null, precision: 'unknown', source: null };
  }

  /**
   * Suggested memories from scanned files.
   * files: [{ key, relativePath, kind, capture, ... }] (only valid, non-duplicate media).
   * Event folders become memories; version folders join their parent; files directly in year/month or top folders
   * are grouped by the day they were taken (when known), otherwise kept together as that folder's memory.
   */
  function suggestGroups(files) {
    // A chosen top folder that has media in sub-folders is a collection ("Audrey Photos"), not an event; one chosen
    // on its own ("Birthday Party") is the event itself.
    const collections = new Set();
    for (const f of files) { const segs = f.relativePath.split('/'); if (segs.length > 2) collections.add(segs[0]); }
    const byFolder = new Map();
    for (const f of files) {
      const folder = dirName(f.relativePath);
      const info = folderContexts(folder);
      const k = info.groupFolder;
      if (!byFolder.has(k)) byFolder.set(k, { info, files: [] });
      byFolder.get(k).files.push(f);
    }
    const groups = [];
    let n = 0;
    const when = (f) => (f.capture && (f.capture.at || f.capture.local)) || '~';
    const add = (title, folder, items, ctx, origin) => {
      items.sort((a, b) => when(a).localeCompare(when(b)) || naturalCompare(a.relativePath, b.relativePath));
      const d = groupDate(ctx, items);
      groups.push({ key: `g${++n}`, title: String(title || 'Imported photos').slice(0, 200), date: d.date, precision: d.precision,
        dateSource: d.source, folders: [folder], items: items.map((i) => i.key), origin });
    };
    for (const [folder, { info, files: list }] of byFolder) {
      const isCollectionTop = info.depth === 0 && collections.has(folder);
      if (folder !== '' && info.title && !isCollectionTop) {
        add(info.title, folder, list, info.ctx, 'event'); // an event folder: one suggested memory
        continue;
      }
      // Files directly in a year/month folder, in a collection's top folder, or chosen one by one: a memory per day
      // taken (when the photos say so and it fits the folder's dates); the rest stay together as that folder's memory.
      const byDay = new Map();
      const rest = [];
      for (const f of list) {
        const d = f.capture && f.capture.day;
        const fits = d && (!info.ctx.year || +d.slice(0, 4) === info.ctx.year) && (!info.ctx.month || +d.slice(5, 7) === info.ctx.month);
        if (fits) { if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(f); } else rest.push(f);
      }
      for (const [day, items] of [...byDay].sort()) {
        const [y, m, dd] = day.split('-').map(Number);
        add(dateLabel(day, 'day'), folder, items, { year: y, month: m, day: dd }, 'day');
      }
      if (rest.length) {
        const ctxDate = groupDate(info.ctx, []);
        const title = info.title ? info.title : ctxDate.date ? dateLabel(ctxDate.date, ctxDate.precision) : 'Imported photos';
        add(title, folder, rest, info.ctx, 'folder');
      }
    }
    groups.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || naturalCompare(a.folders[0] || '', b.folders[0] || '') || a.title.localeCompare(b.title));
    groups.forEach((g, i) => { g.sort = i; });
    return groups;
  }

  /** The same content chosen twice (e.g. a copy in another folder): the first stays, the others are listed. */
  function markDuplicates(files) {
    const seen = new Map();
    const kept = [], dups = [];
    for (const f of [...files].sort((a, b) => naturalCompare(a.relativePath, b.relativePath))) {
      const first = seen.get(f.hash);
      if (first) { first.alsoPaths = (first.alsoPaths || []).concat(f.relativePath).slice(0, 20); dups.push({ ...f, duplicateOf: first.relativePath }); }
      else { seen.set(f.hash, f); kept.push(f); }
    }
    return { kept, duplicates: dups };
  }

  // ---------------------------------------------------------------- preview edits (pure; return the new state)
  function nextKey(state) { const n = Math.max(0, ...state.groups.map((g) => +g.key.slice(1) || 0)) + 1; return `g${n}`; }
  const clone = (s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, items: [...g.items], folders: [...g.folders] })), excluded: new Set(s.excluded) });
  const tidy = (s) => { s.groups = s.groups.filter((g) => g.items.length > 0); s.groups.forEach((g, i) => { g.sort = i; }); return s; };

  function normalizeDate(date, precision) {
    if (!date || precision === 'unknown') return { date: null, precision: 'unknown' };
    const m = String(date).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
    if (!m || !okYear(+m[1])) return { date: null, precision: 'unknown' };
    const y = +m[1], mo = m[2] ? +m[2] : 1, d = m[3] ? +m[3] : 1;
    if (precision === 'year' || precision === 'approximate') return { date: iso(y, 1, 1), precision };
    if (!m[2] || mo < 1 || mo > 12) return { date: iso(y, 1, 1), precision: 'year' };
    if (precision === 'month' || precision === 'approximate_month') return { date: iso(y, mo, 1), precision };
    if (!m[3] || !validDay(y, mo, d)) return { date: iso(y, mo, 1), precision: 'month' }; // never invent a day
    return { date: iso(y, mo, d), precision: precision === 'approximate_day' ? 'approximate_day' : 'day' };
  }

  const edits = {
    rename(state, gk, title) {
      const s = clone(state); const g = s.groups.find((x) => x.key === gk);
      const t = String(title || '').trim().slice(0, 200); if (g && t) g.title = t; return s;
    },
    setDate(state, gk, date, precision) {
      const s = clone(state); const g = s.groups.find((x) => x.key === gk);
      if (g) {
        const d = normalizeDate(date, precision); g.date = d.date; g.precision = d.precision; g.dateSource = 'member';
        // What the member picked stays picked while the date is incomplete (e.g. "Month & year" before a month is
        // chosen); only the complete part is recorded, so nothing is invented.
        if (d.precision !== precision) g.chosenPrecision = precision; else delete g.chosenPrecision;
      }
      return s;
    },
    moveItems(state, itemKeys, toGk) {
      const s = clone(state); const keys = new Set(itemKeys);
      const to = s.groups.find((g) => g.key === toGk); if (!to) return state;
      for (const g of s.groups) if (g !== to) {
        const moving = g.items.filter((k) => keys.has(k));
        if (moving.length) { g.items = g.items.filter((k) => !keys.has(k)); for (const k of moving) if (!to.items.includes(k)) to.items.push(k);
          for (const f of g.folders) if (!to.folders.includes(f)) to.folders.push(f); }
      }
      return tidy(s);
    },
    merge(state, gks) {
      const s = clone(state); const [first, ...rest] = gks.map((k) => s.groups.find((g) => g.key === k)).filter(Boolean);
      if (!first) return state;
      for (const g of rest) { for (const k of g.items) if (!first.items.includes(k)) first.items.push(k);
        for (const f of g.folders) if (!first.folders.includes(f)) first.folders.push(f); g.items = []; }
      return tidy(s);
    },
    split(state, gk, itemKeys, title) {
      const s = clone(state); const g = s.groups.find((x) => x.key === gk); if (!g) return state;
      const keys = new Set(itemKeys); const moving = g.items.filter((k) => keys.has(k));
      if (!moving.length || moving.length === g.items.length) return state;
      g.items = g.items.filter((k) => !keys.has(k));
      const ng = { ...g, key: nextKey(s), title: String(title || `${g.title} (2)`).slice(0, 200), items: moving, folders: [...g.folders], origin: 'split' };
      s.groups.splice(s.groups.indexOf(g) + 1, 0, ng);
      return tidy(s);
    },
    exclude(state, itemKeys, excluded = true) {
      const s = clone(state); for (const k of itemKeys) { if (excluded) s.excluded.add(k); else s.excluded.delete(k); } return s;
    },
    excludeGroup(state, gk, excluded = true) {
      const g = state.groups.find((x) => x.key === gk); return g ? edits.exclude(state, g.items, excluded) : state;
    },
    excludeFolder(state, folder, excluded = true) {
      const keys = Object.values(state.items).filter((f) => f.folderPath === folder || f.folderPath.startsWith(folder + '/')).map((f) => f.key);
      return edits.exclude(state, keys, excluded);
    },
  };

  function makeState(files) {
    const items = {}; for (const f of files) items[f.key] = f;
    return { groups: suggestGroups(files), items, excluded: new Set() };
  }

  /** What is sent to dc_import_add_items: included files only, in groups, split into calls of at most [max] files. */
  function itemPayload(f, sortOrder) {
    const metadata = { ...(f.extra || {}) };
    if (f.capture && f.capture.local) metadata.capture_local = f.capture.local;
    if (f.lastModified) metadata.file_modified = new Date(f.lastModified).toISOString();
    return {
      key: f.key, kind: f.kind, mime: f.mime, size: f.size, hash: f.hash, relative_path: f.relativePath,
      original_name: baseName(f.relativePath), folder_path: f.folderPath, also_paths: f.alsoPaths || [],
      duration: f.durationSeconds ? Math.round(f.durationSeconds * 100) / 100 : null,
      captured_at: f.capture ? f.capture.at : null, capture_source: f.capture ? f.capture.source : null,
      width: f.width || null, height: f.height || null, metadata,
      has_display: !!f.canDisplay, has_poster: !!f.canPoster, sort_order: sortOrder,
    };
  }

  /** What is sent to dc_import_add_items: included files only, grouped, at most [max] files per call (a large
   *  memory is sent across several calls under the same group key). */
  function toPayload(state, max = 500) {
    const entries = [];
    state.groups.forEach((g, gi) => {
      g.items.filter((k) => !state.excluded.has(k)).forEach((k, i) => entries.push({ g, gi, item: itemPayload(state.items[k], i) }));
    });
    const calls = [];
    for (let i = 0; i < entries.length; i += max) {
      const groups = [];
      for (const e of entries.slice(i, i + max)) {
        let last = groups[groups.length - 1];
        if (!last || last.key !== e.g.key) {
          last = { key: e.g.key, title: e.g.title, occurred_on: e.g.precision === 'unknown' ? null : e.g.date,
            date_precision: e.g.precision, folder_paths: e.g.folders.slice(0, 50), sort_order: e.gi, items: [] };
          groups.push(last);
        }
        last.items.push(e.item);
      }
      calls.push(groups);
    }
    return calls;
  }

  function summary(state) {
    let photos = 0, videos = 0, bytes = 0;
    for (const g of state.groups) for (const k of g.items) if (!state.excluded.has(k)) {
      const f = state.items[k]; if (f.kind === 'video') videos++; else photos++; bytes += f.size;
    }
    return { groups: state.groups.filter((g) => g.items.some((k) => !state.excluded.has(k))).length, photos, videos, bytes };
  }

  function formatBytes(b) {
    if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
    if (b >= 1048576) return `${(b / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB`;
    return `${Math.max(1, Math.ceil(b / 1024))} KB`;
  }

  async function sha256Hex(buf, subtle) {
    const h = await (subtle || crypto.subtle).digest('SHA-256', buf);
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  return { MAX_BYTES, LIMITS, setLimits, MAX_VIDEO_SECONDS, MAX_FILES, DISPLAY_WIDTH, TYPES, REASONS, parseFolderName, classify,
    checkVideoLength, readJpegExif, readEmbeddedExif, readMp4, readMetadata, exifCapture, suggestGroups, groupDate,
    markDuplicates, makeState, edits, normalizeDate, toPayload, summary, dateLabel, formatBytes, sha256Hex, baseName, dirName };
});
