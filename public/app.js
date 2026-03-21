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
let lastMainPath = '/';

// Register PWA Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW Reg Failed:', err));
    });
}

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

function extractAverageColor(imgEl) {
    try {
        if (!imgEl.complete || !imgEl.naturalWidth) return [255, 69, 0];
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d', {willReadFrequently: true});
        ctx.drawImage(imgEl, 0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        let [r,g,b] = [data[0], data[1], data[2]];
        if (r<40 && g<40 && b<40) { r+=40; g+=40; b+=40; } // Boost if too dark
        return [r, g, b];
    } catch(e) { return [255, 69, 0]; }
}

function applyDynamicTheme(rgbArr) {
    if (!rgbArr) {
        document.documentElement.style.setProperty('--color-primary-rgb', '255 69 0');
        document.documentElement.style.setProperty('--color-secondary-rgb', '255 140 0');
        return;
    }
    const [r, g, b] = rgbArr;
    document.documentElement.style.setProperty('--color-primary-rgb', `${r} ${g} ${b}`);
    document.documentElement.style.setProperty('--color-secondary-rgb', `${Math.min(255, r+40)} ${Math.max(0, g-20)} ${Math.min(255, b+20)}`);
}

// ══════════════════════════════════════════════════
//  PERSISTENCE
// ══════════════════════════════════════════════════

let BOOKMARKS = JSON.parse(localStorage.getItem('sm_bookmarks') || '[]');
let HISTORY = JSON.parse(localStorage.getItem('sm_history') || '[]');
let READ_CHAPTERS = JSON.parse(localStorage.getItem('sm_read_chapters') || '[]');
let SCROLL_PROGRESS = JSON.parse(localStorage.getItem('sm_scroll_progress') || '{}');
let SM_STATS = JSON.parse(localStorage.getItem('sm_stats') || '{"totalRead": 0, "weekRead": 0, "lastUpdated": 0}');

function saveState() {
    localStorage.setItem('sm_bookmarks', JSON.stringify(BOOKMARKS.slice(0, 50)));
    localStorage.setItem('sm_history', JSON.stringify(HISTORY.slice(0, 15)));
    localStorage.setItem('sm_read_chapters', JSON.stringify(READ_CHAPTERS.slice(0, 500)));
    localStorage.setItem('sm_stats', JSON.stringify(SM_STATS));
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
    if (normUrl && !READ_CHAPTERS.includes(normUrl)) {
        READ_CHAPTERS.unshift(normUrl);
        SM_STATS.totalRead = (SM_STATS.totalRead || 0) + 1;
        const now = Date.now();
        if (now - (SM_STATS.lastUpdated || 0) > 7 * 24 * 60 * 60 * 1000) {
            SM_STATS.weekRead = 1;
        } else {
            SM_STATS.weekRead = (SM_STATS.weekRead || 0) + 1;
        }
        SM_STATS.lastUpdated = now;
    }
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
        if (e.key === 'Enter') { 
            clearTimeout(_searchDebounce); 
            closeSearchResults(); 
            navigate(`/search?q=${encodeURIComponent(input.value.trim())}`); 
        }
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

// REMOVED PAGE COUNTER FEATURE AS REQUESTED BY USER
// (Function updatePageCounter was here)

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
    if (!savedPos || savedPos < 50) return false;
    const readerView = document.getElementById('reader-view');
    setTimeout(() => {
        if (!readerView) return;
        readerView.scrollTo({ top: savedPos, behavior: 'instant' });
        showToast('↩ Resumed from where you left off');
    }, 600); // Increased timeout for heavier mobile pages
    return true;
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
let currentChapters = []; // Store chapters for the selector

// FEATURE: Reader Settings Persistence
let READER_SETTINGS = JSON.parse(localStorage.getItem('sm_reader_settings') || '{"spacing":"normal","width":"standard","brightness":100}');

function saveReaderSettings() { localStorage.setItem('sm_reader_settings', JSON.stringify(READER_SETTINGS)); }

function updateReaderSettingsUI() {
    const spacingLabel = document.getElementById('label-spacing');
    const widthLabel = document.getElementById('label-width');
    if (spacingLabel) spacingLabel.innerText = READER_SETTINGS.spacing.toUpperCase();
    if (widthLabel) widthLabel.innerText = READER_SETTINGS.width.toUpperCase();
    
    document.querySelectorAll('#reader-settings button').forEach(btn => {
        const attr = btn.getAttribute('onclick') || '';
        btn.classList.remove('border-primary', 'bg-primary/10', 'text-primary');
        if (attr.includes(`'${READER_SETTINGS.spacing}'`) || attr.includes(`'${READER_SETTINGS.width}'`)) {
            btn.classList.add('border-primary', 'bg-primary/10', 'text-primary');
        }
    });
}

function toggleReaderSettings() {
    const el = document.getElementById('reader-settings');
    if (el.classList.contains('hidden')) {
        updateReaderSettingsUI();
        el.classList.remove('hidden'); el.classList.add('flex');
        setTimeout(() => el.classList.remove('opacity-0', 'scale-95'), 10);
    } else {
        el.classList.add('opacity-0', 'scale-95');
        setTimeout(() => { el.classList.remove('flex'); el.classList.add('hidden'); }, 300);
    }
}

function setReaderSpacing(mode) {
    const r = document.getElementById('r-images');
    r.classList.remove('spacing-none', 'spacing-tight', 'spacing-normal');
    r.classList.add(`spacing-${mode}`);
    READER_SETTINGS.spacing = mode; saveReaderSettings();
    updateReaderSettingsUI();
    showToast(`Spacing: ${mode}`);
}

function setReaderWidth(mode) {
    const r = document.getElementById('r-images');
    r.classList.remove('width-narrow', 'width-standard', 'width-full');
    r.classList.add(`width-${mode}`);
    READER_SETTINGS.width = mode; saveReaderSettings();
    updateReaderSettingsUI();
    showToast(`Width: ${mode}`);
}

function setReaderBrightness(val) {
    document.getElementById('r-images').style.filter = `brightness(${val}%)`;
    READER_SETTINGS.brightness = val; saveReaderSettings();
}

function applyPersistedReaderSettings() {
    try {
        setReaderSpacing(READER_SETTINGS.spacing);
        setReaderWidth(READER_SETTINGS.width);
        setReaderBrightness(READER_SETTINGS.brightness);
        const range = document.querySelector('#reader-settings input[type="range"]');
        if (range) range.value = READER_SETTINGS.brightness;
    } catch (e) { console.warn('Reader settings apply failed:', e); }
}

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
                showToast('🚀 Next Chapter'); setTimeout(() => navigate(readerState.nextPath, null, true), 150);
            }
            if (e.key === 'ArrowLeft' && readerState.prevPath) {
                showToast('⏮ Prev Chapter'); setTimeout(() => navigate(readerState.prevPath, null, true), 150);
            }
            if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); }
            if (e.key === 's' || e.key === 'S') { toggleReaderSettings(); }
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

function navigate(path, clickedEl = null, isReplace = false) {
    const currentPathname = window.location.pathname;
    const newPathname = path.split('?')[0];

    if (['/', '/history', '/bookmarks', '/alt', '/search'].includes(currentPathname)) {
        lastMainPath = currentPathname + window.location.search;
    }

    if (newPathname !== '/read' && currentPathname !== '/read' && newPathname !== '/manga' && currentPathname !== '/manga') {
        currentChapters = [];
    }
    
    if (newPathname !== '/read' && newPathname !== '/manga') {
        applyDynamicTheme(null);
    }

    const performNavigate = () => {
        if (isReplace) {
            window.history.replaceState({}, '', path);
        } else {
            window.history.pushState({}, '', path);
        }
        handleLocation();
    };

    if (document.startViewTransition && clickedEl) {
        const coverImg = clickedEl.tagName === 'IMG' ? clickedEl : clickedEl.querySelector('img');
        if (coverImg && newPathname === '/manga') {
            coverImg.style.viewTransitionName = 'manga-cover';
        }
        
        document.startViewTransition(async () => {
            performNavigate();
            if (coverImg) coverImg.style.viewTransitionName = '';
        });
    } else {
        performNavigate();
    }
}

window.addEventListener('popstate', handleLocation);

async function handleLocation() {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const targetUrl = params.get('url');
    const targetTitle = params.get('title');
    const page = Math.max(1, parseInt(params.get('page')) || 1);

    ['home-view', 'detail-view', 'reader-view', 'history-view', 'bookmarks-view', 'alt-view', 'search-view', 'profile-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.add('hidden'); el.classList.remove('animate-fade-in-up'); }
    });

    document.getElementById('main-header').classList.remove('-translate-y-full');
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'auto';
    // Reset scroll at the end for better reliability after content loads
    readerState.prevPath = null;

    // Track main browsing paths to avoid backing into Reader from Detail
    if (['/', '/search', '/history', '/bookmarks', '/alt'].includes(path)) {
        lastMainPath = window.location.pathname + window.location.search;
    }

    if (path === '/read' && targetUrl) {
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
        document.getElementById('reader-view').classList.remove('hidden');
        document.getElementById('main-header').classList.add('-translate-y-full');
        await renderReader(targetUrl, targetTitle || 'Reading...');
    } else if (path === '/search') {
        const sView = document.getElementById('search-view');
        if (sView) { sView.classList.remove('hidden'); sView.classList.add('animate-fade-in-up'); }
        renderSearchPage(params.get('q') || '', params.get('genre') || '', params.get('status') || '');
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
    } else if (path === '/profile') {
        const pView = document.getElementById('profile-view');
        if (pView) { pView.classList.remove('hidden'); pView.classList.add('animate-fade-in-up'); }
        if (typeof renderProfilePage === 'function') renderProfilePage();
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

window.updateSearchFilter = function(type, val) {
    const params = new URLSearchParams(window.location.search);
    const currentQ = params.get('q') || '';
    let currentGenre = params.get('genre') || '';
    let currentStatus = params.get('status') || '';
    
    if (type === 'status') {
        currentStatus = currentStatus === val ? '' : val;
    } else if (type === 'genre') {
        let gArr = currentGenre ? currentGenre.split(',') : [];
        if (gArr.includes(val)) gArr = gArr.filter(g => g !== val);
        else gArr.push(val);
        currentGenre = gArr.join(',');
    }
    
    let newUrl = `/search?q=${encodeURIComponent(currentQ)}`;
    if (currentGenre) newUrl += `&genre=${encodeURIComponent(currentGenre)}`;
    if (currentStatus) newUrl += `&status=${encodeURIComponent(currentStatus)}`;
    navigate(newUrl);
};

async function renderSearchPage(q, genre = '', status = '') {
    const container = document.getElementById('search-page-container');
    const titleEl = document.getElementById('search-page-title');
    const filtersEl = document.getElementById('search-filters');
    if (!container) return;
    
    if (filtersEl) {
        const genresList = ['action', 'fantasy', 'romance', 'comedy', 'drama', 'isekai', 'adventure', 'martial-arts'];
        const statuses = ['ongoing', 'completed'];
        
        const gHTML = genresList.map(g => `<button onclick="updateSearchFilter('genre', '${g}')" class="px-4 py-1.5 md:py-2 rounded-xl text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all border ${genre.includes(g) ? 'bg-primary text-white border-primary shadow-[0_0_15px_rgba(255,69,0,0.4)]' : 'glass text-gray-400 border-white/10 hover:border-primary/50 hover:text-white'}">${g}</button>`).join('');
        const sHTML = statuses.map(s => `<button onclick="updateSearchFilter('status', '${s}')" class="px-4 py-1.5 md:py-2 rounded-xl text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all border ${status === s ? 'bg-primary text-white border-primary shadow-[0_0_15px_rgba(255,69,0,0.4)]' : 'glass text-gray-400 border-white/10 hover:border-primary/50 hover:text-white'}">${s}</button>`).join('');

        filtersEl.innerHTML = `
            <div class="w-full flex flex-col gap-3">
                <div class="flex items-center gap-2 overflow-x-auto hide-scrollbar pb-1">
                    <span class="text-[9px] text-gray-500 font-black uppercase tracking-widest flex-shrink-0 mr-1"><i class="fas fa-tags mr-1"></i> Genre</span>
                    ${gHTML}
                </div>
                <div class="flex items-center gap-2 overflow-x-auto hide-scrollbar pb-1">
                    <span class="text-[9px] text-gray-500 font-black uppercase tracking-widest flex-shrink-0 mr-1"><i class="fas fa-signal mr-1"></i> Status</span>
                    ${sHTML}
                    ${(genre || status) ? `<button onclick="navigate('/search?q=${encodeURIComponent(q)}')" class="px-3 py-1.5 ml-auto rounded-xl text-[10px] font-bold uppercase tracking-wider bg-red-500/20 text-red-400 hover:bg-red-500/40 transition-all flex-shrink-0 border border-red-500/30"><i class="fas fa-times mr-1"></i>Reset</button>` : ''}
                </div>
            </div>`;
    }

    if (titleEl) {
        if (q) titleEl.textContent = `Results: "${q}"`;
        else if (genre || status) titleEl.textContent = 'Filtered Library';
        else titleEl.textContent = 'Explore';
    }
    
    if (!q && !genre && !status) {
        container.innerHTML = `<div class="col-span-full py-20 text-center text-gray-500 font-bold uppercase tracking-widest text-sm glass-card rounded-2xl border-white/5"><i class="fas fa-search text-3xl mb-4 block opacity-50"></i>Select filters or type something to search</div>`;
        return;
    }
    
    container.innerHTML = spinnerHTML(`Searching...`);
    try {
        let fetchUrl = `${API}/manga/search?q=${encodeURIComponent(q)}`;
        if (genre) fetchUrl += `&genre=${encodeURIComponent(genre)}`;
        if (status) fetchUrl += `&status=${encodeURIComponent(status)}`;
        
        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.results?.length) {
            container.innerHTML = `<div class="col-span-full py-20 text-center text-gray-500 font-bold uppercase tracking-widest text-sm glass-card rounded-2xl border-white/5"><i class="fas fa-ghost text-3xl mb-4 block opacity-50"></i>No results found</div>`;
            return;
        }
        container.innerHTML = data.results.map((m, i) => `
            <div onclick="navigate('/manga?url=${encodeURIComponent(m.url)}', this)"
                class="glass-card rounded-2xl overflow-hidden group cursor-pointer flex flex-col border border-white/5 active:scale-95 transition-all duration-300 animate-fade-in-up hover:border-primary/50 hover:shadow-[0_8px_30px_rgba(255,69,0,0.2)]" style="animation-delay:${i * 0.04}s">
                <div class="relative overflow-hidden rounded-t-2xl aspect-[2/3] shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                    <img src="${proxify(m.image)}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 bg-dark-800" loading="lazy">
                    <div class="absolute inset-0 bg-gradient-to-t from-dark-900 via-transparent to-transparent opacity-80 group-hover:opacity-60 transition-opacity"></div>
                    ${getBadgeUI(m.badge)}
                </div>
                <div class="p-3 bg-dark-800/50 flex-1 flex flex-col justify-between">
                    <h3 class="text-xs font-bold font-display line-clamp-2 group-hover:text-primary transition-colors leading-tight mb-2">${clean(m.title)}</h3>
                    <div class="flex items-center gap-1.5">
                        <i class="fas fa-bolt text-[8px] text-primary pt-0.5"></i>
                        <p class="text-[10px] text-gray-400 font-black uppercase tracking-wider truncate">${clean(m.lastChapter || 'N/A')}</p>
                    </div>
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
            <div onclick="navigate('/manga?url=${encodeURIComponent(b.url)}', this)" class="group cursor-pointer">
                <div class="relative overflow-hidden rounded-2xl aspect-[2/3] mb-3 shadow-2xl border border-white/5 group-hover:border-primary/50 transition-all">
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

        // Populate Chapter Selector
        currentChapters = d.chapters || []; // Update global list for reader selector

        document.getElementById('d-title').innerText = d.title || 'Unknown Classified';
        document.getElementById('d-synopsis').innerText = d.synopsis || 'No synopsis data recovered.';
        const proxifiedImg = proxify(d.image);
        mainImg.onload = () => { applyDynamicTheme(extractAverageColor(mainImg)); };
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

    if (floatNext) floatNext.classList.add('hidden');
    readerState.currentNormUrl = normalizeChapterUrl(url);

    container.innerHTML = `<div class="flex flex-col items-center justify-center pt-[30vh] pb-[30vh] opacity-60 animate-fade-in-up">
        <div class="w-32 h-[2px] bg-dark-800 rounded-full overflow-hidden shadow-[0_0_10px_rgba(255,69,0,0.2)]">
            <div class="h-full bg-primary w-[30%] rounded-full shadow-[0_0_15px_rgba(255,69,0,1)]" style="animation: bounce-slide 1.5s infinite ease-in-out;"></div>
        </div>
        <p class="text-[9px] font-black tracking-[0.4em] uppercase text-primary mt-6">Loading Pages</p>
    </div>
    <style>@keyframes bounce-slide { 0% { transform: translateX(-100%); width: 30%; } 50% { width: 50%; } 100% { transform: translateX(350%); width: 30%; } }</style>`;

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

        // Standardize Title Info
        const params = new URLSearchParams(window.location.search);
        const mangaUrl = params.get('mangaUrl');
        const rawTitle = params.get('title') || title;
        const dashIdx = rawTitle.indexOf(' - ');
        const mangaTitle = dashIdx > -1 ? rawTitle.substring(0, dashIdx) : rawTitle;
        const chapterName = dashIdx > -1 ? rawTitle.substring(dashIdx + 3) : 'Chapter';

        if (!data.images?.length) {
            container.innerHTML = `<div class="mt-40 text-center px-4 animate-fade-in-up">
                <div class="w-24 h-24 rounded-full bg-dark-800 flex items-center justify-center mx-auto mb-6">
                    <i class="fas fa-image-slash text-4xl text-gray-600"></i>
                </div>
                <h3 class="text-white font-black font-display text-xl mb-2">PAGES CLASSIFIED</h3>
                <p class="text-xs text-gray-500 max-w-sm mx-auto">Source materials could not be extracted (possible 403 or 404).</p>
                <button onclick="renderReader('${url.replace(/'/g, "\\'")}${url.includes('?') ? '&' : '?'}nocache=1','${title.replace(/'/g, "\\'")}' )"
                    class="mt-8 bg-white/5 hover:bg-primary border border-white/10 px-8 py-3 rounded-2xl text-[10px] uppercase font-black tracking-widest transition-all">Attempt Bypass</button>
            </div>`;
            return;
        }
        if (mangaUrl) {
            addToHistory({ title: mangaTitle, url: mangaUrl, image: data.images[0] }, { name: chapterName, url: normalizeChapterUrl(url) });
        }

        container.innerHTML = data.images.map((src, i) => `
            <img src="${proxify(src)}"
                class="w-full block transition-opacity duration-300 opacity-0 cursor-pointer"
                onclick="handleImageClick(event)"
                ondblclick="toggleImageZoom(this)"
                onload="this.classList.remove('opacity-0')"
                loading="${i < 4 ? 'eager' : 'lazy'}"
                onerror="this.style.display='none'">`).join('');
        
        container.classList.remove('cursor-pointer');
        container.onclick = null;
                
        readerState.nextChapterPreloaded = false;

        // Apply reader settings and populate selector
        applyPersistedReaderSettings();
        const selector = document.getElementById('chapter-selector');
        const populateSelector = () => {
            if (selector && currentChapters.length > 0) {
                selector.innerHTML = currentChapters.map(ch => {
                    const isAltCh = url.includes('1668manga.com') || isAlt;
                    const path = `/read?url=${encodeURIComponent(ch.url)}&mangaUrl=${encodeURIComponent(mangaUrl)}&title=${encodeURIComponent(`${mangaTitle} - ${clean(ch.name)}`)}${isAltCh ? '&alt=1' : ''}`;
                    const isSelected = normalizeChapterUrl(ch.url) === readerState.currentNormUrl;
                    return `<option class="bg-gray-900 text-white" value="${path}" ${isSelected ? 'selected' : ''}>${clean(ch.name)}</option>`;
                }).join('');
            }
        };

        if (currentChapters.length > 0) {
            populateSelector();
        } else if (mangaUrl && selector) {
            // Fetch silently if loaded directly
            const fetchUrl = isAlt ? `${API}/alt/manga?url=${encodeURIComponent(mangaUrl)}` : `${API}/manga/details?url=${encodeURIComponent(mangaUrl)}`;
            fetch(fetchUrl).then(r => r.json()).then(d => {
                if (d.chapters?.length) {
                    currentChapters = d.chapters;
                    populateSelector();
                } else {
                    selector.innerHTML = '<option class="bg-gray-900 text-white">No Chapters</option>';
                }
            }).catch(() => {
                selector.innerHTML = '<option class="bg-gray-900 text-red-500">Error Loading</option>';
            });
        }

        // FEATURE C: Removed page counter as requested by user.
        // Reading progress is now shown alone via the progress bar.

        // Build nav
        const mangaUrlParam = mangaUrl ? `&mangaUrl=${encodeURIComponent(mangaUrl)}` : '';
        let navInlineHtml = '<div class="w-full max-w-2xl mx-auto flex flex-col md:flex-row justify-between gap-4 mt-8 mb-20 px-4">';

        if (data.prevUrl) {
            const decoded = decodeURIComponent(data.prevUrl).split('?')[0];
            const chName = extractChapterNameFromUrl(decoded);
            const t = mangaTitle ? `${mangaTitle} - ${chName || 'Previous Chapter'}` : 'Previous Chapter';
            const prevPath = `/read?url=${encodeURIComponent(decoded)}&title=${encodeURIComponent(t)}${mangaUrlParam}`;
            readerState.prevPath = prevPath;
            navInlineHtml += `<button onclick="navigate('${prevPath}', null, true)"
                class="flex-1 glass border border-white/10 hover:border-white/30 px-6 py-4 rounded-3xl text-xs font-bold tracking-widest uppercase transition-all duration-300 flex items-center justify-center gap-3">
                <i class="fas fa-arrow-left opacity-70"></i> Prev Chapter
            </button>`;
        }

        if (data.nextUrl) {
            const decoded = decodeURIComponent(data.nextUrl).split('?')[0];
            const chName = extractChapterNameFromUrl(decoded);
            const t = mangaTitle ? `${mangaTitle} - ${chName || 'Next Chapter'}` : 'Next Chapter';
            const nextPath = `/read?url=${encodeURIComponent(decoded)}&title=${encodeURIComponent(t)}${mangaUrlParam}`;
            readerState.nextPath = nextPath;
            navInlineHtml += `<button onclick="navigate('${nextPath}', null, true)"
                class="flex-1 bg-gradient-to-r from-primary to-secondary hover:brightness-110 px-8 py-4 rounded-3xl text-sm md:text-xs font-black tracking-widest uppercase transition-all duration-300 shadow-[0_0_30px_rgba(255,69,0,0.3)] flex items-center justify-center gap-3">
                Next Chapter <i class="fas fa-arrow-right"></i>
            </button>`;
        }
        navInlineHtml += '</div>';
        container.innerHTML += navInlineHtml;

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
    const readerView = document.getElementById('reader-view');
    if (!readerView) return;
    
    // Update Progress Bar
    const pbar = document.getElementById('r-progress-bar');
    if (pbar) {
        let p = 0;
        const sh = readerView.scrollHeight - readerView.clientHeight;
        if (sh > 0) p = (readerView.scrollTop / sh) * 100;
        pbar.style.width = `${Math.min(100, Math.max(0, p))}%`;
    }

    if (readerState.currentNormUrl) {
        const scrollY = readerView.scrollTop;
        const scrollHeight = readerView.scrollHeight - readerView.clientHeight;
        saveScrollProgress(readerState.currentNormUrl, scrollY);
        
        // 0-ms Preloading: Fetch ALL images when 50% scrolled
        if (scrollHeight > 0 && !readerState.nextChapterPreloaded && readerState.nextPath) {
            if ((scrollY / scrollHeight) >= 0.5) {
                readerState.nextChapterPreloaded = true;
                const urlMatch = readerState.nextPath.match(/url=([^&]+)/);
                if (urlMatch) preloadNextChapter(decodeURIComponent(urlMatch[1]));
            }
        }
    }
}

// ══════════════════════════════════════════════════
//  GLOBAL HANDLERS
// ══════════════════════════════════════════════════

function handleImageClick(e, isImmersiveTrigger = false) {
    const readerView = document.getElementById('reader-view');
    const top = document.getElementById('reader-topbar');
    const floats = document.getElementById('reader-floats');
    const pbar = document.getElementById('r-progress-bar')?.parentElement;
    const settings = document.getElementById('reader-settings');

    // Smart Auto-Hide: Close settings if open
    if (settings && !settings.classList.contains('hidden')) {
        toggleReaderSettings();
    }

    const y = e.clientY;
    const h = window.innerHeight;

    // TAP ZONES: Top 20% or Bottom 20% of screen = TOGGLE UI (Don't scroll)
    if (y <= h * 0.20 || y >= h * 0.80 || isImmersiveTrigger) {
        [top, floats, pbar].forEach(el => {
            if (el) el.classList.toggle('ui-hidden');
        });
        return;
    }

    // MIDDLE ZONE: Hide UI and Scroll
    [top, floats, pbar].forEach(el => {
        if (el) el.classList.add('ui-hidden');
    });

    if (readerView) {
        if (y <= h * 0.25) {
            readerView.scrollBy({ top: -h * 0.8, behavior: 'smooth' });
        } else {
            readerView.scrollBy({ top: h * 0.8, behavior: 'smooth' });
        }
    }
}

let zoomedImg = null;
window.toggleImageZoom = function(img) {
    if (zoomedImg === img) {
        img.style.transform = 'scale(1)';
        img.style.transformOrigin = 'center center';
        zoomedImg = null;
    } else {
        if (zoomedImg) zoomedImg.style.transform = 'scale(1)';
        img.style.transform = 'scale(2)';
        img.style.transformOrigin = 'center center';
        img.style.transition = 'transform 0.3s ease';
        zoomedImg = img;
    }
};

// ══════════════════════════════════════════════════
//  GAMIFICATION / PROFILE
// ══════════════════════════════════════════════════

window.renderProfilePage = function() {
    const container = document.getElementById('profile-page-container');
    if (!container) return;
    
    const stats = JSON.parse(localStorage.getItem('sm_stats') || '{"totalRead": 0, "weekRead": 0}');
    const total = stats.totalRead || 0;
    const week = stats.weekRead || 0;
    
    let badge = { title: 'Novice (นักอ่านฝึกหัด)', icon: 'fa-seedling', desc: 'Read your first chapters', color: 'from-green-500 to-emerald-700' };
    let nextThreshold = 100;
    
    if (total >= 1000) {
        badge = { title: 'Manga Master (เซียนมังงะ)', icon: 'fa-crown', desc: 'The Archive Legend', color: 'from-amber-400 to-orange-600' };
        nextThreshold = total;
    } else if (total >= 500) {
        badge = { title: 'Otaku (ผู้คลั่งไคล้)', icon: 'fa-dragon', desc: 'Read 500+ Chapters', color: 'from-pink-500 to-rose-700' };
        nextThreshold = 1000;
    } else if (total >= 100) {
        badge = { title: 'Bookworm (หนอนหนังสือ)', icon: 'fa-book-open', desc: 'Read 100+ Chapters', color: 'from-blue-400 to-indigo-600' };
        nextThreshold = 500;
    }

    const progressPercent = Math.min(100, (total / nextThreshold) * 100);

    container.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <!-- Badge Card -->
            <div class="lg:col-span-2 glass-card rounded-[2rem] md:rounded-[2.5rem] p-6 md:p-10 flex flex-col md:flex-row items-center gap-6 md:gap-10 border-t border-white/10 shadow-2xl relative overflow-hidden group">
                <div class="absolute inset-0 bg-gradient-to-br ${badge.color} opacity-[0.03]"></div>
                
                <div class="relative w-32 h-32 md:w-48 md:h-48 rounded-full border-4 border-white/5 bg-dark-900 flex items-center justify-center shadow-2xl overflow-hidden group-hover:scale-105 transition-transform duration-500 flex-shrink-0">
                    <div class="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent"></div>
                    <i class="fas ${badge.icon} text-7xl text-transparent bg-clip-text bg-gradient-to-br ${badge.color} animate-pulse-slow"></i>
                </div>
                
                <div class="flex-1 text-center md:text-left space-y-3 md:space-y-4">
                    <div class="inline-block px-4 py-1 rounded-full bg-white/5 border border-white/10 text-[9px] font-black uppercase tracking-widest text-gray-400">Current Rank</div>
                    <h3 class="text-3xl md:text-5xl font-black font-display uppercase tracking-tighter text-transparent bg-clip-text bg-gradient-to-br ${badge.color}">${badge.title}</h3>
                    <p class="text-xs md:text-sm text-gray-400 font-medium">"${badge.desc}"</p>
                    
                    <div class="pt-6 space-y-3">
                        <div class="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                            <span class="text-gray-500">Rank Progress</span>
                            <span class="text-white">${total} / ${nextThreshold}</span>
                        </div>
                        <div class="h-2 w-full bg-white/5 rounded-full overflow-hidden shadow-inner">
                            <div class="h-full bg-gradient-to-r ${badge.color} rounded-full" style="width: ${progressPercent}%"></div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Stats Column -->
            <div class="space-y-6">
                <div class="glass-card rounded-[2rem] p-8 border-l-4 border-primary transition-all hover:translate-x-1">
                    <div class="flex justify-between items-start mb-4">
                        <i class="fas fa-layer-group text-2xl text-primary/40"></i>
                        <span class="px-3 py-1 bg-primary/10 rounded-full text-[9px] font-black text-primary uppercase">Lifetime</span>
                    </div>
                    <p class="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">Total Chapters Read</p>
                    <h4 class="text-5xl font-black font-display text-white">${total.toLocaleString()}</h4>
                </div>
                
                <div class="glass-card rounded-[2rem] p-8 border-l-4 border-pink-500 transition-all hover:translate-x-1">
                    <div class="flex justify-between items-start mb-4">
                        <i class="fas fa-fire text-2xl text-pink-500/40 animate-bounce"></i>
                        <span class="px-3 py-1 bg-pink-500/10 rounded-full text-[9px] font-black text-pink-500 uppercase">Streak</span>
                    </div>
                    <p class="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">Chapters This Week</p>
                    <h4 class="text-5xl font-black font-display text-pink-500">${week.toLocaleString()}</h4>
                </div>
            </div>
        </div>
        
        <div class="mt-12 glass-card rounded-2xl p-6 text-center border-white/5">
            <p class="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center justify-center gap-3">
                <i class="fas fa-info-circle text-primary"></i>
                More achievements and personalized recommendations based on your stats are coming soon!
            </p>
        </div>
    `;
};

function exitToDetail() {
    const params = new URLSearchParams(window.location.search);
    const mangaUrl = params.get('mangaUrl');
    
    // Smooth reset scroll position before exiting
    window.scrollTo(0, 0);

    if (mangaUrl) {
        navigate(`/manga?url=${encodeURIComponent(mangaUrl)}`);
    } else if (lastMainPath) {
        navigate(lastMainPath);
    } else {
        navigate('/');
    }
}

function toggleMobileMenu() {
    const overlay = document.getElementById('mobile-menu-overlay');
    if (!overlay) return;
    if (overlay.classList.contains('hidden')) {
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
        document.body.style.overflow = 'hidden';
    } else {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        document.body.style.overflow = '';
    }
}

function exitDetail() {
    // If we have a saved browse path, go there. 
    // This prevents going back into the Reader from Detail view.
    if (lastMainPath) {
        navigate(lastMainPath);
    } else {
        navigate('/');
    }
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