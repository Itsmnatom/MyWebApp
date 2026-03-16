/**
 * SpeedManga - Frontend App (Premium Aesthetic v3)
 * Featuring glassmorphism, micro-animations, and dynamic blurred backgrounds.
 */

'use strict';

const API = '/api';

// ══════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════

function clean(str) {
    return (str || '').replace(/[<>"'`\n\r\\]/g, ' ').trim();
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
    return `<div class="absolute top-4 right-4 z-10 ${color} text-white font-black text-[10px] px-3 py-1 rounded-full uppercase tracking-widest shadow-xl">
        ${clean(badge)}
    </div>`;
}

// ══════════════════════════════════════════════════
//  PERSISTENCE (Bookmarks & History)
// ══════════════════════════════════════════════════

let BOOKMARKS = JSON.parse(localStorage.getItem('sm_bookmarks') || '[]');
let HISTORY = JSON.parse(localStorage.getItem('sm_history') || '[]');
let READ_CHAPTERS = JSON.parse(localStorage.getItem('sm_read_chapters') || '[]');

function saveState() {
    localStorage.setItem('sm_bookmarks', JSON.stringify(BOOKMARKS.slice(0, 50)));
    localStorage.setItem('sm_history', JSON.stringify(HISTORY.slice(0, 15)));
    localStorage.setItem('sm_read_chapters', JSON.stringify(READ_CHAPTERS.slice(0, 500)));
}

function toggleBookmark(manga) {
    const idx = BOOKMARKS.findIndex(b => b.url === manga.url);
    if (idx > -1) BOOKMARKS.splice(idx, 1);
    else BOOKMARKS.unshift({ title: manga.title, url: manga.url, image: manga.image, lastChapter: manga.lastChapter });
    saveState();
    if (document.getElementById('detail-view').classList.contains('hidden') === false) {
        renderBookmarkBtn(manga.url);
    }
}

function addToHistory(manga, chapter) {
    // manga: { title, url, image }, chapter: { name, url }
    const entry = {
        title: manga.title,
        mangaUrl: manga.url,
        image: manga.image,
        chapterName: chapter.name,
        chapterUrl: chapter.url,
        time: Date.now()
    };
    HISTORY = [entry, ...HISTORY.filter(h => h.mangaUrl !== manga.url)].slice(0, 15);
    
    // Also track as read chapter
    if (chapter.url && !READ_CHAPTERS.includes(chapter.url)) {
        READ_CHAPTERS.unshift(chapter.url);
    }
    
    saveState();
}

function renderBookmarkBtn(mangaUrl) {
    const isBookmarked = BOOKMARKS.some(b => b.url === mangaUrl);
    const qaEl = document.getElementById('d-quick-actions');
    const existingBtn = document.getElementById('btn-bookmark');
    
    const btnHtml = `
        <button id="btn-bookmark" onclick="handleBookmarkToggle()" 
            class="${isBookmarked ? 'bg-blue-600' : 'bg-white/10 hover:bg-white/20'} border border-white/10 px-6 py-3 rounded-2xl text-xs font-black tracking-widest uppercase transition-all duration-300 flex items-center gap-3">
            <i class="fa${isBookmarked ? 's' : 'r'} fa-bookmark"></i> ${isBookmarked ? 'Bookmarked' : 'Bookmark'}
        </button>`;

    if (existingBtn) existingBtn.outerHTML = btnHtml;
    else qaEl.insertAdjacentHTML('afterbegin', btnHtml);
}

function skeletonCards(count = 4, className = 'h-64') {
    return Array(count).fill(0).map((_, i) =>
        `<div class="skeleton ${className} rounded-2xl animate-pulse" style="animation-delay: ${i * 0.1}s"></div>`
    ).join('');
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

    // Reset views
    ['home-view', 'detail-view', 'reader-view'].forEach(id => {
        const el = document.getElementById(id);
        el.classList.add('hidden');
        el.classList.remove('animate-fade-in-up'); // Reset animation
    });
    
    document.getElementById('main-header').classList.remove('-translate-y-full');
    document.body.style.overflow = 'auto';
    window.scrollTo(0, 0);

    if (path === '/read' && targetUrl) {
        document.getElementById('reader-view').classList.remove('hidden');
        document.body.style.overflow = 'hidden'; 
        document.getElementById('main-header').classList.add('-translate-y-full'); 
        await renderReader(targetUrl, targetTitle || 'Reading...');
    } else if (path === '/manga' && targetUrl) {
        const dView = document.getElementById('detail-view');
        dView.classList.remove('hidden');
        dView.classList.add('animate-fade-in-up');
        await renderDetail(targetUrl);
    } else {
        const hView = document.getElementById('home-view');
        hView.classList.remove('hidden');
        hView.classList.add('animate-fade-in-up');
        
        // Instant Load from Cache
        if (page === 1) {
            const cachedHome = localStorage.getItem('cache_home_1');
            if (cachedHome) {
                try {
                    const data = JSON.parse(cachedHome);
                    displayHome(data, 1, true); // display with 'fromCache' flag
                } catch(e) {}
            }
            renderLocalSections();
        }
        await renderHome(page);
    }
}

function renderLocalSections() {
    const hSection = document.getElementById('history-section');
    const bSection = document.getElementById('bookmarks-section');
    const hContainer = document.getElementById('history-container');
    const bContainer = document.getElementById('bookmarks-container');

    // History
    if (HISTORY.length > 0) {
        hSection.classList.remove('hidden');
        hContainer.innerHTML = HISTORY.map(h => `
            <div onclick="navigate('/read?url=${encodeURIComponent(h.chapterUrl)}&title=${encodeURIComponent(`${clean(h.title)} - ${clean(h.chapterName)}`)}')"
                class="glass-card rounded-2xl overflow-hidden group cursor-pointer flex p-3 gap-4 border border-white/5 active:scale-95 transition-all duration-300 shadow-lg">
                <div class="relative flex-shrink-0 w-16 aspect-[2/3] overflow-hidden rounded-xl border border-white/5">
                    <img src="${proxify(h.image)}" class="w-full h-full object-cover bg-dark-800" loading="lazy">
                </div>
                <div class="flex flex-col justify-center min-w-0 flex-1">
                    <h3 class="text-xs font-bold font-display line-clamp-1 group-hover:text-primary transition-colors">${clean(h.title)}</h3>
                    <p class="text-[10px] text-primary font-black uppercase tracking-wider mt-1 mb-2">Resume: ${clean(h.chapterName)}</p>
                    <div class="flex items-center gap-2 text-[9px] text-gray-500 font-bold uppercase">
                        <i class="far fa-clock"></i> <span>Recent</span>
                    </div>
                </div>
            </div>
        `).join('');
    } else hSection.classList.add('hidden');

    // Bookmarks
    if (BOOKMARKS.length > 0) {
        bSection.classList.remove('hidden');
        bContainer.innerHTML = BOOKMARKS.map(b => `
            <div onclick="navigate('/manga?url=${encodeURIComponent(b.url)}')" 
                class="flex-none w-32 md:w-40 group cursor-pointer snap-start">
                <div class="relative overflow-hidden rounded-2xl aspect-[2/3] mb-2 shadow-xl border border-white/5 group-hover:border-blue-500/50 transition-all">
                    <img src="${proxify(b.image)}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 bg-dark-800" loading="lazy">
                    <div class="absolute inset-0 bg-gradient-to-t from-dark-900 via-transparent to-transparent opacity-60"></div>
                </div>
                <h3 class="text-[10px] md:text-xs font-bold font-display line-clamp-1 group-hover:text-blue-400 text-center px-1">${clean(b.title)}</h3>
            </div>
        `).join('');
    } else bSection.classList.add('hidden');
}

// ══════════════════════════════════════════════════
//  RENDER: HOME
// ══════════════════════════════════════════════════

async function renderHome(page) {
    const popSection = document.getElementById('popular-section');
    const upContainer = document.getElementById('updates-container');
    
    // Only show spinner if we don't have cached data showing
    if (!upContainer.innerHTML || upContainer.innerHTML.includes('skeleton')) {
        upContainer.innerHTML = spinnerHTML(`Synchronizing Page ${page}...`);
    }

    try {
        const res = await fetch(`${API}/manga/home?page=${page}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        // Save to cache for instant load next time (only page 1)
        if (page === 1 && data.updates?.length > 0) {
            localStorage.setItem('cache_home_1', JSON.stringify(data));
        }

        displayHome(data, page);
    } catch (e) {
        upContainer.innerHTML = errorHTML(e.message, `renderHome(${page})`);
        if (page === 1) popSection.style.display = 'none';
    }
}

function displayHome(data, page, fromCache = false) {
    const popContainer = document.getElementById('popular-container');
    const upContainer = document.getElementById('updates-container');
    const popSection = document.getElementById('popular-section');

    popSection.style.display = page === 1 ? 'block' : 'none';
    document.getElementById('page-indicator').innerText = `PAGE ${page}`;
    
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    
    if (page <= 1) btnPrev.classList.add('hidden');
    else {
        btnPrev.classList.remove('hidden');
        btnPrev.onclick = () => navigate(`/?page=${page - 1}`);
    }
    
    btnNext.onclick = () => navigate(`/?page=${page + 1}`);
    btnNext.disabled = false;
    btnNext.classList.remove('opacity-50', 'pointer-events-none');

    const { popular = [], updates = [] } = data;

    // ── Popular ─────────────────
    if (page === 1 && popular.length > 0) {
        popContainer.innerHTML = popular.map((m, i) => `
            <div onclick="navigate('/manga?url=${encodeURIComponent(m.url)}')" class="flex-none w-40 md:w-56 group cursor-pointer ${fromCache ? '' : 'animate-fade-in-up'} snap-start" style="animation-delay: ${i * 0.05}s">
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
            </div>`
        ).join('');
    } else if (page === 1) {
        popSection.style.display = 'none';
    }

    // ── Updates ───────────────────────
    if (updates.length === 0) {
        if (!fromCache) upContainer.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500 font-bold uppercase tracking-widest text-sm">No transmissions found</div>';
    } else {
        upContainer.innerHTML = updates.map((m, i) => `
            <div onclick="navigate('/manga?url=${encodeURIComponent(m.url)}')" class="glass-card rounded-2xl overflow-hidden group cursor-pointer flex p-3 md:p-4 gap-4 md:gap-5 border border-white/5 active:scale-95 transition-all duration-300 ${fromCache ? '' : 'animate-fade-in-up'}" style="animation-delay: ${i * 0.02}s">
                <div class="relative flex-shrink-0 w-24 md:w-32 aspect-[2/3] overflow-hidden rounded-xl shadow-xl group-hover:shadow-primary/20 transition-all duration-500 border border-white/5 group-hover:border-primary/50">
                    <img src="${proxify(m.image)}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out bg-dark-800" loading="lazy">
                    ${getBadgeUI(m.badge)}
                    <div class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-dark-900 to-transparent"></div>
                </div>
                <div class="flex flex-col justify-between py-1 min-w-0 flex-1">
                    <div class="space-y-2 md:space-y-3">
                        <h3 class="text-sm md:text-base font-bold font-display line-clamp-2 leading-tight transition-colors group-hover:text-primary">${clean(m.title)}</h3>
                        <div class="flex flex-wrap gap-1.5 md:gap-2">
                            ${(m.chapters && m.chapters.length > 0) ? m.chapters.map(ch => {
                                const readPath = `/read?url=${encodeURIComponent(ch.url)}&title=${encodeURIComponent(`${clean(m.title)} - ${clean(ch.name)}`)}`;
                                const isRead = READ_CHAPTERS.includes(ch.url);
                                return `
                                <div onclick="event.stopPropagation(); navigate('${readPath}')"
                                    class="${isRead ? 'bg-primary/20 border-primary/30' : 'bg-primary/10 border-transparent'} border hover:bg-primary/30 px-2 py-0.5 md:px-2.5 md:py-1 rounded-lg transition-all flex items-center gap-1.5 active:scale-95">
                                    <div class="w-1 h-1 rounded-full ${isRead ? 'bg-primary animate-none' : 'bg-primary animate-pulse'}"></div>
                                    <span class="text-[9px] md:text-[10px] font-black ${isRead ? 'text-primary' : 'text-primary/90'} uppercase tracking-tight">${clean(ch.name)}</span>
                                </div>`;
                            }).join('') : `
                                <div class="px-2.5 py-1 bg-primary/10 rounded-lg flex items-center gap-2">
                                    <div class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
                                    <span class="text-[10px] md:text-xs font-bold text-primary uppercase tracking-wider">${clean(m.lastChapter || 'NEW')}</span>
                                </div>
                            `}
                        </div>
                    </div>
                    <div class="flex items-center gap-2 text-[10px] md:text-xs text-gray-400 font-medium">
                        <i class="far fa-clock opacity-60"></i>
                        <span>${clean(m.time)}</span>
                    </div>
                </div>
            </div>`
        ).join('');
    }
}

// ══════════════════════════════════════════════════
//  RENDER: DETAIL
// ══════════════════════════════════════════════════

async function renderDetail(url) {
    const chaptersEl = document.getElementById('d-chapters');
    chaptersEl.innerHTML = spinnerHTML('Extracting Archives...');

    document.getElementById('d-title').innerText = '';
    document.getElementById('d-synopsis').innerText = '';
    document.getElementById('d-info').innerHTML = '';
    document.getElementById('detail-bg').style.backgroundImage = 'none'; // Fixed ID
    const mainImg = document.getElementById('d-image');
    mainImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

        console.log('[SpeedManga] Initiating fetch for:', url);
        const res = await fetch(`${API}/manga/details?url=${encodeURIComponent(url)}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        console.log('[SpeedManga] Fetch response status:', res.status);
        if (!res.ok) throw new Error(`HTTP ${res.status} [Link Unstable]`);
        const d = await res.json();
        if (d.error) throw new Error(d.error);

        console.log('[SpeedManga] Data metadata received:', d.title);

        document.getElementById('d-title').innerText = d.title || 'Unknown Classified';
        document.getElementById('d-synopsis').innerText = d.synopsis || 'No synopsis data recovered from archives.';
        
        const proxifiedImg = proxify(d.image);
        mainImg.src = proxifiedImg;
        document.getElementById('detail-bg').style.backgroundImage = `url('${proxifiedImg}')`; // Fixed ID

        // Render Meta Info
        document.getElementById('d-info').innerHTML = Object.entries(d.info || {}).map(([k, v]) => `
            <div class="glass px-4 py-2 rounded-xl flex items-center gap-3 hover:bg-white/5 transition-colors">
                <span class="text-primary font-black uppercase tracking-widest text-[9px] opacity-80">${clean(k)}</span>
                <span class="text-gray-200 font-medium text-xs">${clean(v)}</span>
            </div>`
        ).join('');

        // Render Chapters List & Quick Actions
        const qaEl = document.getElementById('d-quick-actions');
        qaEl.innerHTML = '';

        // Global function for bookmark button
        window.currentManga = { title: d.title, url, image: d.image, lastChapter: d.chapters?.[0]?.name || '' };
        window.handleBookmarkToggle = () => toggleBookmark(window.currentManga);
        renderBookmarkBtn(url);

        if (d.chapters?.length > 0) {
            const firstCh = [...d.chapters].sort((a, b) => a.num - b.num)[0];
            const lastCh = [...d.chapters].sort((a, b) => b.num - a.num)[0];

            if (firstCh) {
                const isFirstRead = READ_CHAPTERS.includes(firstCh.url);
                qaEl.innerHTML += `
                <button onclick="navigate('/read?url=${encodeURIComponent(firstCh.url)}&title=${encodeURIComponent(`${clean(d.title)} - ${clean(firstCh.name)}`)}')"
                    class="${isFirstRead ? 'bg-primary/20 border-primary' : 'bg-white/10 hover:bg-white/20 border-white/10'} border px-6 py-3 rounded-2xl text-xs font-black tracking-widest uppercase transition-all duration-300 flex items-center gap-3">
                    <i class="fas fa-play text-primary"></i> ${isFirstRead ? 'Read Again' : 'Read First'}
                </button>`;
            }
            if (lastCh && lastCh !== firstCh) {
                const isLastRead = READ_CHAPTERS.includes(lastCh.url);
                qaEl.innerHTML += `
                <button onclick="navigate('/read?url=${encodeURIComponent(lastCh.url)}&title=${encodeURIComponent(`${clean(d.title)} - ${clean(lastCh.name)}`)}')"
                    class="bg-gradient-to-r from-primary to-secondary hover:brightness-110 px-8 py-3 rounded-2xl text-xs font-black tracking-widest uppercase transition-all duration-300 shadow-[0_0_20px_rgba(255,69,0,0.3)] hover:-translate-y-1 flex items-center gap-3">
                    ${isLastRead ? 'Review Latest' : 'Read Latest'} <i class="fas fa-bolt text-white/80"></i>
                </button>`;
            }

            if (d.chapters && d.chapters.length > 0) {
                chaptersEl.innerHTML = d.chapters.map((c, i) => {
                    const isRead = READ_CHAPTERS.includes(c.url);
                    const readPath = `/read?url=${encodeURIComponent(c.url)}&title=${encodeURIComponent(`${clean(d.title)} - ${clean(c.name)}`)}`;
                    return `<button onclick="navigate('${readPath}')"
                        class="w-full relative overflow-hidden glass hover:bg-white/10 p-4 rounded-2xl text-left transition-all duration-200 flex justify-between items-center group border ${isRead ? 'border-primary/40 bg-primary/5' : 'border-white/5 hover:border-primary/50'}">
                        <div class="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-primary to-secondary transform ${isRead ? 'scale-x-100' : 'scale-x-0'} origin-left group-hover:scale-x-100 transition-transform duration-200"></div>
                        <div class="flex items-center gap-3 min-w-0 pr-2">
                            <div class="w-8 h-8 rounded-full ${isRead ? 'bg-primary border-primary' : 'bg-dark-800 border-white/10'} border flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:border-primary transition-colors">
                                <i class="fas ${isRead ? 'fa-check text-white' : 'fa-book-open text-gray-400 group-hover:text-white'} text-[10px]"></i>
                            </div>
                            <span class="font-bold text-sm ${isRead ? 'text-primary' : 'text-gray-200'} group-hover:text-white truncate">${clean(c.name)}</span>
                        </div>
                        <span class="text-[10px] font-bold tracking-widest uppercase ${isRead ? 'text-primary' : 'opacity-40'} group-hover:opacity-100 group-hover:text-primary transition-colors flex-shrink-0 whitespace-nowrap pl-2">${clean(c.time)}</span>
                    </button>`;
                }).join('');
            } else {
                chaptersEl.innerHTML = '<div class="col-span-full py-12 text-center text-gray-600 font-bold uppercase tracking-widest text-xs border border-dashed border-gray-800 rounded-2xl">No chapters available</div>';
            }
        } else {
            chaptersEl.innerHTML = '<div class="col-span-full py-12 text-center text-gray-600 font-bold uppercase tracking-widest text-xs border border-dashed border-gray-800 rounded-2xl">No chapters available</div>';
        }
    } catch (e) {
        chaptersEl.innerHTML = errorHTML(e.message);
    }
}

// ══════════════════════════════════════════════════
//  RENDER: READER
// ══════════════════════════════════════════════════

async function renderReader(url, title) {
    document.getElementById('r-title').innerText = title;

    const container = document.getElementById('r-images');
    const navBottom = document.getElementById('reader-nav-bottom');
    const floatNext = document.getElementById('float-next-btn');

    navBottom.innerHTML = '';
    if (floatNext) floatNext.classList.add('hidden');

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
        const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s timeout

        const cleanUrl = decodeURIComponent(url).split('?')[0]; 
        const isForce = url.includes('nocache=1') ? '&nocache=1' : '';
        const fetchUrl = `${API}/manga/read?url=${encodeURIComponent(cleanUrl)}${isForce}`;
        
        console.log('[SpeedManga] Initiating fetch for:', cleanUrl);
        const res = await fetch(fetchUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        console.log('[SpeedManga] Fetch response status:', res.status);
        if (!res.ok) throw new Error(`HTTP ${res.status} [Link Unstable]`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        // Update History
        if (data.images?.length > 0) {
            const mangaTitle = title.split(' - ')[0] || title;
            // Best effort to find mangaUrl from history or current path
            const mangaUrl = new URLSearchParams(window.location.search).get('url');
            addToHistory({ title: mangaTitle, url: mangaUrl, image: data.images[0] }, { name: title.split(' - ')[1] || 'Chapter', url: mangaUrl });
        }

        if (!data.images?.length) {
            container.innerHTML = `<div class="mt-40 text-center px-4 animate-fade-in-up">
                <div class="w-24 h-24 rounded-full bg-dark-800 flex items-center justify-center mx-auto mb-6">
                    <i class="fas fa-image-slash text-4xl text-gray-600"></i>
                </div>
                <h3 class="text-white font-black font-display text-xl mb-2">PAGES CLASSIFIED</h3>
                <p class="text-xs text-gray-500 max-w-sm mx-auto">The source materials could not be extracted. Protection systems or broken links detected.</p>
                <button onclick="renderReader('${url.replace(/'/g, "\\'")}${url.includes('?') ? '&' : '?'}nocache=1', '${title.replace(/'/g, "\\'")}')"
                    class="mt-8 bg-white/5 hover:bg-primary border border-white/10 px-8 py-3 rounded-2xl text-[10px] uppercase font-black tracking-widest transition-all">
                    Attempt Bypass Force
                </button>
            </div>`;
            return;
        }

        container.innerHTML = data.images.map((src, i) => `
            <img src="${proxify(src)}"
                class="w-full relative z-10 transition-opacity duration-500 opacity-0"
                onload="this.classList.remove('opacity-0')"
                loading="${i < 4 ? 'eager' : 'lazy'}"
                onerror="this.style.display='none'">`
        ).join('');

        // Bottom Navigation UI
        if (data.prevUrl) {
            const prevPath = `/read?url=${encodeURIComponent(decodeURIComponent(data.prevUrl))}&title=Previous`;
            navBottom.innerHTML += `<button onclick="navigate('${prevPath}')"
                class="glass hover:bg-white/10 px-6 py-3.5 rounded-2xl text-xs font-bold tracking-widest uppercase transition-all duration-300 hover:-translate-x-1 flex items-center gap-3">
                <i class="fas fa-arrow-left opacity-70"></i> Prev Chapter
            </button>`;
        }
        
        if (data.nextUrl) {
            const nextPath = `/read?url=${encodeURIComponent(decodeURIComponent(data.nextUrl))}&title=Next`;
            navBottom.innerHTML += `<button onclick="navigate('${nextPath}')"
                class="bg-gradient-to-r from-primary to-secondary hover:brightness-110 px-8 py-3.5 rounded-2xl text-xs font-black tracking-widest uppercase transition-all duration-300 shadow-[0_0_20px_rgba(255,69,0,0.3)] hover:-translate-y-1 flex items-center gap-3">
                Next Chapter <i class="fas fa-arrow-right"></i>
            </button>`;
            
            floatNext.classList.remove('hidden');
            floatNext.onclick = () => navigate(nextPath);
        }
    } catch (e) {
        container.innerHTML = `<div class="mt-40 text-center px-4 max-w-md mx-auto animate-fade-in-up">
            <div class="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6 border border-red-500/20">
                <i class="fas fa-xmark text-4xl text-red-500"></i>
            </div>
            <h3 class="text-white font-black font-display text-xl mb-3">CONNECTION LOST</h3>
            <code class="text-[10px] bg-black/50 p-3 rounded-lg block border border-red-900/30 text-gray-400 mb-6 truncate">${clean(e.message)}</code>
            <div class="flex flex-col gap-3">
                <button onclick="renderReader('${url.replace(/'/g, "\\'")}', '${title.replace(/'/g, "\\'")}')"
                    class="w-full bg-white/5 hover:bg-primary border border-white/10 hover:border-primary px-6 py-3.5 rounded-2xl text-xs font-bold tracking-widest uppercase transition-all duration-300 group">
                    <i class="fas fa-rotate-right mr-2 group-hover:rotate-180 transition-transform duration-500"></i> Retry Connection
                </button>
                <button onclick="renderReader('${url.replace(/'/g, "\\'")}${url.includes('?') ? '&' : '?'}nocache=1', '${title.replace(/'/g, "\\'")}')"
                    class="w-full bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 px-6 py-3 rounded-2xl text-[10px] font-black tracking-widest uppercase transition-all duration-300">
                    Hard Reset (Bypass Cache)
                </button>
            </div>
        </div>`;
    }
}

// ══════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════
window.onload = handleLocation;