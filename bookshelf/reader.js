(() => {
  'use strict';

  const BOOK_ID = 'justice-heart';
  const AAD = 'bookshelf/justice-heart/edition-1';
  const STORAGE = `study-bookshelf:${BOOK_ID}`;
  const THEME_KEY = 'study-notes-theme';
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
  const bookmarkSlot = byId('bookmark-slot');
  let openedBook = null;
  let rendition = null;
  let decryptedBytes = null;
  let currentCfi = '';
  let lastLocation = null;
  let fontPercent = 100;
  let activeFlow = 'paginated';
  let saveTimer = 0;
  let tableOfContents = [];

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
    try { localStorage.setItem(`${STORAGE}:${name}`, JSON.stringify(value)); }
    catch (_) { /* Private browsing may disable storage; reading remains available. */ }
  }

  function showProgress(location) {
    const fraction = Math.max(0, Math.min(1, Number(location?.start?.percentage) || 0));
    const percent = Math.round(fraction * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${percent}%`;
    const label = chapterFor(location?.start?.href || '');
    byId('chapter-label').textContent = label || '正在阅读';
    currentCfi = location?.start?.cfi || currentCfi;
    lastLocation = { cfi: currentCfi, percent, href:location?.start?.href || '' };
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
        try {
          await rendition.display(item.href);
          closeToc();
        } catch (_) {
          readerStatus.textContent = '无法打开这个目录位置。';
        }
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

  function showBookmark() {
    const mark = readSaved('bookmark');
    bookmarkSlot.replaceChildren();
    bookmarkSlot.hidden = !mark?.cfi;
    byId('bookmark-button').setAttribute('aria-pressed', String(Boolean(mark?.cfi)));
    if (!mark?.cfi) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bookmark-open';
    button.textContent = `书签 · ${mark.label || '已保存位置'} · ${mark.percent ?? 0}%`;
    button.addEventListener('click', async () => {
      if (rendition) await rendition.display(mark.cfi);
      closeToc();
    });
    bookmarkSlot.append(button);
  }

  function closeToc() {
    if (!matchMedia('(max-width:650px)').matches) return;
    reader.classList.remove('toc-open');
    byId('toc-backdrop').hidden = true;
    byId('toc-toggle').setAttribute('aria-expanded', 'false');
  }

  function toggleToc(open = !reader.classList.contains('toc-open')) {
    reader.classList.toggle('toc-open', open);
    const small = matchMedia('(max-width:650px)').matches;
    byId('toc-backdrop').hidden = !open || !small;
    byId('toc-toggle').setAttribute('aria-expanded', String(open));
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
    const theme = selectedTheme();
    try { rendition.themes.select(theme); } catch (_) {}
  }

  function installBookThemes() {
    rendition.themes.register('light', {
      body: { color:'#30343a', background:'#fff', 'font-family':'Georgia,"Noto Serif CJK SC","Songti SC",serif', 'line-height':'1.9' },
      'p, li': { 'line-height':'1.9' },
      'img, svg': { 'max-width':'100%' }
    });
    rendition.themes.register('dark', {
      body: { color:'#d8dde2', background:'#20242a', 'font-family':'Georgia,"Noto Serif CJK SC","Songti SC",serif', 'line-height':'1.9' },
      'p, li': { 'line-height':'1.9' },
      'a': { color:'#91c5e7' },
      'img, svg': { 'max-width':'100%' }
    });
    applyBookTheme();
  }

  function readSavedPreferences() {
    const savedFont = Number(readSaved('font'));
    if (savedFont >= 80 && savedFont <= 160) fontPercent = savedFont;
    const savedFlow = readSaved('flow');
    if (savedFlow === 'paginated' || savedFlow === 'scrolled-doc') activeFlow = savedFlow;
    byId('reading-flow').value = activeFlow;
  }

  async function openBook(buffer) {
    if (typeof window.ePub !== 'function') throw new Error('ReaderUnavailable');
    if (typeof window.JSZip !== 'function') throw new Error('ZipLibraryUnavailable');
    // epub.js 0.3.88 can fail to initialize when an ArrayBuffer is passed
    // to the constructor. Open the decrypted bytes through Book.open instead.
    openedBook = window.ePub();
    await openedBook.open(buffer);
    const navigation = await openedBook.loaded.navigation;
    tableOfContents = navigation?.toc || [];
    tocList.replaceChildren(renderToc(tableOfContents));
    if (!tableOfContents.length) {
      const empty = document.createElement('p');
      empty.className = 'shelf-note';
      empty.textContent = '这本书没有可解析的目录。';
      tocList.append(empty);
    }
    toggleToc(!matchMedia('(max-width:650px)').matches);

    const metadata = await openedBook.loaded.metadata;
    byId('chapter-label').textContent = metadata?.title || '正文';
    readerStatus.textContent = '正在准备阅读位置…';
    try { await openedBook.locations.generate(1500); } catch (_) { /* CFI resume still works without percentage locations. */ }
    byId('reading-app').hidden = false;
    unlockCard.hidden = true;
    readerStatus.textContent = '正在排版书籍…';
    rendition = openedBook.renderTo('epub-viewer', {
      width:'100%', height:'100%', flow:activeFlow, spread:'none',
      allowScriptedContent:false, allowPopups:false, resizeOnOrientationChange:true
    });
    installBookThemes();
    rendition.themes.fontSize(`${fontPercent}%`);
    rendition.on('relocated', location => {
      showProgress(location);
      setTocCurrent(location?.start?.href || '');
    });
    const saved = readSaved('position');
    await rendition.display(saved?.cfi || undefined);
    showBookmark();
    readerStatus.textContent = '';
    setTimeout(() => { readerStatus.textContent = ''; }, 1300);
  }

  async function unlock(encodedKey) {
    if (unlockButton.disabled) return;
    unlockButton.disabled = true;
    setStatus('正在读取加密书籍并在本机验证…', 'info');
    let keyBytes;
    let phase = 'key';
    try {
      keyBytes = decodeKey(encodedKey);
      phase = 'download';
      const response = await fetch('books/justice-heart.epub.enc', {cache:'no-store', credentials:'same-origin'});
      if (!response.ok) throw new Error('CiphertextUnavailable');
      const sealed = new Uint8Array(await response.arrayBuffer());
      if (sealed.length < 36 || new TextDecoder().decode(sealed.subarray(0,8)) !== 'MYBOOK01') {
        sealed.fill(0);
        throw new Error('InvalidCiphertext');
      }
      const importedKey = await crypto.subtle.importKey('raw', keyBytes, {name:'AES-GCM'}, false, ['decrypt']);
      keyBytes.fill(0);
      keyBytes = null;
      phase = 'decrypt';
      decryptedBytes = await crypto.subtle.decrypt({
        name:'AES-GCM', iv:sealed.subarray(8,20), additionalData:new TextEncoder().encode(AAD), tagLength:128
      }, importedKey, sealed.subarray(20));
      sealed.fill(0);
      setStatus('', 'info');
      readSavedPreferences();
      phase = 'epub';
      await openBook(decryptedBytes);
    } catch (error) {
      if (keyBytes) keyBytes.fill(0);
      if (decryptedBytes) new Uint8Array(decryptedBytes).fill(0);
      decryptedBytes = null;
      if (openedBook) { try { openedBook.destroy(); } catch (_) {} }
      openedBook = null; rendition = null;
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
                ? '密钥验证已通过，但 EPUB 解析失败。请刷新重试；若仍失败，请反馈此提示。'
                : '解锁过程中发生错误，请检查密钥格式后重试。';
      setStatus(message);
    } finally {
      keyInput.value = '';
      unlockButton.disabled = false;
    }
  }

  async function lockBook() {
    clearTimeout(saveTimer);
    if (lastLocation?.cfi) writeSaved('position', lastLocation);
    try { rendition?.destroy(); } catch (_) {}
    try { openedBook?.destroy(); } catch (_) {}
    rendition = null;
    openedBook = null;
    if (decryptedBytes) new Uint8Array(decryptedBytes).fill(0);
    decryptedBytes = null;
    tableOfContents = [];
    tocList.replaceChildren();
    reader.hidden = true;
    unlockCard.hidden = false;
    reader.classList.remove('toc-open');
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

  byId('previous-page').addEventListener('click', () => rendition?.prev());
  byId('next-page').addEventListener('click', () => rendition?.next());
  byId('toc-toggle').addEventListener('click', () => toggleToc());
  byId('toc-close').addEventListener('click', () => closeToc());
  byId('toc-backdrop').addEventListener('click', () => closeToc());
  byId('lock-button').addEventListener('click', lockBook);
  byId('lock-from-toc').addEventListener('click', lockBook);
  byId('font-smaller').addEventListener('click', () => {
    fontPercent = Math.max(80, fontPercent - 10);
    rendition?.themes.fontSize(`${fontPercent}%`);
    writeSaved('font', fontPercent);
  });
  byId('font-larger').addEventListener('click', () => {
    fontPercent = Math.min(160, fontPercent + 10);
    rendition?.themes.fontSize(`${fontPercent}%`);
    writeSaved('font', fontPercent);
  });
  byId('reading-flow').addEventListener('change', async event => {
    if (!rendition) return;
    activeFlow = event.target.value === 'scrolled-doc' ? 'scrolled-doc' : 'paginated';
    writeSaved('flow', activeFlow);
    const resume = currentCfi || readSaved('position')?.cfi;
    rendition.flow(activeFlow);
    if (resume) await rendition.display(resume);
  });
  byId('bookmark-button').addEventListener('click', () => {
    if (!currentCfi) return;
    const active = readSaved('bookmark');
    if (active?.cfi === currentCfi) {
      try { localStorage.removeItem(`${STORAGE}:bookmark`); } catch (_) {}
    }
    else writeSaved('bookmark', {cfi:currentCfi,percent:lastLocation?.percent || 0,label:chapterFor(lastLocation?.href || '')});
    showBookmark();
  });

  document.addEventListener('keydown', event => {
    if (!rendition || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); rendition.prev(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); rendition.next(); }
    if (event.key === 'Escape' && reader.classList.contains('toc-open')) closeToc();
  });

  window.addEventListener('storage', event => {
    if (event.key !== THEME_KEY) return;
    applyPageTheme();
    applyBookTheme();
  });
  new MutationObserver(applyBookTheme).observe(document.documentElement, {
    attributes:true, attributeFilter:['data-theme']
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(saveTimer);
    try { rendition?.destroy(); } catch (_) {}
    try { openedBook?.destroy(); } catch (_) {}
    if (decryptedBytes) new Uint8Array(decryptedBytes).fill(0);
    decryptedBytes = null;
  });
})();
