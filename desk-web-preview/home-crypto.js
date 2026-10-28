(() => {
  'use strict';
  const stage = document.getElementById('home-stage');
  if (!stage) return;
  const room = document.getElementById('study-room');
  const desk = document.getElementById('desk-environment');
  const deskLamp = document.getElementById('desk-lamp');
  const papers = Array.from(stage.querySelectorAll('.desk-paper'));
  const shelf = document.getElementById('personal-library');
  const books = document.getElementById('shelf-books');
  const door = document.getElementById('cabinet-door');
  const form = document.getElementById('shelf-unlock-form');
  const keyInput = document.getElementById('shelf-key');
  const keyFile = document.getElementById('shelf-key-file');
  const unlockButton = document.getElementById('shelf-unlock-button');
  const status = document.getElementById('shelf-status');
  const shelfFootnote = document.getElementById('shelf-footnote');
  const relockButton = document.getElementById('shelf-relock');
  const bookButton = document.getElementById('open-home-book');
  const overlay = document.getElementById('home-reader-overlay');
  const readerHost = document.getElementById('home-reader-host');
  const readerLoading = document.getElementById('home-reader-loading');
  const closeReaderButton = document.getElementById('home-reader-close');
  const AAD = 'bookshelf/justice-heart/edition-1';
  let bookKey = null;
  let busy = false;
  let openingReader = false;
  let pendingOpen = 0;
  let activeReaderFrame = null;
  let readerReadyTimer = 0;
  let readerKeySent = false;
  let shelfEpoch = 0;
  let paperTransition = null;
  let paperNavigationTimer = 0;

  if (desk && deskLamp) deskLamp.addEventListener('click', () => {
    const lit = desk.dataset.lamp !== 'off';
    desk.dataset.lamp = lit ? 'off' : 'on';
    if (room) room.dataset.lamp = desk.dataset.lamp;
    deskLamp.setAttribute('aria-pressed', lit ? 'false' : 'true');
    deskLamp.setAttribute('aria-label', lit ? '打开书桌台灯' : '关闭书桌台灯');
  });

  function clearPaperTransition() {
    clearTimeout(paperNavigationTimer);
    paperNavigationTimer = 0;
    paperTransition?.remove();
    paperTransition = null;
  }

  function openPaper(paper) {
    const rect = paper.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      location.assign(paper.href);
      return;
    }
    const veil = document.createElement('div');
    veil.className = 'paper-opening-veil';
    veil.setAttribute('aria-hidden', 'true');
    veil.inert = true;
    const sheet = paper.cloneNode(true);
    sheet.removeAttribute('href');
    sheet.removeAttribute('style');
    sheet.classList.add('paper-opening-sheet');
    sheet.style.left = `${rect.left}px`;
    sheet.style.top = `${rect.top}px`;
    sheet.style.width = `${rect.width}px`;
    sheet.style.height = `${rect.height}px`;
    veil.append(sheet);
    stage.append(veil);
    paperTransition = veil;
    const targetWidth = Math.min(760, window.innerWidth - 36);
    const targetHeight = Math.min(540, window.innerHeight - 72);
    requestAnimationFrame(() => {
      if (paperTransition !== veil) return;
      veil.classList.add('is-visible');
      sheet.style.left = `${(window.innerWidth - targetWidth) / 2}px`;
      sheet.style.top = `${(window.innerHeight - targetHeight) / 2}px`;
      sheet.style.width = `${targetWidth}px`;
      sheet.style.height = `${targetHeight}px`;
    });
    paperNavigationTimer = setTimeout(() => location.assign(paper.href), 380);
  }

  papers.forEach(paper => paper.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey || paper.hasAttribute('download') ||
        paper.target === '_blank') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    event.preventDefault();
    if (!paperTransition) openPaper(paper);
  }));

  function decodeKey(encoded) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new Error('InvalidKey');
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '=');
    if (binary.length !== 32) throw new Error('InvalidKey');
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }

  async function validateBookKey(key) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let sealed;
    try {
      const response = await fetch(stage.dataset.cipherHref, {
        cache:'no-store', credentials:'same-origin', signal:controller.signal
      });
      if (!response.ok) throw new Error('BookUnavailable');
      sealed = new Uint8Array(await response.arrayBuffer());
    } catch (_) {
      throw new Error('BookUnavailable');
    } finally {
      clearTimeout(timeout);
    }
    if (sealed.length < 36 || new TextDecoder().decode(sealed.subarray(0, 8)) !== 'MYBOOK01') {
      sealed.fill(0);
      throw new Error('BookUnavailable');
    }
    try {
      // Full AES-GCM authentication: no visual unlock on merely well-formed keys.
      const plaintext = new Uint8Array(await crypto.subtle.decrypt({
        name:'AES-GCM', iv:sealed.subarray(8, 20),
        additionalData:new TextEncoder().encode(AAD), tagLength:128
      }, key, sealed.subarray(20)));
      const valid = plaintext.length > 4 && plaintext[0] === 0x50 && plaintext[1] === 0x4b;
      plaintext.fill(0);
      if (!valid) throw new Error('InvalidBook');
    } finally {
      sealed.fill(0);
    }
  }

  async function unlockShelf(encoded) {
    if (busy) return false;
    busy = true;
    const epoch = shelfEpoch;
    unlockButton.disabled = true;
    status.textContent = '正在本机验证密钥…';
    let raw;
    try {
      raw = decodeKey(encoded.trim());
      const key = await crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, false, ['decrypt', 'encrypt']);
      raw.fill(0); raw = null;
      await validateBookKey(key);
      if (epoch !== shelfEpoch) return false;
      bookKey = key;
      books.hidden = false;
      books.inert = false;
      door.inert = true;
      shelf.dataset.unlocked = 'true';
      relockButton.hidden = false;
      status.textContent = '书架已打开。';
      shelfFootnote.textContent = '已解锁。点书脊即可阅读；离开本页会自动上锁。';
      bookButton.focus({preventScroll:true});
      return true;
    } catch (error) {
      if (epoch !== shelfEpoch) return false;
      status.textContent = error?.message === 'BookUnavailable'
        ? '暂时无法取得加密书籍，请检查网络后重试。'
        : error?.message === 'InvalidKey'
          ? '密钥格式不正确，请使用书架专用密钥。'
          : '密钥无法解锁这本书，请检查是否选对书架密钥。';
      return false;
    } finally {
      raw?.fill(0);
      if (epoch === shelfEpoch) {
        keyInput.value = '';
        keyFile.value = '';
        unlockButton.disabled = false;
        busy = false;
      }
    }
  }

  function closeReader(restoreFocus = true) {
    clearTimeout(pendingOpen);
    clearTimeout(readerReadyTimer);
    pendingOpen = 0;
    readerReadyTimer = 0;
    openingReader = false;
    activeReaderFrame = null;
    readerKeySent = false;
    overlay.hidden = true;
    closeReaderButton.hidden = false;
    readerLoading.hidden = true;
    readerHost.replaceChildren();
    bookButton.classList.remove('is-pulling');
    document.body.style.overflow = '';
    if (restoreFocus && bookKey) bookButton.focus({preventScroll:true});
  }

  function relockShelf(restoreFocus = true) {
    shelfEpoch += 1;
    closeReader(false);
    bookKey = null;
    busy = false;
    unlockButton.disabled = false;
    keyInput.value = '';
    keyFile.value = '';
    books.inert = true;
    books.hidden = true;
    door.inert = false;
    shelf.dataset.unlocked = 'false';
    relockButton.hidden = true;
    status.textContent = '密钥只在当前页面的内存中使用，不上传或保存。';
    shelfFootnote.textContent = '书目公开展示；书籍正文只以加密副本存放。';
    if (restoreFocus) keyInput.focus({preventScroll:true});
  }

  function openReader() {
    if (!bookKey || !overlay.hidden || openingReader) return;
    openingReader = true;
    bookButton.classList.add('is-pulling');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    pendingOpen = setTimeout(() => {
      pendingOpen = 0;
      if (!bookKey) { openingReader = false; return; }
      overlay.hidden = false;
      closeReaderButton.hidden = false;
      readerLoading.hidden = false;
      document.body.style.overflow = 'hidden';
      const frame = document.createElement('iframe');
      frame.title = '《正义之心》阅读模式';
      frame.allowFullscreen = true;
      activeReaderFrame = frame;
      readerKeySent = false;
      readerHost.replaceChildren(frame);
      // The embedded marker contains no secret. The reader requests its key
      // only after its own message listener is installed.
      frame.src = `${stage.dataset.readerHref}?embedded=1`;
      readerReadyTimer = setTimeout(() => {
        if (activeReaderFrame !== frame) return;
        closeReader();
        shelfFootnote.textContent = '书页加载超时。书架仍已解锁，请重试点书脊。';
      }, 20000);
      closeReaderButton.focus({preventScroll:true});
      openingReader = false;
    }, reduced ? 0 : 360);
  }

  window.addEventListener('message', event => {
    if (!activeReaderFrame || event.source !== activeReaderFrame.contentWindow ||
        event.origin !== location.origin || overlay.hidden) return;
    if (event.data?.type === 'mystudy:reader-ready' && bookKey && !readerKeySent) {
      clearTimeout(readerReadyTimer);
      readerReadyTimer = 0;
      readerKeySent = true;
      readerLoading.hidden = true;
      activeReaderFrame.contentWindow.postMessage(
        {type:'mystudy:unlock-book', key:bookKey}, location.origin
      );
    } else if (event.data?.type === 'mystudy:reader-opened') {
      closeReaderButton.hidden = true;
    } else if (event.data?.type === 'mystudy:reader-close') {
      closeReader();
    }
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const encoded = keyInput.value.trim();
    keyInput.value = '';
    unlockShelf(encoded);
  });
  keyFile.addEventListener('change', async () => {
    const file = keyFile.files?.[0];
    if (!file) return;
    if (file.size > 1024) { status.textContent = '密钥文件大小不正确。'; keyFile.value = ''; return; }
    const epoch = shelfEpoch;
    try {
      const encoded = (await file.text()).trim();
      if (epoch === shelfEpoch) await unlockShelf(encoded);
    }
    catch (_) { status.textContent = '读取密钥文件失败。'; keyFile.value = ''; }
  });
  bookButton.addEventListener('click', openReader);
  relockButton.addEventListener('click', () => relockShelf());
  closeReaderButton.addEventListener('click', () => closeReader());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) closeReader();
  });
  window.addEventListener('pagehide', () => { clearPaperTransition(); relockShelf(false); });
  window.addEventListener('pageshow', () => {
    clearPaperTransition();
    if (!bookKey && shelf.dataset.unlocked === 'true') relockShelf(false);
  });
})();
