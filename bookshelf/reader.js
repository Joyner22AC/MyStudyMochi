(() => {
  'use strict';

  const BOOK_ID = 'justice-heart';
  const AAD = 'bookshelf/justice-heart/edition-1';
  const STORAGE = `study-bookshelf:${BOOK_ID}`;
  const THEME_KEY = 'study-notes-theme';
  const PRESETS = {
    clear: {font:100, line:1.8, paragraph:0.55, width:40, margin:2, family:'serif', paper:'follow', align:'left'},
    relaxed: {font:110, line:2, paragraph:0.85, width:38, margin:2.5, family:'serif', paper:'sepia', align:'left'},
    large: {font:135, line:2, paragraph:1, width:34, margin:2, family:'sans', paper:'follow', align:'left'}
  };
  const BACKUP_MAGIC = 'MYSHELFNOTES1';
  const BACKUP_ITERATIONS = 240000;
  const byId = id => document.getElementById(id);

  // Keep the bookshelf in step with the shared notes theme without persisting
  // any book bytes or unlock material.
  function applyPageTheme() {
    let theme;
    try { theme = localStorage.getItem(THEME_KEY); } catch (_) {}
    if (theme !== 'light' && theme !== 'dark') {
      theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = theme;
  }
  applyPageTheme();

  const reader = byId('reading-app');
  const unlockCard = byId('unlock-card');
  if (!reader || !unlockCard) return;

  const status = byId('unlock-status');
  const readerStatus = byId('reader-status');
  const keyInput = byId('key-input');
  const keyFile = byId('key-file');
  const unlockButton = byId('unlock-button');
  const progressBar = byId('reading-progress-bar');
  const progressText = byId('reading-progress-text');
  const tocPanel = byId('toc-panel');
  const tocList = byId('toc-list');
  const bookmarkList = byId('bookmark-list');
  const highlightList = byId('highlight-list');
  const selectionToolbar = byId('selection-toolbar');
  const appearancePanel = byId('appearance-panel');
  const noteDialog = byId('note-dialog');
  let openedBook = null;
  let rendition = null;
  let decryptedBytes = null;
  let bookCryptoKey = null;
  let currentCfi = '';
  let lastLocation = null;
  let readingPrefs = {...PRESETS.clear};
  let activeFlow = 'paginated';
  let locationsReady = false;
  let returnCfi = '';
  let saveTimer = 0;
  let chromeTimer = 0;
  let reflowTimer = 0;
  let feedbackTimer = 0;
  let selectedCfi = '';
  let selectedContents = null;
  let editingNoteCfi = '';
  let activeDrawerTab = 'toc';
  let touchStart = null;
  let lastTurnAt = 0;
  let wheelTurnTimer = 0;
  let wheelAccumulator = 0;
  let wheelGestureTurned = false;
  let activeBookToken = 0;
  let tableOfContents = [];

  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

  function sanitizePrefs(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      font:clamp(value.font, 80, 160, 100),
      line:clamp(value.line, 1.5, 2.2, 1.8),
      paragraph:clamp(value.paragraph, 0, 1.5, 0.55),
      width:clamp(value.width, 30, 52, 40),
      margin:clamp(value.margin, 1, 3, 2),
      family:pick(value.family, ['serif', 'sans'], 'serif'),
      paper:pick(value.paper, ['follow', 'white', 'sepia', 'dark'], 'follow'),
      align:pick(value.align, ['left', 'justify'], 'left')
    };
  }

  function announce(message, duration = 2200) {
    readerStatus.textContent = message;
    clearTimeout(feedbackTimer);
    if (duration) feedbackTimer = setTimeout(() => {
      if (readerStatus.textContent === message) readerStatus.textContent = '';
    }, duration);
  }

  function withTimeout(promise, timeoutMs, label) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeoutMs);
      })
    ]).finally(() => clearTimeout(timer));
  }

  function setStatus(message, kind = 'error') {
    status.textContent = message;
    status.dataset.kind = kind;
    status.hidden = !message;
  }

  function decodeKey(encoded) {
    const normalized = encoded.trim().replace(/^\uFEFF/, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error('InvalidKey');
    const bytes = Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), c => c.charCodeAt(0));
    if (bytes.length !== 32) { bytes.fill(0); throw new Error('InvalidKey'); }
    return bytes;
  }

  function readSaved(name) {
    try { return JSON.parse(localStorage.getItem(`${STORAGE}:${name}`) || 'null'); }
    catch (_) { return null; }
  }

  function writeSaved(name, value) {
    try { localStorage.setItem(`${STORAGE}:${name}`, JSON.stringify(value)); return true; }
    catch (_) { /* Private browsing may disable storage; reading remains available. */ return false; }
  }

  function storeImportedSnapshot(snapshot) {
    const names = ['position', 'bookmarks', 'highlights', 'readingPrefs', 'flow'];
    const values = [snapshot.position, snapshot.bookmarks, snapshot.highlights, snapshot.preferences, snapshot.flow];
    const keys = names.map(name => `${STORAGE}:${name}`);
    const before = keys.map(key => localStorage.getItem(key));
    try {
      keys.forEach((key, index) => localStorage.setItem(key, JSON.stringify(values[index])));
    } catch (error) {
      keys.forEach((key, index) => {
        try {
          if (before[index] === null) localStorage.removeItem(key);
          else localStorage.setItem(key, before[index]);
        } catch (_) {}
      });
      throw error;
    }
  }

  function cleanCfi(value) {
    return typeof value === 'string' && value.startsWith('epubcfi(') && value.length <= 3000 ? value : '';
  }

  function cleanMarks(items, highlights = false) {
    if (!Array.isArray(items) || items.length > 500) throw new Error('InvalidBackup');
    const seen = new Set();
    return items.map(raw => {
      const cfi = cleanCfi(raw?.cfi);
      if (!cfi || seen.has(cfi)) throw new Error('InvalidBackup');
      seen.add(cfi);
      const mark = {
        cfi, label:typeof raw.label === 'string' ? raw.label.slice(0, 180) : '正文',
        percent:clamp(raw.percent, 0, 100, 0)
      };
      if (highlights && raw.noteCipher) {
        const cipher = raw.noteCipher;
        if (typeof cipher.iv !== 'string' || cipher.iv.length > 80 ||
            typeof cipher.data !== 'string' || cipher.data.length > 5000) throw new Error('InvalidBackup');
        mark.noteCipher = {iv:cipher.iv, data:cipher.data};
      }
      return mark;
    });
  }

  function cleanSnapshot(raw) {
    if (!raw || raw.schema !== 1 || raw.book !== BOOK_ID) throw new Error('InvalidBackup');
    const position = raw.position?.cfi ? {
      cfi:cleanCfi(raw.position.cfi),
      percent:clamp(raw.position.percent, 0, 100, 0),
      href:typeof raw.position.href === 'string' ? raw.position.href.slice(0, 500) : ''
    } : null;
    if (position && !position.cfi) throw new Error('InvalidBackup');
    return {
      schema:1, book:BOOK_ID, position,
      bookmarks:cleanMarks(raw.bookmarks || []),
      highlights:cleanMarks(raw.highlights || [], true),
      preferences:sanitizePrefs(raw.preferences),
      flow:raw.flow === 'scrolled-doc' ? 'scrolled-doc' : 'paginated'
    };
  }

  function backupSnapshot() {
    return cleanSnapshot({schema:1, book:BOOK_ID, position:readSaved('position'),
      bookmarks:savedBookmarks(), highlights:savedHighlights(),
      preferences:readingPrefs, flow:activeFlow});
  }

  async function deriveBackupKey(passphrase, salt) {
    const raw = new TextEncoder().encode(passphrase);
    try {
      const source = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
      return await crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256',
        salt, iterations:BACKUP_ITERATIONS}, source, {name:'AES-GCM', length:256}, false, ['encrypt', 'decrypt']);
    } finally { raw.fill(0); }
  }

  async function exportBackup(passphrase) {
    if (passphrase.length < 12) throw new Error('WeakBackupPassword');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveBackupKey(passphrase, salt);
    const plain = new TextEncoder().encode(JSON.stringify(backupSnapshot()));
    let data;
    try {
      data = await crypto.subtle.encrypt({name:'AES-GCM', iv,
        additionalData:new TextEncoder().encode(`${BACKUP_MAGIC}/${BOOK_ID}`)}, key, plain);
    } finally { plain.fill(0); }
    const envelope = {magic:BACKUP_MAGIC, book:BOOK_ID, kdf:'PBKDF2-SHA256',
      iterations:BACKUP_ITERATIONS, salt:toBase64(salt), iv:toBase64(iv),
      data:toBase64(new Uint8Array(data))};
    const url = URL.createObjectURL(new Blob([JSON.stringify(envelope)], {type:'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `MyStudyMochi-${BOOK_ID}-marks.encrypted.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function importBackup(file, passphrase) {
    if (!file || file.size > 1024 * 1024 || passphrase.length < 12) throw new Error('InvalidBackup');
    const envelope = JSON.parse(await file.text());
    if (envelope.magic !== BACKUP_MAGIC || envelope.book !== BOOK_ID ||
        envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== BACKUP_ITERATIONS) throw new Error('InvalidBackup');
    const salt = fromBase64(envelope.salt);
    const iv = fromBase64(envelope.iv);
    const data = fromBase64(envelope.data);
    if (salt.length !== 16 || iv.length !== 12 || data.length < 16 || data.length > 750000) throw new Error('InvalidBackup');
    const key = await deriveBackupKey(passphrase, salt);
    const plain = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv,
      additionalData:new TextEncoder().encode(`${BACKUP_MAGIC}/${BOOK_ID}`)}, key, data));
    let snapshot;
    try { snapshot = cleanSnapshot(JSON.parse(new TextDecoder().decode(plain))); }
    finally { plain.fill(0); }
    for (const mark of snapshot.highlights) {
      if (mark.noteCipher) await decryptNote(mark.cfi, mark.noteCipher);
    }
    const previousHighlights = savedHighlights();
    storeImportedSnapshot(snapshot);
    for (const mark of previousHighlights) {
      try { rendition?.annotations.remove(mark.cfi, 'highlight'); } catch (_) {}
    }
    try { localStorage.removeItem(`${STORAGE}:bookmark`); } catch (_) {}
    readingPrefs = snapshot.preferences;
    renderSettingsControls();
    applyBookTheme();
    applyHighlights();
    showBookmarks();
    showHighlights();
    if (snapshot.flow !== activeFlow) await changeFlow(snapshot.flow);
    if (snapshot.position?.cfi) await jumpTo(snapshot.position.cfi, '标记已导入，但阅读位置无法打开。');
  }

  function showProgress(location) {
    const cfi = location?.start?.cfi || currentCfi;
    let fraction = null;
    if (locationsReady && cfi) {
      try {
        const found = openedBook?.locations?.percentageFromCfi(cfi);
        if (Number.isFinite(found)) fraction = Math.max(0, Math.min(1, found));
      } catch (_) {}
    }
    const percent = fraction === null ? null : Math.round(fraction * 100);
    progressBar.style.width = `${percent ?? 0}%`;
    progressText.textContent = percent === null ? '定位中' : `${percent}%`;
    const scrubber = byId('reading-scrubber');
    scrubber.disabled = percent === null;
    if (!scrubber.matches(':active')) scrubber.value = String(Math.round((fraction ?? 0) * 1000));
    const label = chapterFor(location?.start?.href || '') || '正文';
    byId('chapter-label').textContent = label || '正在阅读';
    currentCfi = cfi;
    const page = location?.start?.displayed?.page;
    const total = location?.start?.displayed?.total;
    const chapterPage = Number.isInteger(page) && Number.isInteger(total) && total > 0
      ? ` · 本节 ${page}/${total}` : '';
    byId('reading-footer').textContent = `${label}${chapterPage} · ${percent === null ? '全书位置计算中' : `全书 ${percent}%`}`;
    lastLocation = {cfi:currentCfi, percent, href:location?.start?.href || ''};
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (lastLocation?.cfi) writeSaved('position', lastLocation);
    }, 220);
  }

  function normalizeHref(href) {
    return String(href || '').split('#')[0].replace(/^\.\//, '');
  }

  function flattenToc(items, out = []) {
    for (const item of items || []) {
      out.push(item);
      if (item.subitems?.length) flattenToc(item.subitems, out);
    }
    return out;
  }

  function chapterFor(href) {
    const needle = normalizeHref(href);
    if (!needle) return '';
    const match = flattenToc(tableOfContents).find(item => normalizeHref(item.href) === needle);
    return match?.label || '';
  }

  function renderToc(items, depth = 0) {
    const list = document.createElement('ol');
    for (const item of items || []) {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toc-item';
      button.textContent = item.label || '未命名章节';
      button.dataset.href = item.href || '';
      button.addEventListener('click', async () => {
        if (!rendition || !item.href) return;
        await jumpTo(item.href, '无法打开这个目录位置。');
      });
      row.append(button);
      if (item.subitems?.length) row.append(renderToc(item.subitems, depth + 1));
      list.append(row);
    }
    return list;
  }

  function setTocCurrent(href) {
    const target = normalizeHref(href);
    tocList.querySelectorAll('.toc-item').forEach(button => {
      const active = normalizeHref(button.dataset.href) === target;
      button.setAttribute('aria-current', String(active));
      if (active) button.scrollIntoView({block:'nearest'});
    });
  }

  async function jumpTo(target, failure = '无法打开这个位置。') {
    if (!rendition || !target) return false;
    const from = currentCfi;
    try {
      await withTimeout(rendition.display(target), 12000, 'JumpTimeout');
      if (from && target !== from) {
        returnCfi = from;
        byId('return-position').hidden = false;
      }
      closeToc();
      closeAppearance();
      return true;
    } catch (_) {
      announce(failure);
      return false;
    }
  }

  function savedBookmarks() {
    const list = readSaved('bookmarks');
    if (Array.isArray(list)) return list;
    const old = readSaved('bookmark');
    return old?.cfi ? [old] : [];
  }

  function showBookmarks() {
    const bookmarks = savedBookmarks();
    bookmarkList.replaceChildren();
    byId('bookmark-button').setAttribute('aria-pressed', String(bookmarks.some(mark => mark.cfi === currentCfi)));
    if (!bookmarks.length) {
      const empty = document.createElement('p');
      empty.className = 'drawer-empty';
      empty.textContent = '还没有书签。阅读时点一下 ☆ 即可保存位置。';
      bookmarkList.append(empty);
      return;
    }
    for (const [index, mark] of bookmarks.entries()) {
      const row = document.createElement('div');
      row.className = 'saved-mark-row';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'saved-mark-open';
      open.textContent = `${mark.label || '阅读位置'} · ${mark.percent ?? 0}%`;
      open.addEventListener('click', async () => {
        await jumpTo(mark.cfi, '无法返回这枚书签。');
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'saved-mark-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `删除书签 ${index + 1}`);
      remove.addEventListener('click', () => {
        const next = savedBookmarks().filter((_, itemIndex) => itemIndex !== index);
        writeSaved('bookmarks', next);
        try { localStorage.removeItem(`${STORAGE}:bookmark`); } catch (_) {}
        showBookmarks();
      });
      row.append(open, remove);
      bookmarkList.append(row);
    }
  }

  function savedHighlights() {
    const list = readSaved('highlights');
    return Array.isArray(list) ? list : [];
  }

  function showHighlights() {
    const highlights = savedHighlights();
    highlightList.replaceChildren();
    if (!highlights.length) {
      const empty = document.createElement('p');
      empty.className = 'drawer-empty';
      empty.textContent = '还没有划线。选中正文后点“标记”即可保存。';
      highlightList.append(empty);
      return;
    }
    for (const [index, mark] of highlights.entries()) {
      const row = document.createElement('div');
      row.className = 'saved-mark-row';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'saved-mark-open';
      open.textContent = `${mark.label || '阅读位置'} · ${mark.percent ?? 0}%${mark.noteCipher ? ' · 有笔记' : ''}`;
      open.addEventListener('click', async () => {
        await jumpTo(mark.cfi, '无法打开这条划线。');
      });
      const note = document.createElement('button');
      note.type = 'button';
      note.className = 'saved-mark-note';
      note.textContent = mark.noteCipher ? '读笔记' : '写笔记';
      note.setAttribute('aria-label', `${note.textContent}：第 ${index + 1} 条划线`);
      note.addEventListener('click', () => openNoteEditor(mark.cfi));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'saved-mark-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `删除第 ${index + 1} 条划线`);
      remove.addEventListener('click', () => removeHighlight(mark.cfi));
      row.append(open, note, remove);
      highlightList.append(row);
    }
  }

  function toBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function fromBase64(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('InvalidBase64');
    return Uint8Array.from(atob(value), char => char.charCodeAt(0));
  }

  async function encryptNote(cfi, note) {
    if (!bookCryptoKey) throw new Error('BookLocked');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(note);
    try {
      const data = await crypto.subtle.encrypt({name:'AES-GCM', iv,
        additionalData:new TextEncoder().encode(`${AAD}/note-v1/${cfi}`)}, bookCryptoKey, plaintext);
      return {iv:toBase64(iv), data:toBase64(new Uint8Array(data))};
    } finally { plaintext.fill(0); }
  }

  async function decryptNote(cfi, cipher) {
    if (!bookCryptoKey) throw new Error('BookLocked');
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',
      iv:fromBase64(cipher.iv), additionalData:new TextEncoder().encode(`${AAD}/note-v1/${cfi}`)},
    bookCryptoKey, fromBase64(cipher.data)));
    try { return new TextDecoder().decode(plaintext); }
    finally { plaintext.fill(0); }
  }

  async function openNoteEditor(cfi) {
    const mark = savedHighlights().find(item => item.cfi === cfi);
    if (!mark) return;
    editingNoteCfi = cfi;
    byId('note-location').textContent = `${mark.label || '正文'} · ${mark.percent ?? 0}%`;
    byId('note-text').value = '';
    if (mark.noteCipher) {
      try { byId('note-text').value = await decryptNote(cfi, mark.noteCipher); }
      catch (_) { announce('这条笔记无法解密；划线仍保留，请检查是否使用了原书密钥。', 5000); return; }
    }
    closeAppearance();
    if (reader.classList.contains('toc-open')) closeToc();
    if (!noteDialog.open) noteDialog.showModal();
    byId('note-text').focus();
  }

  async function saveNote() {
    const text = byId('note-text').value.trim();
    const marks = savedHighlights();
    const mark = marks.find(item => item.cfi === editingNoteCfi);
    if (!mark) return;
    try {
      if (text) mark.noteCipher = await encryptNote(mark.cfi, text.slice(0, 500));
      else delete mark.noteCipher;
      if (!writeSaved('highlights', marks)) throw new Error('StorageUnavailable');
      showHighlights();
      noteDialog.close();
      announce(text ? '笔记已加密保存在本机' : '已清空这条笔记');
    } catch (_) { announce('笔记保存失败，请重试。'); }
  }

  function applyHighlights() {
    if (!rendition?.annotations) return;
    for (const mark of savedHighlights()) {
      try { rendition.annotations.highlight(mark.cfi, {}, () => openNoteEditor(mark.cfi)); } catch (_) {}
    }
  }

  function removeHighlight(cfi) {
    try { rendition?.annotations.remove(cfi, 'highlight'); } catch (_) {}
    writeSaved('highlights', savedHighlights().filter(mark => mark.cfi !== cfi));
    if (editingNoteCfi === cfi && noteDialog.open) noteDialog.close();
    showHighlights();
  }

  function addHighlight(openNote = false) {
    if (!selectedCfi || !rendition?.annotations) return;
    const cfi = selectedCfi;
    const marks = savedHighlights();
    if (!marks.some(mark => mark.cfi === cfi)) {
      const href = lastLocation?.href || '';
      marks.push({cfi, label:chapterFor(href) || '正文', percent:lastLocation?.percent || 0});
      if (!writeSaved('highlights', marks)) { announce('本机存储不可用，划线未保存。'); return; }
      try { rendition.annotations.highlight(cfi, {}, () => openNoteEditor(cfi)); } catch (_) {}
      showHighlights();
      announce('划线已保存在本机浏览器');
    }
    try { selectedContents?.window?.getSelection()?.removeAllRanges(); } catch (_) {}
    selectionToolbar.hidden = true;
    selectedCfi = '';
    selectedContents = null;
    if (openNote) openNoteEditor(cfi);
  }

  function closeToc() {
    reader.classList.remove('toc-open');
    byId('toc-backdrop').hidden = true;
    byId('toc-toggle').setAttribute('aria-expanded', 'false');
    tocPanel.setAttribute('aria-hidden', 'true');
    tocPanel.inert = true;
    byId('toc-toggle').focus({preventScroll:true});
  }

  function closeAppearance(restoreFocus = false) {
    appearancePanel.hidden = true;
    appearancePanel.setAttribute('aria-hidden', 'true');
    byId('appearance-toggle').setAttribute('aria-expanded', 'false');
    if (restoreFocus) byId('appearance-toggle').focus({preventScroll:true});
  }

  function toggleAppearance(open = appearancePanel.hidden) {
    if (!open) { closeAppearance(true); return; }
    if (reader.classList.contains('toc-open')) closeToc();
    appearancePanel.hidden = false;
    appearancePanel.setAttribute('aria-hidden', 'false');
    byId('appearance-toggle').setAttribute('aria-expanded', 'true');
    showChrome();
    byId('appearance-close').focus({preventScroll:true});
  }

  function toggleToc(open = !reader.classList.contains('toc-open')) {
    if (open) closeAppearance();
    reader.classList.toggle('toc-open', open);
    byId('toc-backdrop').hidden = !open;
    byId('toc-toggle').setAttribute('aria-expanded', String(open));
    tocPanel.setAttribute('aria-hidden', String(!open));
    tocPanel.inert = !open;
    if (open) {
      selectionToolbar.hidden = true;
      switchDrawerTab(activeDrawerTab);
      showChrome();
      byId('toc-close').focus({preventScroll:true});
    }
  }

  function switchDrawerTab(tab) {
    activeDrawerTab = tab;
    document.querySelectorAll('[data-reader-tab]').forEach(button => {
      button.setAttribute('aria-selected', String(button.dataset.readerTab === tab));
    });
    document.querySelectorAll('[data-reader-panel]').forEach(panel => {
      panel.hidden = panel.dataset.readerPanel !== tab;
    });
    if (tab === 'bookmarks') showBookmarks();
    if (tab === 'highlights') showHighlights();
  }

  function showChrome() {
    reader.classList.add('chrome-visible');
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(() => {
      if (!reader.classList.contains('toc-open') && appearancePanel.hidden && selectionToolbar.hidden && !reader.querySelector('.reader-toolbar :focus')) {
        reader.classList.remove('chrome-visible');
      }
    }, 2600);
  }

  function showPageFeedback() {
    const feedback = byId('page-feedback');
    feedback.textContent = byId('reading-footer').textContent;
    feedback.hidden = false;
    clearTimeout(feedback._timer);
    feedback._timer = setTimeout(() => { feedback.hidden = true; }, 1250);
  }

  function turnPage(direction) {
    if (!rendition) return;
    const action = direction < 0 ? rendition.prev() : rendition.next();
    Promise.resolve(action).then(showPageFeedback).catch(() => announce('翻页没有完成，请稍后再试。'));
  }

  function selectedTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (_) {}
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function applyBookTheme() {
    if (!rendition) return;
    try { rendition.themes.select(selectedTheme()); } catch (_) {}
    applyReadingStyles();
  }

  function effectivePaper() {
    return readingPrefs.paper === 'follow' ? (selectedTheme() === 'dark' ? 'dark' : 'white') : readingPrefs.paper;
  }

  function readingStyleText() {
    const paper = effectivePaper();
    const colors = paper === 'dark' ? {bg:'#20242a', ink:'#e4e7e9', link:'#9bcced'}
      : paper === 'sepia' ? {bg:'#f5eddd', ink:'#353027', link:'#73582f'}
      : {bg:'#fdfdfb', ink:'#30343a', link:'#356e9b'};
    const family = readingPrefs.family === 'sans'
      ? '"Noto Sans CJK SC","Microsoft YaHei",sans-serif'
      : 'Georgia,"Noto Serif CJK SC","Songti SC",serif';
    reader.dataset.paper = paper;
    reader.style.setProperty('--reader-paper', colors.bg);
    reader.style.setProperty('--reader-page-width', `${readingPrefs.width + readingPrefs.margin * 2}rem`);
    // epub.js owns the paginated body's width, columns, gap and padding. Constraining
    // that body to a prose width makes multiple EPUB columns visible at once.
    const layout = activeFlow === 'paginated'
      ? 'max-width:none!important;margin:0!important'
      : `max-width:${readingPrefs.width}rem!important;margin-left:auto!important;margin-right:auto!important;padding:4.2rem ${readingPrefs.margin}rem 5rem!important;box-sizing:border-box!important`;
    return `html{background:${colors.bg}!important}body{color:${colors.ink}!important;background:${colors.bg}!important;font-family:${family}!important;line-height:${readingPrefs.line}!important;${layout};text-align:${readingPrefs.align}!important;overflow-wrap:break-word}body p,body li{line-height:${readingPrefs.line}!important;margin-bottom:${readingPrefs.paragraph}em!important;text-align:${readingPrefs.align}!important}body a{color:${colors.link}!important}img,svg{max-width:100%!important}`;
  }

  function applyStyleToDocument(doc) {
    if (!doc?.head) return;
    let style = doc.getElementById('my-study-reader-style');
    if (!style) {
      style = doc.createElement('style');
      style.id = 'my-study-reader-style';
      doc.head.append(style);
    }
    style.textContent = readingStyleText();
  }

  function applyReadingStyles() {
    if (!rendition) return;
    readingStyleText();
    try { rendition.themes.fontSize(`${readingPrefs.font}%`); } catch (_) {}
    document.querySelectorAll('#epub-viewer iframe').forEach(frame => {
      try { applyStyleToDocument(frame.contentDocument); } catch (_) {}
    });
  }

  function renderSettingsControls() {
    const values = {
      font:[readingPrefs.font, `${readingPrefs.font}%`],
      line:[readingPrefs.line, readingPrefs.line.toFixed(2)],
      paragraph:[readingPrefs.paragraph, `${readingPrefs.paragraph.toFixed(1)}em`],
      width:[readingPrefs.width, `${readingPrefs.width}rem`],
      margin:[readingPrefs.margin, `${readingPrefs.margin}rem`]
    };
    for (const [name, [value, label]] of Object.entries(values)) {
      byId(`setting-${name}`).value = String(value);
      byId(`setting-${name}-value`).textContent = label;
    }
    for (const name of ['family', 'paper', 'align']) byId(`setting-${name}`).value = readingPrefs[name];
    byId('reading-flow').value = activeFlow;
    document.querySelectorAll('[data-reading-preset]').forEach(button => {
      const preset = PRESETS[button.dataset.readingPreset];
      const selected = Object.keys(preset).every(key => readingPrefs[key] === preset[key]);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function reflowAtCurrentPosition() {
    clearTimeout(reflowTimer);
    const anchor = currentCfi;
    reflowTimer = setTimeout(async () => {
      if (!rendition || !anchor) return;
      try {
        const viewer = byId('epub-viewer');
        if (activeFlow === 'paginated' && rendition.manager?.settings) {
          // Keep epub.js's internal column gap in step with the margin control.
          rendition.manager.settings.gap = Math.round(readingPrefs.margin * 32);
          rendition.manager.updateLayout();
        }
        rendition.resize(viewer.clientWidth, viewer.clientHeight);
        await withTimeout(rendition.display(anchor), 12000, 'ReflowTimeout');
      } catch (_) { announce('排版已更新；若位置偏移，可用书签返回。'); }
    }, 280);
  }

  function updateReadingPrefs(patch) {
    readingPrefs = sanitizePrefs({...readingPrefs, ...patch});
    writeSaved('readingPrefs', readingPrefs);
    renderSettingsControls();
    applyReadingStyles();
    reflowAtCurrentPosition();
  }

  function installBookThemes() {
    rendition.themes.register('light', {
      body: { color:'#30343a', background:'#fff', 'font-family':'Georgia,"Noto Serif CJK SC","Songti SC",serif', 'font-size':'1em', 'line-height':'1.9' },
      'p, li': { 'line-height':'1.9' },
      'img, svg': { 'max-width':'100%' }
    });
    rendition.themes.register('dark', {
      body: { color:'#d8dde2', background:'#20242a', 'font-family':'Georgia,"Noto Serif CJK SC","Songti SC",serif', 'font-size':'1em', 'line-height':'1.9' },
      'p, li': { 'line-height':'1.9' },
      'a': { color:'#91c5e7' },
      'img, svg': { 'max-width':'100%' }
    });
    rendition.themes.default({
      '::selection': {background:'rgba(246,205,91,.38)'},
      '.epubjs-hl': {fill:'rgba(246,205,91,.62)', 'fill-opacity':'0.62', 'mix-blend-mode':'multiply'}
    });
    rendition.hooks.content.register(contents => applyStyleToDocument(contents.document));
    applyBookTheme();
  }

  function readSavedPreferences() {
    const saved = readSaved('readingPrefs');
    readingPrefs = sanitizePrefs(saved || {...PRESETS.clear, font:readSaved('font') || 100});
    activeFlow = readSaved('flow') === 'scrolled-doc' ? 'scrolled-doc' : 'paginated';
    readingStyleText();
    renderSettingsControls();
  }

  async function changeFlow(nextFlow) {
    if (!rendition) return false;
    nextFlow = nextFlow === 'scrolled-doc' ? 'scrolled-doc' : 'paginated';
    if (nextFlow === activeFlow) return true;
    const previousFlow = activeFlow;
    const resumeCfi = currentCfi || readSaved('position')?.cfi;
    activeFlow = nextFlow;
    reader.dataset.flow = nextFlow;
    applyReadingStyles();
    wheelAccumulator = 0;
    wheelGestureTurned = false;
    clearTimeout(wheelTurnTimer);
    try {
      if (rendition.manager?.settings) rendition.manager.settings.gap = Math.round(readingPrefs.margin * 32);
      rendition.flow(nextFlow);
      const viewer = byId('epub-viewer');
      rendition.resize(viewer.clientWidth, viewer.clientHeight);
      await withTimeout(rendition.display(resumeCfi || undefined), 12000, 'FlowChangeTimeout');
      writeSaved('flow', nextFlow);
      renderSettingsControls();
      announce(nextFlow === 'paginated' ? '分页：滚轮翻页' : '连续：滚轮自然滚动');
      return true;
    } catch (_) {
      activeFlow = previousFlow;
      reader.dataset.flow = previousFlow;
      applyReadingStyles();
      try {
        rendition.flow(previousFlow);
        const viewer = byId('epub-viewer');
        rendition.resize(viewer.clientWidth, viewer.clientHeight);
        await withTimeout(rendition.display(resumeCfi || undefined), 12000, 'FlowRestoreTimeout');
      } catch (_) {}
      renderSettingsControls();
      announce('切换阅读方式失败，已保留原模式。');
      return false;
    }
  }

  function createRendition(bookToken) {
    rendition = openedBook.renderTo('epub-viewer', {
      width:'100%', height:'100%', flow:activeFlow, spread:'none',
      gap:Math.round(readingPrefs.margin * 32),
      allowScriptedContent:false, allowPopups:false, resizeOnOrientationChange:true
    });
    installBookThemes();
    reader.dataset.flow = activeFlow;
    byId('reading-flow').value = activeFlow;
    rendition.themes.fontSize(`${readingPrefs.font}%`);
    rendition.on('relocated', location => {
      if (bookToken !== activeBookToken) return;
      showProgress(location);
      setTocCurrent(location?.start?.href || '');
    });
    rendition.on('selected', (cfiRange, contents) => {
      selectedCfi = cfiRange || '';
      selectedContents = contents || null;
      selectionToolbar.hidden = !selectedCfi;
      if (selectedCfi) showChrome();
    });
    rendition.on('rendered', (_section, view) => {
      const doc = view?.contents?.document;
      if (!doc || doc.documentElement.dataset.pageTurnReady) return;
      doc.documentElement.dataset.pageTurnReady = 'true';
      applyStyleToDocument(doc);
      doc.addEventListener('wheel', event => {
        if (activeFlow !== 'paginated' || event.ctrlKey) return;
        event.preventDefault();
        clearTimeout(wheelTurnTimer);
        wheelTurnTimer = setTimeout(() => {
          wheelTurnTimer = 0;
          wheelAccumulator = 0;
          wheelGestureTurned = false;
        }, 260);
        if (wheelGestureTurned) return;
        const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 180 : event.deltaY;
        wheelAccumulator += delta;
        if (Math.abs(wheelAccumulator) < 24) return;
        const direction = wheelAccumulator > 0 ? 1 : -1;
        wheelAccumulator = 0;
        wheelGestureTurned = true;
        turnPage(direction);
      }, {passive:false});
      doc.addEventListener('pointerup', event => {
        if (event.button !== 0 || !selectionToolbar.hidden || noteDialog.open) return;
        if (doc.defaultView?.getSelection()?.toString().trim()) return;
        if (event.target?.closest?.('a,button,input,textarea,select,[role="button"]')) return;
        const width = doc.defaultView?.innerWidth || 0;
        const height = doc.defaultView?.innerHeight || 0;
        if (event.clientX > width * .28 && event.clientX < width * .72 &&
            event.clientY > height * .18 && event.clientY < height * .82) {
          if (reader.classList.contains('chrome-visible')) reader.classList.remove('chrome-visible');
          else showChrome();
        }
      });
      doc.addEventListener('keydown', handleReaderKeydown);
      doc.addEventListener('touchstart', event => {
        const point = event.changedTouches?.[0];
        if (point) touchStart = {x:point.clientX, y:point.clientY, at:Date.now()};
      }, {passive:true});
      doc.addEventListener('touchend', event => {
        const point = event.changedTouches?.[0];
        if (!point || !touchStart || Date.now() - touchStart.at > 900) return;
        const dx = point.clientX - touchStart.x;
        const dy = point.clientY - touchStart.y;
        touchStart = null;
        if (activeFlow === 'paginated' && Math.abs(dx) > 54 && Math.abs(dx) > Math.abs(dy) * 1.25) turnPage(dx > 0 ? -1 : 1);
      }, {passive:true});
    });
    return rendition;
  }

  async function openBook(buffer) {
    if (typeof window.ePub !== 'function') throw new Error('ReaderUnavailable');
    if (typeof window.JSZip !== 'function') throw new Error('ZipLibraryUnavailable');
    // epub.js 0.3.88 can fail to initialize when an ArrayBuffer is passed
    // to the constructor. Open the decrypted bytes through Book.open instead.
    const bookToken = ++activeBookToken;
    locationsReady = false;
    returnCfi = '';
    byId('return-position').hidden = true;
    openedBook = window.ePub();
    await withTimeout(openedBook.open(buffer), 20000, 'BookOpenTimeout');
    const [navigation, metadata] = await withTimeout(Promise.all([
      openedBook.loaded.navigation,
      openedBook.loaded.metadata
    ]), 12000, 'BookMetadataTimeout');
    tableOfContents = navigation?.toc || [];
    tocList.replaceChildren(renderToc(tableOfContents));
    if (!tableOfContents.length) {
      const empty = document.createElement('p');
      empty.className = 'shelf-note';
      empty.textContent = '这本书没有可解析的目录。';
      tocList.append(empty);
    }
    toggleToc(false);

    byId('chapter-label').textContent = metadata?.title || '正文';
    byId('reading-app').hidden = false;
    unlockCard.hidden = true;
    document.body.classList.add('is-reading');
    readerStatus.textContent = '正在打开书籍…';
    createRendition(bookToken);
    const saved = readSaved('position');
    try {
      await withTimeout(rendition.display(saved?.cfi || undefined), 15000, 'BookDisplayTimeout');
    } catch (error) {
      if (!saved?.cfi) throw error;
      // A stale or malformed saved CFI should not trap the reader at the loading screen.
      writeSaved('position', null);
      readerStatus.textContent = '上次阅读位置无法恢复，正在从书首页打开…';
      try { rendition.destroy(); } catch (_) {}
      createRendition(bookToken);
      await withTimeout(rendition.display(), 15000, 'BookDisplayTimeout');
    }
    if (bookToken !== activeBookToken) return;
    applyHighlights();
    showBookmarks();
    showHighlights();
    reader.classList.add('chrome-visible');
    showChrome();
    readerStatus.textContent = '已打开。分页模式滚轮翻页；连续模式滚轮滚动。';
    setTimeout(() => { if (readerStatus.textContent.startsWith('已打开。')) readerStatus.textContent = ''; }, 2600);
    // Location generation can be expensive; do not block the first page on the progress index.
    openedBook.locations.generate(1500).then(async () => {
      if (bookToken !== activeBookToken || !rendition) return;
      locationsReady = true;
      const location = await rendition.currentLocation();
      if (location) showProgress(location);
    }).catch(() => { byId('reading-scrubber').disabled = true; });
  }

  async function unlock(credential) {
    if (unlockButton.disabled) return;
    unlockButton.disabled = true;
    setStatus('正在读取加密书籍并在本机验证…', 'info');
    let keyBytes;
    let sealed;
    let phase = 'key';
    try {
      let importedKey;
      if (typeof credential === 'string') {
        keyBytes = decodeKey(credential);
        importedKey = await crypto.subtle.importKey('raw', keyBytes, {name:'AES-GCM'}, false, ['decrypt', 'encrypt']);
        keyBytes.fill(0);
        keyBytes = null;
      } else if (credential?.algorithm?.name === 'AES-GCM' &&
                 credential.extractable === false &&
                 credential.usages?.includes('decrypt') && credential.usages?.includes('encrypt')) {
        importedKey = credential;
      } else {
        throw new Error('InvalidKey');
      }
      phase = 'download';
      const response = await withTimeout(fetch('books/justice-heart.epub.enc', {
        cache:'no-store', credentials:'same-origin'
      }), 20000, 'DownloadTimeout');
      if (!response.ok) throw new Error('CiphertextUnavailable');
      sealed = new Uint8Array(await withTimeout(response.arrayBuffer(), 15000, 'DownloadTimeout'));
      if (sealed.length < 36 || new TextDecoder().decode(sealed.subarray(0,8)) !== 'MYBOOK01') {
        sealed.fill(0);
        throw new Error('InvalidCiphertext');
      }
      phase = 'decrypt';
      decryptedBytes = await crypto.subtle.decrypt({
        name:'AES-GCM', iv:sealed.subarray(8,20), additionalData:new TextEncoder().encode(AAD), tagLength:128
      }, importedKey, sealed.subarray(20));
      bookCryptoKey = importedKey;
      setStatus('', 'info');
      readSavedPreferences();
      phase = 'epub';
      await openBook(decryptedBytes);
    } catch (error) {
      if (keyBytes) keyBytes.fill(0);
      if (decryptedBytes) new Uint8Array(decryptedBytes).fill(0);
      decryptedBytes = null;
      bookCryptoKey = null;
      activeBookToken += 1;
      if (rendition) { try { rendition.destroy(); } catch (_) {} }
      if (openedBook) { try { openedBook.destroy(); } catch (_) {} }
      openedBook = null; rendition = null;
      byId('backup-passphrase').value = '';
      byId('backup-file').value = '';
      document.body.classList.remove('is-reading');
      reader.classList.remove('toc-open', 'chrome-visible');
      byId('reading-app').hidden = true;
      unlockCard.hidden = false;
      const message = error?.name === 'OperationError'
        ? '密钥不正确，或加密文件校验失败。'
        : error?.message === 'InvalidKey'
          ? '密钥格式不正确，请使用配套的 43 位 Base64URL 密钥。'
          : error?.message === 'ReaderUnavailable'
            ? '阅读组件尚未加载完成，请刷新页面重试。'
            : error?.message === 'ZipLibraryUnavailable'
              ? 'EPUB 压缩包组件尚未加载，请刷新页面重试。'
            : phase === 'download'
              ? '加密书籍下载失败，请检查网络后重试。'
              : phase === 'epub'
                ? error?.message === 'BookDisplayTimeout'
                  ? '打开书页超时，阅读器已退出。请重新解锁；若再次发生，请反馈此提示。'
                  : error?.message === 'BookOpenTimeout' || error?.message === 'BookMetadataTimeout'
                    ? '书籍解析超时，阅读器已退出。请重新解锁；若再次发生，请反馈此提示。'
                    : '密钥验证已通过，但 EPUB 解析失败。阅读器已退出，请重试；若仍失败，请反馈此提示。'
                : '解锁过程中发生错误，请检查密钥格式后重试。';
      setStatus(message);
    } finally {
      sealed?.fill(0);
      keyInput.value = '';
      unlockButton.disabled = false;
    }
  }

  // Same-origin home scene keeps a non-extractable CryptoKey in this tab's
  // memory. The embedded reader may receive it without URL or storage secrets.
  window.addEventListener('message', event => {
    if (window.parent === window || event.source !== window.parent || event.origin !== location.origin ||
        event.data?.type !== 'mystudy:unlock-book' || !reader.hidden || unlockButton.disabled) return;
    unlock(event.data.key);
  });

  async function lockBook() {
    activeBookToken += 1;
    clearTimeout(saveTimer);
    clearTimeout(reflowTimer);
    clearTimeout(wheelTurnTimer);
    locationsReady = false;
    wheelGestureTurned = false;
    wheelAccumulator = 0;
    returnCfi = '';
    if (lastLocation?.cfi) writeSaved('position', lastLocation);
    if (noteDialog.open) noteDialog.close();
    closeAppearance();
    byId('backup-passphrase').value = '';
    byId('backup-file').value = '';
    try { rendition?.destroy(); } catch (_) {}
    try { openedBook?.destroy(); } catch (_) {}
    rendition = null;
    openedBook = null;
    if (decryptedBytes) new Uint8Array(decryptedBytes).fill(0);
    decryptedBytes = null;
    bookCryptoKey = null;
    tableOfContents = [];
    currentCfi = '';
    lastLocation = null;
    tocList.replaceChildren();
    reader.hidden = true;
    document.body.classList.remove('is-reading');
    unlockCard.hidden = false;
    reader.classList.remove('toc-open');
    selectionToolbar.hidden = true;
    keyInput.focus({preventScroll:true});
  }

  byId('unlock-form').addEventListener('submit', event => {
    event.preventDefault();
    unlock(keyInput.value);
  });
  keyFile.addEventListener('change', async () => {
    const file = keyFile.files?.[0];
    if (!file) return;
    try {
      const text = new TextDecoder().decode(await file.arrayBuffer()).trim();
      await unlock(text);
    } catch (_) {
      setStatus('无法读取密钥文件，请选择本机 .txt 密钥文件。');
    } finally { keyFile.value = ''; }
  });

  byId('previous-page').addEventListener('click', () => turnPage(-1));
  byId('next-page').addEventListener('click', () => turnPage(1));
  byId('toc-toggle').addEventListener('click', () => toggleToc());
  byId('toc-close').addEventListener('click', () => closeToc());
  byId('toc-backdrop').addEventListener('click', () => closeToc());
  byId('appearance-toggle').addEventListener('click', () => toggleAppearance());
  byId('appearance-close').addEventListener('click', () => closeAppearance(true));
  reader.addEventListener('pointerdown', event => {
    if (!appearancePanel.hidden && !appearancePanel.contains(event.target) &&
        !byId('appearance-toggle').contains(event.target)) closeAppearance();
  });
  byId('return-position').addEventListener('click', async () => {
    const target = returnCfi;
    if (!target || !rendition) return;
    try {
      await rendition.display(target);
      returnCfi = '';
      byId('return-position').hidden = true;
      announce('已返回原来的阅读位置');
    } catch (_) { announce('无法返回原来的阅读位置。'); }
  });
  document.querySelectorAll('[data-reader-tab]').forEach(button => {
    button.addEventListener('click', () => switchDrawerTab(button.dataset.readerTab));
  });
  byId('lock-button').addEventListener('click', lockBook);
  byId('lock-from-toc').addEventListener('click', lockBook);
  byId('add-highlight').addEventListener('click', () => addHighlight(false));
  byId('add-note-from-selection').addEventListener('click', () => addHighlight(true));
  byId('dismiss-selection').addEventListener('click', () => {
    selectionToolbar.hidden = true;
    selectedCfi = '';
    selectedContents = null;
  });
  byId('note-form').addEventListener('submit', event => {
    event.preventDefault();
    saveNote();
  });
  byId('note-cancel').addEventListener('click', () => noteDialog.close());
  byId('note-delete-highlight').addEventListener('click', () => removeHighlight(editingNoteCfi));
  noteDialog.addEventListener('close', () => { byId('note-text').value = ''; editingNoteCfi = ''; });
  byId('fullscreen-button').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await reader.requestFullscreen();
    } catch (_) {
      readerStatus.textContent = '浏览器未允许全屏；阅读器仍会铺满页面。';
      setTimeout(() => { readerStatus.textContent = ''; }, 1800);
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    byId('fullscreen-button').setAttribute('aria-label', active ? '退出浏览器全屏' : '进入浏览器全屏');
    byId('fullscreen-button').title = active ? '退出全屏' : '全屏阅读';
    showChrome();
  });
  byId('reading-scrubber').addEventListener('input', event => {
    const percent = Math.round(Number(event.target.value) / 10);
    const preview = byId('scrub-preview');
    preview.textContent = `松开后前往全书约 ${percent}%`;
    preview.hidden = false;
  });
  byId('reading-scrubber').addEventListener('change', async event => {
    byId('scrub-preview').hidden = true;
    if (!locationsReady) return;
    const fraction = Number(event.target.value) / 1000;
    const cfi = openedBook?.locations?.cfiFromPercentage(fraction);
    if (cfi) await jumpTo(cfi, '无法跳到这个进度。');
    showChrome();
  });
  document.querySelectorAll('[data-reading-preset]').forEach(button => {
    button.addEventListener('click', () => updateReadingPrefs(PRESETS[button.dataset.readingPreset]));
  });
  for (const name of ['font', 'line', 'paragraph', 'width', 'margin']) {
    byId(`setting-${name}`).addEventListener('input', event => updateReadingPrefs({[name]:Number(event.target.value)}));
  }
  for (const name of ['family', 'paper', 'align']) {
    byId(`setting-${name}`).addEventListener('change', event => updateReadingPrefs({[name]:event.target.value}));
  }
  byId('reading-flow').addEventListener('change', event => changeFlow(event.target.value));
  byId('backup-export').addEventListener('click', async event => {
    const button = event.currentTarget;
    const password = byId('backup-passphrase');
    button.disabled = true;
    try {
      await exportBackup(password.value);
      byId('backup-status').textContent = '已下载加密备份；请妥善保存密码。';
    } catch (_) { byId('backup-status').textContent = '导出失败：密码至少 12 位，且浏览器需支持本机加密。'; }
    finally { password.value = ''; button.disabled = false; }
  });
  byId('backup-import').addEventListener('click', async event => {
    const button = event.currentTarget;
    const password = byId('backup-passphrase');
    const file = byId('backup-file');
    button.disabled = true;
    try {
      await importBackup(file.files?.[0], password.value);
      byId('backup-status').textContent = '已导入本机标记，并覆盖此前的阅读位置、书签与划线。';
    } catch (_) { byId('backup-status').textContent = '导入失败：请检查备份文件、密码和书籍密钥；原本机标记尽量保持不变。'; }
    finally { password.value = ''; file.value = ''; button.disabled = false; }
  });
  byId('bookmark-button').addEventListener('click', () => {
    if (!currentCfi) return;
    const bookmarks = savedBookmarks();
    const existing = bookmarks.findIndex(mark => mark.cfi === currentCfi);
    if (existing >= 0) bookmarks.splice(existing, 1);
    else bookmarks.push({cfi:currentCfi,percent:lastLocation?.percent || 0,label:chapterFor(lastLocation?.href || '') || '正文'});
    writeSaved('bookmarks', bookmarks);
    try { localStorage.removeItem(`${STORAGE}:bookmark`); } catch (_) {}
    showBookmarks();
    readerStatus.textContent = existing >= 0 ? '已移除此处书签' : '书签已保存到本机浏览器';
    setTimeout(() => { readerStatus.textContent = ''; }, 1500);
  });

  reader.addEventListener('pointermove', event => {
    if (event.clientY < 82) showChrome();
  });
  reader.addEventListener('pointerdown', event => {
    if (event.clientY < 82) showChrome();
  });
  reader.addEventListener('focusin', showChrome);

  function handleReaderKeydown(event) {
    if (!rendition || event.altKey || event.ctrlKey || event.metaKey) return;
    const tag = event.target?.tagName;
    if (noteDialog.open) return;
    if (event.key === 'Escape') {
      if (!selectionToolbar.hidden) { selectionToolbar.hidden = true; selectedCfi = ''; selectedContents = null; }
      else if (reader.classList.contains('toc-open')) closeToc();
      else if (!appearancePanel.hidden) closeAppearance(true);
      else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      return;
    }
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (event.key === 'Tab' && reader.classList.contains('toc-open')) {
      const focusable = [...tocPanel.querySelectorAll('button:not(:disabled), .toc-item')]
        .filter(element => !element.closest('[hidden]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      return;
    }
    if (reader.classList.contains('toc-open') && tocPanel.contains(event.target) && event.key !== 'Escape') return;
    if (event.key === ' ' && tag === 'BUTTON') return;
    if (activeFlow === 'paginated') {
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); turnPage(-1); }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); turnPage(1); }
    }
  }
  document.addEventListener('keydown', handleReaderKeydown);

  window.addEventListener('storage', event => {
    if (event.key !== THEME_KEY) return;
    applyPageTheme();
    applyBookTheme();
  });
  new MutationObserver(applyBookTheme).observe(document.documentElement, {
    attributes:true, attributeFilter:['data-theme']
  });
  window.addEventListener('pagehide', () => {
    activeBookToken += 1;
    clearTimeout(saveTimer);
    clearTimeout(reflowTimer);
    try { rendition?.destroy(); } catch (_) {}
    try { openedBook?.destroy(); } catch (_) {}
    if (decryptedBytes) new Uint8Array(decryptedBytes).fill(0);
    decryptedBytes = null;
    bookCryptoKey = null;
  });
})();
