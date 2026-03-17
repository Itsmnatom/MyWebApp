/**
 * SpeedManga - Frontend App v4
 *
 * NEW FEATURES:
 * A. Search manga
 * B. Reading progress — save & resume scroll position per chapter
 * C. Page counter — "7 / 32" shown while reading
 * D. Chapter preload — silently fetch next chapter images in background
 * E. Keyboard shortcuts — ←/→ change chapter, F fullscreen, Esc exit reader
 */

'use strict';

const API = '/api';

// ══════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════

function clean(str) {
    return (str || '').replace(/[<>"'`\n\r\\]/g, ' ').trim();
}

function normalizeChapterUrl(url) {
    if (!url) return '';
    try { return decodeURIComponent(url).split('?')[0].replace(/\/$/, ''); }
    catch (e) { return url.split('?')[0].replace(/\/$/, ''); }
}

function proxify(url) {
    if (!url) return 'https://placehold.co/300x450?text=NO+IMAGE&font=outfit';
    if (url.startsWith('http')) return `${API}/proxy?url=${encodeURIComponent(url)}`;
    return url;
}

function spinnerHTML(text) {
    return `<div class="col-span-full py-40 flex flex-col items-center gap-4 animate-fade-in-up">
        <div class="w-16 h-16 rounded-full border-2 border-primary/30 border-t-primary animate-spin"></div>
        <p class="text-gray-500 font-bold uppercase tracking-widest text-xs">${text}</p>
    </div>`;
}

function errorHTML(msg, context = '') {
    return `<div class="col-span-full py-20 px-8 glass-card rounded-3xl border-red-500/20 text-center">
        <i class="fas fa-exclamation-triangle text-red-500 text-3xl mb-4"></i>
        <p class="text-red-400 font-bold mb-2 uppercase tracking-widest text-sm">Error: ${clean(msg)}</p>
        <p class="text-gray-500 text-xs mb-6">${context || ''}</p>
        <button onclick="location.reload()" class="bg-primary px-8 py-3 rounded-2xl text-xs font-black uppercase text-white shadow-lg">Refresh Feed</button>
    </div>`;
}

function getBadgeUI(badge) {
    if (!badge) return '';
    const isRaw = badge.toLowerCase().includes('raw');
    const color = isRaw ? 'bg-blue-600' : 'bg-primary';
    return `<div class="absolute top-4 right-4 z-10 ${color} text-white font-black text-[10px] px-3 py-1 rounded-full uppercase tracking-widest shadow-xl">${clean(badge)}</div>`;
}

function extractChapterNameFromUrl(url) {
    if (!url) return '';
    const match = url.match(/(?:chapter|chap|ch|ep|episode)[_\-](\d+(?:\.\d+)?)/i);
    return match ? `Chapter ${match[1]}` : '';
}

// ══════════════════════════════════════════════════
//  PERSISTENCE
// ══════════════════════════════════════════════════

let BOOKMARKS = JSON.parse(localStorage.getItem('sm_bookmarks') || '[]');
let HISTORY = JSON.parse(localStorage.getItem('sm_history') || '[]');
let READ_CHAPTERS = JSON.parse(localStorage.getItem('sm_read_chapters') || '[]');
let SCROLL_PROGRESS = JSON.parse(localStorage.getItem('sm_scroll_progress') || '{}');

function saveState() {
    localStorage.setItem('sm_bookmarks', JSON.stringify(BOOKMARKS.slice(0, 50)));
    localStorage.setItem('sm_history', JSON.stringify(HISTORY.slice(0, 15)));
    localStorage.setItem('sm_read_chapters', JSON.stringify(READ_CHAPTERS.slice(0, 500)));
    const keys = Object.keys(SCROLL_PROGRESS);
    if (keys.length > 200) keys.slice(0, keys.length - 200).forEach(k => delete SCROLL_PROGRESS[k]);
    localStorage.setItem('sm_scroll_progress', JSON.stringify(SCROLL_PROGRESS));
}

function toggleBookmark(manga) {
    const idx = BOOKMARKS.findIndex(b => b.url === manga.url);
    if (idx > -1) BOOKMARKS.splice(idx, 1);
    else BOOKMARKS.unshift({ title: manga.title, url: manga.url, image: manga.image, lastChapter: manga.lastChapter });
    saveState();
    if (!document.getElementById('detail-view').classList.contains('hidden')) renderBookmarkBtn(manga.url);
}

function addToHistory(manga, chapter) {
    const entry = { title: manga.title, mangaUrl: manga.url, image: manga.image, chapterName: chapter.name, chapterUrl: chapter.url, time: Date.now() };
    HISTORY = [entry, ...HISTORY.filter(h => h.mangaUrl !== manga.url)].slice(0, 15);
    const normUrl = normalizeChapterUrl(chapter.url);
    if (normUrl && !READ_CHAPTERS.includes(normUrl)) READ_CHAPTERS.unshift(normUrl);
    saveState();
}

function renderBookmarkBtn(mangaUrl) {
    const isBookmarked = BOOKMARKS.some(b => b.url === mangaUrl);
    const qaEl = document.getElementById('d-quick-actions');
    const existingBtn = document.getElementById('btn-bookmark');
    const btnHtml = `<button id="btn-bookmark" onclick="handleBookmarkToggle()"
        class="${isBookmarked ? 'bg-blue-600' : 'bg-white/10 hover:bg-white/20'} border border-white/10 px-6 py-3 rounded-2xl text-xs font-black tracking-widest uppercase transition-all duration-300 flex items-center gap-3">
        <i class="fa${isBookmarked ? 's' : 'r'} fa-bookmark"></i> ${isBookmarked ? 'Bookmarked' : 'Bookmark'}
    </button>`;
    if (existingBtn) existingBtn.outerHTML = btnHtml;
    else qaEl.insertAdjacentHTML('afterbegin', btnHtml);
}

// ══════════════════════════════════════════════════
//  FEATURE A: SEARCH
// ══════════════════════════════════════════════════

let _searchDebounce = null;

function initSearch() {
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');
    if (!input) return;

    input.addEventListener('input', () => {
        const q = input.value.trim();
        clearBtn.classList.toggle('hidden', !q);
        clearTimeout(_searchDebounce);
        if (!q) { closeSearchResults(); return; }
        _searchDebounce = setTimeout(() => doSearch(q), 400);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Escape') { input.value = ''; clearBtn.classList.add('hidden'); closeSearchResults(); input.blur(); }
        if (e.key === 'Enter') { clearTimeout(_searchDebounce); doSearch(input.value.trim()); }
    });

    clearBtn.addEventListener('click', () => {
        input.value = ''; clearBtn.classList.add('hidden'); closeSearchResults(); input.focus();
    });

    document.addEventListener('click', e => {
        const dropdown = document.getElementById('search-dropdown');
        if (dropdown && !dropdown.contains(e.target) && e.target !== input) closeSearchResults();
    });
}

function closeSearchResults() {
    const dropdown = document.getElementById('search-dropdown');
    if (dropdown) { dropdown.innerHTML = ''; dropdown.classList.add('hidden'); }
}

async function doSearch(q) {
    if (!q) return;
    const dropdown = document.getElementById('search-dropdown');
    if (!dropdown) return;
    dropdown.classList.remove('hidden');
    dropdown.innerHTML = `<div class="px-4 py-3 flex items-center gap-3 text-gray-400 text-xs font-bold uppercase tracking-widest">
        <div class="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin flex-shrink-0"></div> Searching...
    </div>`;
    try {
        const res = await fetch(`${API}/manga/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.results?.length) {
            dropdown.innerHTML = `<div class="px-4 py-4 text-center text-gray-500 text-xs font-bold uppercase tracking-widest">No results found</div>`;
            return;
        }
        dropdown.innerHTML = data.results.slice(0, 8).map(m => `
            <div onclick="closeSearchResults(); document.getElementById('search-input').value=''; navigate('/manga?url=${encodeURIComponent(m.url)}')"
                class="flex items-center gap-3 px-4 py-3 hover:bg-white/5 cursor-pointer transition-colors group border-b border-white/5 last:border-0">
                <img src="${proxify(m.image)}" class="w-10 h-14 object-cover rounded-lg flex-shrink-0 bg-dark-800 border border-white/5">
                <div class="min-w-0 flex-1">
                    <p class="text-sm font-bold font-display line-clamp-1 group-hover:text-primary transition-colors">${clean(m.title)}</p>
                    <p class="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-0.5">${clean(m.lastChapter || '')}</p>
                </div>
                <i class="fas fa-arrow-right text-xs text-gray-600 group-hover:text-primary transition-colors flex-shrink-0"></i>
            </div>`).join('');
    } catch (e) {
        dropdown.innerHTML = `<div class="px-4 py-3 text-red-400 text-xs font-bold uppercase tracking-widest">Error: ${clean(e.message)}</div>`;
    }
}

// ══════════════════════════════════════════════════
//  FEATURE C: PAGE COUNTER
// ══════════════════════════════════════════════════

function updatePageCounter() {
    const counter = document.getElementById('page-counter');
    if (!counter) return;
    const readerView = document.getElementById('reader-view');
    const imgs = readerView.querySelectorAll('#r-images img');
    if (!imgs.length) { counter.classList.add('hidden'); return; }
    const viewportMid = readerView.scrollTop + readerView.clientHeight / 2;
    let currentPage = 1;
    imgs.forEach((img, i) => { if (img.offsetTop <= viewportMid) currentPage = i + 1; });
    counter.textContent = `${currentPage} / ${imgs.length}`;
    counter.classList.remove('hidden');
}

// ══════════════════════════════════════════════════
//  FEATURE B: READING PROGRESS
// ══════════════════════════════════════════════════

let _progressSaveTimer = null;

function saveScrollProgress(normUrl, scrollTop) {
    if (!normUrl || scrollTop < 50) return;
    SCROLL_PROGRESS[normUrl] = scrollTop;
    clearTimeout(_progressSaveTimer);
    _progressSaveTimer = setTimeout(saveState, 1000);
}

function restoreScrollProgress(normUrl) {
    const savedPos = SCROLL_PROGRESS[normUrl];
    if (!savedPos || savedPos < 50) return;
    const readerView = document.getElementById('reader-view');
    setTimeout(() => {
        readerView.scrollTo({ top: savedPos, behavior: 'instant' });
        showToast('↩ Resumed from where you left off');
    }, 400);
}

function showToast(msg, duration = 2500) {
    let toast = document.getElementById('sm-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sm-toast';
        toast.className = 'fixed top-20 left-1/2 -translate-x-1/2 z-[200] glass px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-white shadow-2xl transition-all duration-300 pointer-events-none';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-8px)';
    }, duration);
}

// ══════════════════════════════════════════════════
//  READER STATE
// ══════════════════════════════════════════════════

const readerState = { nextPath: null, prevPath: null, currentNormUrl: null, isFullscreen: false };

// ══════════════════════════════════════════════════
//  FEATURE E: KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════

function initKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
        const readerView = document.getElementById('reader-view');
        const isReaderOpen = readerView && !readerView.classList.contains('hidden');
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

        if (isReaderOpen) {
            if (e.key === 'ArrowRight' && readerState.nextPath) {
                showToast('→ Next Chapter'); setTimeout(() => navigate(readerState.nextPath), 150);
            }
            if (e.key === 'ArrowLeft' && readerState.prevPath) {
                showToast('← Prev Chapter'); setTimeout(() => navigate(readerState.prevPath), 150);
            }
            if (e.key === 'f' || e.key === 'F') toggleFullscreen();
            if (e.key === 'Escape') {
                if (document.fullscreenElement) document.exitFullscreen();
                else window.history.back();
            }
        }
    });

    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            readerState.isFullscreen = false;
            const fsBtn = document.getElementById('reader-fs-btn');
            if (fsBtn) fsBtn.innerHTML = '<i class="fas fa-expand"></i>';
        }
    });
}

async function toggleFullscreen() {
    if (!document.fullscreenElement) {
        try {
            await document.documentElement.requestFullscreen();
            readerState.isFullscreen = true;
            showToast('⛶ Fullscreen — F or Esc to exit');
            const fsBtn = document.getElementById('reader-fs-btn');
            if (fsBtn) fsBtn.innerHTML = '<i class="fas fa-compress"></i>';
        } catch (e) { showToast('Fullscreen not available'); }
    } else {
        document.exitFullscreen();
    }
}

// ══════════════════════════════════════════════════
//  FEATURE D: CHAPTER PRELOAD
// ══════════════════════════════════════════════════

async function preloadNextChapter(nextUrl) {
    if (!nextUrl) return;
    try {
        const cleanUrl = decodeURIComponent(nextUrl).split('?')[0];
        const isAlt = cleanUrl.includes('1668manga.com');
        const fetchUrl = isAlt
            ? `${API}/alt/read?url=${encodeURIComponent(cleanUrl)}`
            : `${API}/manga/read?url=${encodeURIComponent(cleanUrl)}`;
        const res = await fetch(fetchUrl);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.images?.length) return;
        data.images.slice(0, 3).forEach(src => {
            const link = document.createElement('link');
            link.rel = 'prefetch'; link.as = 'image'; link.href = proxify(src);
            document.head.appendChild(link);
        });
    } catch (e) { /* silent preload failure */ }
}

// ══════════════════════════════════════════════════
//  ROUTING
// ══════════════════════════════════════════════════

function navigate(path) {
    window.history.pushState({}, '', path);
    handleLocation();
}

window.addEventListener('popstate', handleLocation);

async function handleLocation() {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const targetUrl = params.get('url');
    const targetTitle = params.get('title');
    const page = Math.max(1, parseInt(params.get('page')) || 1);

    ['home-view', 'detail-view', 'reader-view', 'history-view', 'bookmarks-view', 'alt-view', 'search-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.add('hidden'); el.classList.remove('animate-fade-in-up'); }
    });

    document.getElementById('main-header').classList.remove('-translate-y-full');
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'auto';
    window.scrollTo({ top: 0, behavior: 'instant' });
    readerState.nextPath = null;
    readerState.prevPath = null;

    if (path === '/read' && targetUrl) {
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        document.getElementById('reader-view').classList.remove('hidden');
        document.getElementById('main-header').classList.add('-translate-y-full');
        await renderReader(targetUrl, targetTitle || 'Reading...');
    } else if (path === '/search') {
        const sView = document.getElementById('search-view');
        if (sView) { sView.classList.remove('hidden'); sView.classList.add('animate-fade-in-up'); }
        renderSearchPage(params.get('q') || '');
    } else if (path === '/history') {
        const hView = document.getElementById('history-view');
        hView.classList.remove('hidden'); hView.classList.add('animate-fade-in-up');
        renderHistoryPage();
    } else if (path === '/bookmarks') {
        const bView = document.getElementById('bookmarks-view');
        bView.classList.remove('hidden'); bView.classList.add('animate-fade-in-up');
        renderBookmarksPage();
    } else if (path === '/alt') {
        const aView = document.getElementById('alt-view');
        if (aView) { aView.classList.remove('hidden'); aView.classList.add('animate-fade-in-up'); }
        renderAltPage();
    } else if (path === '/manga' && targetUrl) {
        const dView = document.getElementById('detail-view');
        dView.classList.remove('hidden'); dView.classList.add('animate-fade-in-up');
        await renderDetail(targetUrl);
    } else {
        const hView = document.getElementById('home-view');
        hView.classList.remove('hidden'); hView.classList.add('animate-fade-in-up');
        if (page === 1) {
            const cachedHome = localStorage.getItem('cache_home_1');
            if (cachedHome) { try { displayHome(JSON.parse(cachedHome), 1, true); } catch (e) { } }
        }
        await renderHome(page);
    }
}

// ══════════════════════════════════════════════════
//  RENDER: SEARCH PAGE
// ══════════════════════════════════════════════════

async function renderSearchPage(q) {
    const container = document.getElementById('search-page-container');
    const titleEl = document.getElementById('search-page-title');
    if (!container) return;
    if (titleEl) titleEl.textContent = q ? `Results: "${q}"` : 'Search';
    if (!q) {
        container.innerHTML = `<div class="col-span-full py-20 text-center text-gray-500 font-bold uppercase tracking-widest text-sm">Type something to search</div>`;
        return;
    }
    container.innerHTML = spinnerHTML(`Searching "${q}"...`);
    try {
        const res = await fetch(`${API}/manga/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.results?.length) {
            container.innerHTML = `<div class="col-span-full py-20 text-center text-gray-500 font-bold uppercase tracking-widest text-sm">No results for "${clean(q)}"</div>`;
            return;
        }
        container.innerHTML = data.results.map((m, i) => `
            <div onclick="navigate('/manga?url=${encodeURIComponent(m.url)}')"
                class="glass-card rounded-2xl overflow-hidden group cursor-pointer flex flex-col border border-white/5 active:scale-95 transition-all duration-300 animate-fade-in-up" style="animation-delay:${i * 0.04}s">
                <div class="relative overflow-hidden rounded-t-2xl aspect-[2/3]">
                    <img src="${proxify(m.image)}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 bg-dark-800" loading="lazy">
                    <div class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-dark-900 to-transparent"></div>
                </div>
                <div class="p-3">
                    <h3 class="text-xs font-bold font-display line-clamp-2 group-hover:text-primary transition-colors">${clean(m.title)}</h3>
                    <p class="text-[10px] text-gray-500 mt-1 font-bold uppercase tracking-wider">${clean(m.lastChapter || '')}</p>
                </div>
            </div>`).join('');
    } catch (e) { container.innerHTML = errorHTML(e.message); }
}

// ══════════════════════════════════════════════════
//  RENDER: HISTORY
// ══════════════════════════════════════════════════

function renderHistoryPage() {
    HISTORY = JSON.parse(localStorage.getItem('sm_history') || '[]');
    const container = document.getElementById('history-page-container');
    if (HISTORY.length > 0) {
        container.innerHTML = HISTORY.map(h => `
            <div onclick="navigate('/read?url=${encodeURIComponent(h.chapterUrl)}&mangaUrl=${encodeURIComponent(h.mangaUrl)}&title=${encodeURIComponent(`${clean(h.title)} - ${clean(h.chapterName)}`)}')"
                class="glass-card rounded-2xl overflow-hidden group cursor-pointer flex p-4 gap-5 border border-white/5 active:scale-95 transition-all duration-300 shadow-xl">
                <div class="relative flex-shrink-0 w-20 aspect-[2/3] overflow-hidden rounded-xl border border-white/5">
                    <img src="${proxify(h.image)}" class="w-full h-full object-cover bg-dark-800" loading="lazy">
                </div>
                <div class="flex flex-col justify-center min-w-0 flex-1">
                    <h3 class="text-sm font-bold font-display line-clamp-1 group-hover:text-primary transition-colors">${clean(h.title)}</h3>
                    <p class="text-xs text-primary font-black uppercase tracking-wider mt-1 mb-3">Resume: ${clean(h.chapterName)}</p>
                    <div class="flex items-center gap-2 text-[10px] text-gray-500 font-bold uppercase">
                        <i class="far fa-clock"></i> <span>${new Date(h.time).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>`).join('');
    } else {
        container.innerHTML = `<div class="col-span-full py-20 text-center opacity-50">Archive empty. Start reading to build history.</div>`;
    }
}

// ══════════════════════════════════════════════════
//  RENDER: BOOKMARKS
// ══════════════════════════════════════════════════

function renderBookmarksPage() {
    BOOKMARKS = JSON.parse(localStorage.getItem('sm_bookmarks') || '[]');
    const container = document.getElementById('bookmarks-page-container');
    if (BOOKMARKS.length > 0) {
        container.innerHTML = BOOKMARKS.map(b => `
            <div onclick="navigate('/manga?url=${encodeURIComponent(b.url)}')" class="group cursor-pointer">
                <div class="relative overflow-hidden rounded-2xl aspect-[2/3] mb-3 shadow-2xl border border-white/5 group-hover:border-blue-500/50 transition-all">
                    <img src="${proxify(b.image)}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 bg-dark-800" loading="lazy">
                    <div class="absolute inset-0 bg-gradient-to-t from-dark-900 via-transparent to-transparent opacity-60"></div>
                </div>
                <h3 class="text-xs md:text-sm font-bold font-display line-clamp-1 group-hover:text-blue-400 text-center">${clean(b.title)}</h3>
            </div>`).join('');
    } else {
        container.innerHTML = `<div class="col-span-full py-20 text-center opacity-50 text-blue-400/50">Your bookmark collection is empty.</div>`;
    }
}

// ══════════════════════════════════════════════════
//  RENDER: ALT PAGE
// ══════════════════════════════════════════════════

async function renderAltPage() {
    const container = document.getElementById('alt-page-container');
    if (!container) return;
    container.innerHTML = spinnerHTML('Synchronizing Alternate Archives...');
    try {
        const res = await fetch(`${API}/alt/home`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.updates?.length > 0) {
            container.innerHTML = data.updates.map((m, i) => `
                <div onclick="navigate('/manga?url=${encodeURIComponent(m.url)}')" class="glass-card rounded-2xl overflow-hidden group cursor-pointer flex flex-col p-3 border border-white/5 active:scale-95 transition-all duration-300 animate-fade-in-up" style="animation-delay:${i * 0.05}s">
                    <div class="relative overflow-hidden rounded-xl aspect-[2/3] mb-3 shadow-xl border border-white/5">
                        <img src="${proxify(m.image)}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 bg-dark-800" loading="lazy">
                        <div class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-dark-900 to-transparent"></div>
                        <div class="absolute bottom-2 left-2">
                            <span class="bg-amber-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">${clean(m.lastChapter)}</span>
                        </div>
                    </div>
                    <h3 class="text-xs font-bold font-display line-clamp-2 leading-tight group-hover:text-amber-400 transition-colors text-center">${clean(m.title)}</h3>
                </div>`).join('');
        } else {
            container.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500 font-bold uppercase tracking-widest text-sm">Alternative archives currently offline</div>';
        }
    } catch (e) { container.innerHTML = errorHTML(e.message); }
}

// ══════════════════════════════════════════════════
//  RENDER: HOME
// ══════════════════════════════════════════════════

async function renderHome(page) {
    const popSection = document.getElementById('popular-section');
    const upContainer = document.getElementById('updates-container');
    if (!upContainer.innerHTML || upContainer.innerHTML.includes('skeleton')) {
        upContainer.innerHTML = spinnerHTML(`Synchronizing Page ${page}...`);
    }
    try {
        const res = await fetch(`${API}/manga/home?page=${page}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (page === 1 && data.updates?.length > 0) localStorage.setItem('cache_home_1', JSON.stringify(data));
        displayHome(data, page);
    } catch (e) {
        upContainer.innerHTML = errorHTML(e.message, `renderHome(${page})`);
        if (page === 1) popSection.style.display = 'none';
    }
}

function displayHome(data, page, fromCache = false) {
    READ_CHAPTERS = JSON.parse(localStorage.getItem('sm_read_chapters') || '[]');
    const popContainer = document.getElementById('popular-container');
    const upContainer = document.getElementById('updates-container');
    const popSection = document.getElementById('popular-section');

    popSection.style.display = page === 1 ? 'block' : 'none';
    document.getElementById('page-indicator').innerText = `PAGE ${page}`;

    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    if (page <= 1) btnPrev.classList.add('hidden');
    else { btnPrev.classList.remove('hidden'); btnPrev.onclick = () => navigate(`/?page=${page - 1}`); }
    btnNext.onclick = () => navigate(`/?page=${page + 1}`);
    btnNext.disabled = false; btnNext.classList.remove('opacity-50', 'pointer-events-none');

    const { popular = [], updates = [] } = data;

    if (page === 1 && popular.length > 0) {
        popContainer.innerHTML = popular.map((m, i) => `
            <div onclick="navigate('/manga?url=${encodeURIComponent(m.url)}')" class="flex-none w-40 md:w-56 group cursor-pointer ${fromCache ? '' : 'animate-fade-in-up'} snap-start" style="animation-delay:${i * 0.05}s">
                <div class="relative overflow-hidden rounded-2xl aspect-[2/3] mb-3 shadow-[0_4px_20px_rgba(0,0,0,0.5)] group-hover:shadow-[0_8px_30px_rgba(255,69,0,0.3)] transition-all duration-500 border border-white/5 group-hover:border-primary/50">
                    <img src="${proxify(m.image)}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out bg-dark-800" loading="lazy">
                    <div class="absolute inset-0 bg-gradient-to-t from-dark-900 via-dark-900/20 to-transparent opacity-80 group-hover:opacity-60 transition-opacity duration-300"></div>
                    ${getBadgeUI(m.badge)}
                    <div class="absolute bottom-3 left-3 right-3 text-center">
                        <div class="glass inline-block px-3 py-1 rounded-full text-[9px] font-bold text-white mb-2 shadow-lg">
                            <i class="fas fa-bolt text-primary mr-1"></i> ${clean(m.lastChapter)}
                        </div>
                    </div>
                </div>
                <h3 class="text-xs md:text-sm font-bold font-display line-clamp-2 leading-tight group-hover:text-primary transition-colors text-center px-1">${clean(m.title)}</h3>
            </div>`).join('');
    } else if (page === 1) { popSection.style.display = 'none'; }

    if (!updates.length) {
        if (!fromCache) upContainer.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500 font-bold uppercase tracking-widest text-sm">No transmissions found</div>';
    } else {
        upContainer.innerHTML = updates.map((m, i) => `
            <div onclick="navigate('/manga?url=${encodeURIComponent(m.url)}')" class="glass-card rounded-2xl overflow-hidden group cursor-pointer flex p-3 md:p-4 gap-4 md:gap-5 border border-white/5 active:scale-95 transition-all duration-300 ${fromCache ? '' : 'animate-fade-in-up'}" style="animation-delay:${i * 0.02}s">
                <div class="relative flex-shrink-0 w-24 md:w-32 aspect-[2/3] overflow-hidden rounded-xl shadow-xl group-hover:shadow-primary/20 transition-all duration-500 border border-white/5 group-hover:border-primary/50">
                    <img src="${proxify(m.image)}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out bg-dark-800" loading="lazy">
                    ${getBadgeUI(m.badge)}
                    <div class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-dark-900 to-transparent"></div>
                </div>
                <div class="flex flex-col justify-between py-1 min-w-0 flex-1">
                    <div class="space-y-2 md:space-y-3">
                        <h3 class="text-sm md:text-base font-bold font-display line-clamp-2 leading-tight transition-colors group-hover:text-primary">${clean(m.title)}</h3>
                        <div class="flex flex-wrap gap-1.5 md:gap-2">
                            ${(m.chapters?.length > 0) ? m.chapters.map(ch => {
            const readPath = `/read?url=${encodeURIComponent(ch.url)}&title=${encodeURIComponent(`${clean(m.title)} - ${clean(ch.name)}`)}`;
            const isRead = READ_CHAPTERS.includes(normalizeChapterUrl(ch.url));
            return `<div onclick="event.stopPropagation(); navigate('${readPath}')"
                                    class="${isRead ? 'bg-primary/20 border-primary/30' : 'bg-primary/10 border-transparent'} border hover:bg-primary/30 px-2 py-0.5 md:px-2.5 md:py-1 rounded-lg transition-all flex items-center gap-1.5 active:scale-95">
                                    <div class="w-1 h-1 rounded-full ${isRead ? 'bg-primary animate-none' : 'bg-primary animate-pulse'}"></div>
                                    <span class="text-[9px] md:text-[10px] font-black ${isRead ? 'text-primary' : 'text-primary/90'} uppercase tracking-tight">${clean(ch.name)}</span>
                                </div>`;
        }).join('') : `<div class="px-2.5 py-1 bg-primary/10 rounded-lg flex items-center gap-2">
                                <div class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
                                <span class="text-[10px] md:text-xs font-bold text-primary uppercase tracking-wider">${clean(m.lastChapter || 'NEW')}</span>
                            </div>`}
                        </div>
                    </div>
                    <div class="flex items-center gap-2 text-[10px] md:text-xs text-gray-400 font-medium">
                        <i class="far fa-clock opacity-60"></i> <span>${clean(m.time)}</span>
                    </div>
                </div>
            </div>`).join('');
    }
}

// ══════════════════════════════════════════════════
//  RENDER: DETAIL
// ══════════════════════════════════════════════════

async function renderDetail(url) {
    READ_CHAPTERS = JSON.parse(localStorage.getItem('sm_read_chapters') || '[]');
    SCROLL_PROGRESS = JSON.parse(localStorage.getItem('sm_scroll_progress') || '{}');
    const chaptersEl = document.getElementById('d-chapters');
    chaptersEl.innerHTML = spinnerHTML('Extracting Archives...');
    document.getElementById('d-title').innerText = '';
    document.getElementById('d-synopsis').innerText = '';
    document.getElementById('d-info').innerHTML = '';
    document.getElementById('detail-bg').style.backgroundImage = 'none';
    const mainImg = document.getElementById('d-image');
    mainImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const isAlt = url.includes('1668manga.com');
        const fetchUrl = isAlt ? `${API}/alt/manga?url=${encodeURIComponent(url)}` : `${API}/manga/details?url=${encodeURIComponent(url)}`;
        const res = await fetch(fetchUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status} [Link Unstable]`);
        const d = await res.json();
        if (d.error) throw new Error(d.error);

        document.getElementById('d-title').innerText = d.title || 'Unknown Classified';
        document.getElementById('d-synopsis').innerText = d.synopsis || 'No synopsis data recovered.';
        const proxifiedImg = proxify(d.image);
        mainImg.src = proxifiedImg;
        document.getElementById('detail-bg').style.backgroundImage = `url('${proxifiedImg}')`;

        document.getElementById('d-info').innerHTML =
            Object.entries(d.info || {}).map(([k, v]) => `<div class="glass px-4 py-2 rounded-xl flex items-center gap-3 hover:bg-white/5 transition-colors"><span class="text-primary font-black uppercase tracking-widest text-[9px] opacity-80">${clean(k)}</span><span class="text-gray-200 font-medium text-xs">${clean(v)}</span></div>`).join('')
            + (d.status ? `<div class="glass px-4 py-2 rounded-xl flex items-center gap-3"><span class="text-amber-500 font-black uppercase tracking-widest text-[9px] opacity-80">Status</span><span class="text-gray-200 font-medium text-xs">${clean(d.status)}</span></div>` : '')
            + (d.type ? `<div class="glass px-4 py-2 rounded-xl flex items-center gap-3"><span class="text-blue-400 font-black uppercase tracking-widest text-[9px] opacity-80">Type</span><span class="text-gray-200 font-medium text-xs">${clean(d.type)}</span></div>` : '');

        const qaEl = document.getElementById('d-quick-actions');
        qaEl.innerHTML = '';
        window.currentManga = { title: d.title, url, image: d.image, lastChapter: d.chapters?.[0]?.name || '' };
        window.handleBookmarkToggle = () => toggleBookmark(window.currentManga);
        renderBookmarkBtn(url);

        if (d.chapters?.length > 0) {
            const firstCh = [...d.chapters].sort((a, b) => parseFloat(a.num) - parseFloat(b.num))[0];
            const lastCh = [...d.chapters].sort((a, b) => parseFloat(b.num) - parseFloat(a.num))[0];

            if (firstCh) {
                const isFirstRead = READ_CHAPTERS.includes(normalizeChapterUrl(firstCh.url));
                qaEl.innerHTML += `<button onclick="navigate('/read?url=${encodeURIComponent(firstCh.url)}&mangaUrl=${encodeURIComponent(url)}&title=${encodeURIComponent(`${clean(d.title)} - ${clean(firstCh.name)}`)}')"
                    class="${isFirstRead ? 'bg-primary/20 border-primary' : 'bg-white/10 hover:bg-white/20 border-white/10'} border px-6 py-3 rounded-2xl text-xs font-black tracking-widest uppercase transition-all duration-300 flex items-center gap-3">
                    <i class="fas fa-play text-primary"></i> ${isFirstRead ? 'Read Again' : 'Read First'}
                </button>`;
            }
            if (lastCh && lastCh.url !== firstCh?.url) {
                const isLastRead = READ_CHAPTERS.includes(normalizeChapterUrl(lastCh.url));
                qaEl.innerHTML += `<button onclick="navigate('/read?url=${encodeURIComponent(lastCh.url)}&mangaUrl=${encodeURIComponent(url)}&title=${encodeURIComponent(`${clean(d.title)} - ${clean(lastCh.name)}`)}')"
                    class="bg-gradient-to-r from-primary to-secondary hover:brightness-110 px-8 py-3 rounded-2xl text-xs font-black tracking-widest uppercase transition-all duration-300 shadow-[0_0_20px_rgba(255,69,0,0.3)] hover:-translate-y-1 flex items-center gap-3">
                    ${isLastRead ? 'Review Latest' : 'Read Latest'} <i class="fas fa-bolt text-white/80"></i>
                </button>`;
            }

            chaptersEl.innerHTML = d.chapters.map(c => {
                const isRead = READ_CHAPTERS.includes(normalizeChapterUrl(c.url));
                const hasProgress = !!SCROLL_PROGRESS[normalizeChapterUrl(c.url)];
                const isAltCh = url.includes('1668manga.com');
                const readPath = `/read?url=${encodeURIComponent(c.url)}&mangaUrl=${encodeURIComponent(url)}&title=${encodeURIComponent(`${clean(d.title)} - ${clean(c.name)}`)}${isAltCh ? '&alt=1' : ''}`;
                return `<button onclick="navigate('${readPath}')"
                    class="w-full relative overflow-hidden glass hover:bg-white/10 p-4 rounded-2xl text-left transition-all duration-200 flex justify-between items-center group border ${isRead ? 'border-primary/40 bg-primary/5' : 'border-white/5 hover:border-primary/50'}">
                    <div class="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-primary to-secondary transform ${isRead ? 'scale-x-100' : 'scale-x-0'} origin-left group-hover:scale-x-100 transition-transform duration-200"></div>
                    <div class="flex items-center gap-3 min-w-0 pr-2">
                        <div class="w-8 h-8 rounded-full ${isRead ? 'bg-primary border-primary' : 'bg-dark-800 border-white/10'} border flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:border-primary transition-colors">
                            <i class="fas ${isRead ? 'fa-check text-white' : 'fa-book-open text-gray-400 group-hover:text-white'} text-[10px]"></i>
                        </div>
                        <span class="font-bold text-sm ${isRead ? 'text-primary' : 'text-gray-200'} group-hover:text-white truncate">${clean(c.name)}</span>
                        ${hasProgress && !isRead ? `<span class="text-[9px] font-black text-amber-500 uppercase tracking-widest flex-shrink-0 ml-1">↩</span>` : ''}
                    </div>
                    <span class="text-[10px] font-bold tracking-widest uppercase ${isRead ? 'text-primary' : 'opacity-40'} group-hover:opacity-100 group-hover:text-primary transition-colors flex-shrink-0 whitespace-nowrap pl-2">${clean(c.time)}</span>
                </button>`;
            }).join('');
        } else {
            chaptersEl.innerHTML = '<div class="col-span-full py-12 text-center text-gray-600 font-bold uppercase tracking-widest text-xs border border-dashed border-gray-800 rounded-2xl">No chapters available</div>';
        }
    } catch (e) { chaptersEl.innerHTML = errorHTML(e.message); }
}

// ══════════════════════════════════════════════════
//  RENDER: READER
// ══════════════════════════════════════════════════

async function renderReader(url, title) {
    document.getElementById('r-title').innerText = title;
    const container = document.getElementById('r-images');
    const navBottom = document.getElementById('reader-nav-bottom');
    const floatNext = document.getElementById('float-next-btn');
    const counter = document.getElementById('page-counter');

    navBottom.innerHTML = '';
    if (floatNext) floatNext.classList.add('hidden');
    if (counter) counter.classList.add('hidden');
    readerState.currentNormUrl = normalizeChapterUrl(url);

    container.innerHTML = `<div class="py-40 flex flex-col items-center gap-6 animate-fade-in-up w-full">
        <div class="w-20 h-20 rounded-3xl glass-card flex items-center justify-center border-primary/30 shadow-[0_0_30px_rgba(255,69,0,0.2)]">
            <i class="fas fa-layer-group fa-spin text-primary text-3xl"></i>
        </div>
        <div class="text-center">
            <h3 class="text-white font-black font-display tracking-widest uppercase mb-2">Decrypting Pages</h3>
            <p class="text-xs text-gray-500 font-bold tracking-widest uppercase">Connecting to relay...</p>
        </div>
    </div>`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 35000);
        const cleanUrl = decodeURIComponent(url).split('?')[0];
        const isForce = url.includes('nocache=1') ? '&nocache=1' : '';
        const isAlt = cleanUrl.includes('1668manga.com') || new URLSearchParams(window.location.search).get('alt');
        const fetchUrl = isAlt ? `${API}/alt/read?url=${encodeURIComponent(cleanUrl)}` : `${API}/manga/read?url=${encodeURIComponent(cleanUrl)}${isForce}`;

        const res = await fetch(fetchUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status} [Link Unstable]`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (data.images?.length > 0) {
            const params = new URLSearchParams(window.location.search);
            const mangaUrl = params.get('mangaUrl');
            const rawTitle = params.get('title') || title;
            const dashIdx = rawTitle.indexOf(' - ');
            const mangaTitle = dashIdx > -1 ? rawTitle.substring(0, dashIdx) : rawTitle;
            const chapterName = dashIdx > -1 ? rawTitle.substring(dashIdx + 3) : 'Chapter';
            if (mangaUrl) {
                addToHistory({ title: mangaTitle, url: mangaUrl, image: data.images[0] }, { name: chapterName, url: normalizeChapterUrl(url) });
            }
        }

        if (!data.images?.length) {
            container.innerHTML = `<div class="mt-40 text-center px-4 animate-fade-in-up">
                <div class="w-24 h-24 rounded-full bg-dark-800 flex items-center justify-center mx-auto mb-6">
                    <i class="fas fa-image-slash text-4xl text-gray-600"></i>
                </div>
                <h3 class="text-white font-black font-display text-xl mb-2">PAGES CLASSIFIED</h3>
                <p class="text-xs text-gray-500 max-w-sm mx-auto">Source materials could not be extracted.</p>
                <button onclick="renderReader('${url.replace(/'/g, "\\'")}${url.includes('?') ? '&' : '?'}nocache=1','${title.replace(/'/g, "\\'")}' )"
                    class="mt-8 bg-white/5 hover:bg-primary border border-white/10 px-8 py-3 rounded-2xl text-[10px] uppercase font-black tracking-widest transition-all">Attempt Bypass</button>
            </div>`;
            return;
        }

        container.innerHTML = data.images.map((src, i) => `
            <img src="${proxify(src)}"
                class="w-full block transition-opacity duration-500 opacity-0 cursor-pointer"
                onclick="handleImageClick(event)"
                onload="this.classList.remove('opacity-0')"
                loading="${i < 4 ? 'eager' : 'lazy'}"
                onerror="this.style.display='none'">`).join('');

        // FEATURE C: init page counter
        if (counter) { counter.textContent = `1 / ${data.images.length}`; counter.classList.remove('hidden'); }

        // Build nav
        const params = new URLSearchParams(window.location.search);
        const mangaUrl = params.get('mangaUrl');
        const rawTitle = params.get('title') || title;
        const dashIdx = rawTitle.indexOf(' - ');
        const mangaTitle = dashIdx > -1 ? rawTitle.substring(0, dashIdx) : rawTitle;
        const mangaUrlParam = mangaUrl ? `&mangaUrl=${encodeURIComponent(mangaUrl)}` : '';

        if (data.prevUrl) {
            const decoded = decodeURIComponent(data.prevUrl).split('?')[0];
            const chName = extractChapterNameFromUrl(decoded);
            const t = mangaTitle ? `${mangaTitle} - ${chName || 'Previous Chapter'}` : 'Previous Chapter';
            const prevPath = `/read?url=${encodeURIComponent(decoded)}&title=${encodeURIComponent(t)}${mangaUrlParam}`;
            readerState.prevPath = prevPath;
            navBottom.innerHTML += `<button onclick="navigate('${prevPath}')"
                class="glass hover:bg-white/10 px-6 py-3.5 rounded-2xl text-xs font-bold tracking-widest uppercase transition-all duration-300 hover:-translate-x-1 flex items-center gap-3">
                <i class="fas fa-arrow-left opacity-70"></i> Prev Chapter
            </button>`;
        }

        if (data.nextUrl) {
            const decoded = decodeURIComponent(data.nextUrl).split('?')[0];
            const chName = extractChapterNameFromUrl(decoded);
            const t = mangaTitle ? `${mangaTitle} - ${chName || 'Next Chapter'}` : 'Next Chapter';
            const nextPath = `/read?url=${encodeURIComponent(decoded)}&title=${encodeURIComponent(t)}${mangaUrlParam}`;
            readerState.nextPath = nextPath;
            navBottom.innerHTML += `<button onclick="navigate('${nextPath}')"
                class="bg-gradient-to-r from-primary to-secondary hover:brightness-110 px-8 py-3.5 rounded-2xl text-xs font-black tracking-widest uppercase transition-all duration-300 shadow-[0_0_20px_rgba(255,69,0,0.3)] hover:-translate-y-1 flex items-center gap-3">
                Next Chapter <i class="fas fa-arrow-right"></i>
            </button>`;
            floatNext.classList.remove('hidden');
            floatNext.onclick = () => navigate(nextPath);
            // FEATURE D: preload next chapter silently
            setTimeout(() => preloadNextChapter(data.nextUrl), 2000);
        }

        // FEATURE B: restore progress
        restoreScrollProgress(readerState.currentNormUrl);

    } catch (e) {
        container.innerHTML = `<div class="mt-40 text-center px-4 max-w-md mx-auto animate-fade-in-up">
            <div class="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6 border border-red-500/20">
                <i class="fas fa-xmark text-4xl text-red-500"></i>
            </div>
            <h3 class="text-white font-black font-display text-xl mb-3">CONNECTION LOST</h3>
            <code class="text-[10px] bg-black/50 p-3 rounded-lg block border border-red-900/30 text-gray-400 mb-6 truncate">${clean(e.message)}</code>
            <div class="flex flex-col gap-3">
                <button onclick="renderReader('${url.replace(/'/g, "\\'")}','${title.replace(/'/g, "\\'")}' )"
                    class="w-full bg-white/5 hover:bg-primary border border-white/10 hover:border-primary px-6 py-3.5 rounded-2xl text-xs font-bold tracking-widest uppercase transition-all duration-300 group">
                    <i class="fas fa-rotate-right mr-2 group-hover:rotate-180 transition-transform duration-500"></i> Retry
                </button>
                <button onclick="renderReader('${url.replace(/'/g, "\\'")}${url.includes('?') ? '&' : '?'}nocache=1','${title.replace(/'/g, "\\'")}' )"
                    class="w-full bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 px-6 py-3 rounded-2xl text-[10px] font-black tracking-widest uppercase transition-all duration-300">
                    Hard Reset (Bypass Cache)
                </button>
            </div>
        </div>`;
    }
}

// ══════════════════════════════════════════════════
//  READER SCROLL HANDLER (page counter + progress)
// ══════════════════════════════════════════════════

function onReaderScroll() {
    updatePageCounter();
    if (readerState.currentNormUrl) {
        saveScrollProgress(readerState.currentNormUrl, document.getElementById('reader-view').scrollTop);
    }
}

// ══════════════════════════════════════════════════
//  GLOBAL HANDLERS
// ══════════════════════════════════════════════════

function handleImageClick(e) {
    document.querySelectorAll('#reader-topbar, #reader-floats, #reader-footer').forEach(el => el.classList.toggle('ui-hidden'));
}

// ══════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════

window.onload = () => {
    handleLocation();
    initSearch();
    initKeyboardShortcuts();
    const readerView = document.getElementById('reader-view');
    if (readerView) readerView.addEventListener('scroll', onReaderScroll, { passive: true });
};