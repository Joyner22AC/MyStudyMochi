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
  const bookmarkList = byId('bookmark-list');
  const highlightList = byId('highlight-list');
  const selectionToolbar = byId('selection-toolbar');
  let openedBook = null;
  let rendition = null;
  let decryptedBytes = null;
  let currentCfi = '';
  let lastLocation = null;
  let fontPercent = 100;
  let activeFlow = 'paginated';
  let saveTimer = 0;
  let chromeTimer = 0;
  let selectedCfi = '';
  let selectedContents = null;
  let activeDrawerTab = 'toc';
  let touchStart = null;
  let lastTurnAt = 0;
  let wheelTurnTimer = 0;
  let wheelAccumulator = 0;
  let activeBookToken = 0;
  let tableOfContents = [];

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
    try { localStorage.setItem(`${STORAGE}:${name}`, JSON.stringify(value)); }
    catch (_) { /* Private browsing may disable storage; reading remains available. */ }
  }

  function showProgress(location) {
    const fraction = Math.max(0, Math.min(1, Number(location?.start?.percentage) || 0));
    const percent = Math.round(fraction * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${percent}%`;
    byId('reading-scrubber').value = String(Math.round(fraction * 1000));
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
        await rendition?.display(mark.cfi);
        closeToc();
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
      open.textContent = `${mark.label || '阅读位置'} · ${mark.percent ?? 0}%`;
      open.addEventListener('click', async () => {
        await rendition?.display(mark.cfi);
        closeToc();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'saved-mark-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `删除第 ${index + 1} 条划线`);
      remove.addEventListener('click', () => removeHighlight(mark.cfi));
      row.append(open, remove);
      highlightList.append(row);
    }
  }

  function applyHighlights() {
    if (!rendition?.annotations) return;
    for (const mark of savedHighlights()) {
      try { rendition.annotations.highlight(mark.cfi, {}); } catch (_) {}
    }
  }

  function removeHighlight(cfi) {
    try { rendition?.annotations.remove(cfi, 'highlight'); } catch (_) {}
    writeSaved('highlights', savedHighlights().filter(mark => mark.cfi !== cfi));
    showHighlights();
  }

  function addHighlight() {
    if (!selectedCfi || !rendition?.annotations) return;
    const marks = savedHighlights();
    if (!marks.some(mark => mark.cfi === selectedCfi)) {
      const href = lastLocation?.href || '';
      marks.push({cfi:selectedCfi, label:chapterFor(href) || '正文', percent:lastLocation?.percent || 0, color:'yellow'});
      writeSaved('highlights', marks);
      try { rendition.annotations.highlight(selectedCfi, {}); } catch (_) {}
      showHighlights();
      readerStatus.textContent = '划线已保存到本机浏览器';
      setTimeout(() => { readerStatus.textContent = ''; }, 1600);
    }
    try { selectedContents?.window?.getSelection()?.removeAllRanges(); } catch (_) {}
    selectionToolbar.hidden = true;
    selectedCfi = '';
    selectedContents = null;
  }

  function closeToc() {
    reader.classList.remove('toc-open');
    byId('toc-backdrop').hidden = true;
    byId('toc-toggle').setAttribute('aria-expanded', 'false');
    tocPanel.setAttribute('aria-hidden', 'true');
    tocPanel.inert = true;
    byId('toc-toggle').focus({preventScroll:true});
  }

  function toggleToc(open = !reader.classList.contains('toc-open')) {
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
      if (!reader.classList.contains('toc-open') && selectionToolbar.hidden && !reader.querySelector('.reader-toolbar :focus')) {
        reader.classList.remove('chrome-visible');
      }
    }, 2600);
  }

  function turnPage(direction) {
    if (!rendition) return;
    showChrome();
    const action = direction < 0 ? rendition.prev() : rendition.next();
    Promise.resolve(action).catch(() => {
      readerStatus.textContent = '翻页没有完成，请稍后再试。';
      setTimeout(() => { readerStatus.textContent = ''; }, 1800);
    });
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
      body: { color:'#30343a', background:'#fff', 'font-family':'Georgia,"Noto Serif CJK SC","Songti SC",serif', 'font-size':'1em', 'line-height':'1.9', 'max-width':'48rem', 'margin-left':'auto', 'margin-right':'auto', 'padding':'4.4rem 2.25rem 5rem', 'box-sizing':'border-box' },
      'p, li': { 'line-height':'1.9' },
      'img, svg': { 'max-width':'100%' }
    });
    rendition.themes.register('dark', {
      body: { color:'#d8dde2', background:'#20242a', 'font-family':'Georgia,"Noto Serif CJK SC","Songti SC",serif', 'font-size':'1em', 'line-height':'1.9', 'max-width':'48rem', 'margin-left':'auto', 'margin-right':'auto', 'padding':'4.4rem 2.25rem 5rem', 'box-sizing':'border-box' },
      'p, li': { 'line-height':'1.9' },
      'a': { color:'#91c5e7' },
      'img, svg': { 'max-width':'100%' }
    });
    rendition.themes.default({
      '::selection': {background:'rgba(246,205,91,.38)'},
      '.epubjs-hl': {fill:'rgba(246,205,91,.62)', 'fill-opacity':'0.62', 'mix-blend-mode':'multiply'}
    });
    applyBookTheme();
  }

  function readSavedPreferences() {
    const savedFont = Number(readSaved('font'));
    if (savedFont >= 80 && savedFont <= 160) fontPercent = savedFont;
    activeFlow = readSaved('flow') === 'scrolled-doc' ? 'scrolled-doc' : 'paginated';
  }

  function createRendition(bookToken) {
    rendition = openedBook.renderTo('epub-viewer', {
      width:'100%', height:'100%', flow:activeFlow, spread:'none',
      allowScriptedContent:false, allowPopups:false, resizeOnOrientationChange:true
    });
    installBookThemes();
    byId('reading-flow').value = activeFlow;
    rendition.themes.fontSize(`${fontPercent}%`);
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
      doc.addEventListener('wheel', event => {
        if (activeFlow !== 'paginated' || event.ctrlKey) return;
        event.preventDefault();
        wheelAccumulator += event.deltaY;
        if (wheelTurnTimer || Math.abs(wheelAccumulator) < 24) return;
        const direction = wheelAccumulator > 0 ? 1 : -1;
        wheelAccumulator = 0;
        turnPage(direction);
        wheelTurnTimer = setTimeout(() => { wheelTurnTimer = 0; }, 380);
      }, {passive:false});
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
        if (Math.abs(dx) > 54 && Math.abs(dx) > Math.abs(dy) * 1.25) turnPage(dx > 0 ? -1 : 1);
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
      const location = await rendition.currentLocation();
      if (location) showProgress(location);
    }).catch(() => {});
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
      const response = await withTimeout(fetch('books/justice-heart.epub.enc', {
        cache:'no-store', credentials:'same-origin'
      }), 20000, 'DownloadTimeout');
      if (!response.ok) throw new Error('CiphertextUnavailable');
      const sealed = new Uint8Array(await withTimeout(response.arrayBuffer(), 15000, 'DownloadTimeout'));
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
      activeBookToken += 1;
      if (rendition) { try { rendition.destroy(); } catch (_) {} }
      if (openedBook) { try { openedBook.destroy(); } catch (_) {} }
      openedBook = null; rendition = null;
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
  document.querySelectorAll('[data-reader-tab]').forEach(button => {
    button.addEventListener('click', () => switchDrawerTab(button.dataset.readerTab));
  });
  byId('lock-button').addEventListener('click', lockBook);
  byId('lock-from-toc').addEventListener('click', lockBook);
  byId('add-highlight').addEventListener('click', addHighlight);
  byId('dismiss-selection').addEventListener('click', () => {
    selectionToolbar.hidden = true;
    selectedCfi = '';
    selectedContents = null;
  });
  byId('highlights-toggle').addEventListener('click', () => {
    switchDrawerTab('highlights');
    toggleToc(true);
  });
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
  byId('reading-scrubber').addEventListener('change', async event => {
    const fraction = Number(event.target.value) / 1000;
    const cfi = openedBook?.locations?.cfiFromPercentage(fraction);
    if (cfi) await rendition?.display(cfi);
    showChrome();
  });
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
    const nextFlow = event.target.value === 'scrolled-doc' ? 'scrolled-doc' : 'paginated';
    const previousFlow = activeFlow;
    const resumeCfi = currentCfi || readSaved('position')?.cfi;
    activeFlow = nextFlow;
    wheelAccumulator = 0;
    try {
      rendition.flow(nextFlow);
      await withTimeout(rendition.display(resumeCfi || undefined), 12000, 'FlowChangeTimeout');
      writeSaved('flow', nextFlow);
      readerStatus.textContent = nextFlow === 'paginated'
        ? '分页模式：滚轮每次翻一页。'
        : '连续模式：滚轮按页面自然滚动。';
      showChrome();
    } catch (_) {
      activeFlow = previousFlow;
      event.target.value = previousFlow;
      try {
        rendition.flow(previousFlow);
        await withTimeout(rendition.display(resumeCfi || undefined), 12000, 'FlowRestoreTimeout');
      } catch (_) {}
      readerStatus.textContent = '切换阅读方式失败，已保留原模式。';
    }
    setTimeout(() => { readerStatus.textContent = ''; }, 2200);
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

  document.addEventListener('keydown', event => {
    if (!rendition || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
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
    if (event.key === ' ' && event.target instanceof HTMLButtonElement) return;
    showChrome();
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); turnPage(-1); }
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); turnPage(1); }
    if (event.key === 'Escape' && !selectionToolbar.hidden) { selectionToolbar.hidden = true; selectedCfi = ''; }
    else if (event.key === 'Escape' && reader.classList.contains('toc-open')) closeToc();
    else if (event.key === 'Escape' && document.fullscreenElement) document.exitFullscreen().catch(() => {});
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
