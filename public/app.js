/**
 * SpeedManga - App Logic (Optimized Frontend v4)
 */

'use strict';

const API = '/api';
let HISTORY = JSON.parse(localStorage.getItem('sm_history') || '[]');
let BOOKMARKS = JSON.parse(localStorage.getItem('sm_bookmarks') || '[]');
let READ_CHAPTERS = JSON.parse(localStorage.getItem('sm_read_chapters') || '[]');

// ══════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════

const clean = (s) => (s || '').replace(/[<>"'`]/g, '').trim();
const proxify = (u) => u && u.startsWith('http') ? `${API}/proxy?url=${encodeURIComponent(u)}` : u;

window.handleImgError = (img) => {
    if (!img.dataset.retried) {
        img.dataset.retried = "true";
        const originalUrl = decodeURIComponent(img.src.split('url=')[1] || img.src);
        if (originalUrl && originalUrl.startsWith('http')) {
            console.log('[Retry] Attempting direct load:', originalUrl);
            img.src = originalUrl;
        }
    } else {
        img.style.display = 'none';
    }
};

window.toggleReaderUI = () => {
    const bars = ['reader-topbar', 'reader-floats', 'reader-footer'];
    bars.forEach(id => document.getElementById(id).classList.toggle('ui-hidden'));
};

// ══════════════════════════════════════════════════
//  ROUTING
// ══════════════════════════════════════════════════

window.navigate = (path) => {
    window.history.pushState({}, '', path);
    handleLocation();
};

window.onpopstate = handleLocation;

async function handleLocation() {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const targetUrl = params.get('url');
    const targetTitle = params.get('title');
    const page = Math.max(1, parseInt(params.get('page')) || 1);

    // Reset views
    ['home-view', 'detail-view', 'reader-view', 'list-view'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById('main-header').classList.remove('hidden');
    document.body.style.overflow = 'auto';

    if (path === '/read' && targetUrl) {
        document.getElementById('reader-view').classList.remove('hidden');
        document.getElementById('main-header').classList.add('hidden');
        document.body.style.overflow = 'hidden'; // Lock body scroll, scroll in reader-view
        await renderReader(targetUrl, targetTitle || 'Reading...');
    } else if (path === '/manga' && targetUrl) {
        document.getElementById('detail-view').classList.remove('hidden');
        await renderDetail(targetUrl);
    } else if (path === '/history') {
        renderList('History', HISTORY);
    } else if (path === '/bookmarks') {
        renderList('Bookmarks', BOOKMARKS);
    } else {
        document.getElementById('home-view').classList.remove('hidden');
        await renderHome(page);
    }
}

// ══════════════════════════════════════════════════
//  RENDER FUNCTIONS
// ══════════════════════════════════════════════════

async function renderHome(page) {
    const updatesEl = document.getElementById('updates-container');
    const popularEl = document.getElementById('popular-container');
    updatesEl.innerHTML = `<div class="col-span-full py-20 text-center text-gray-500 animate-pulse">SYNCHRONIZING ARCHIVES...</div>`;

    try {
        const res = await fetch(`${API}/manga/home?page=${page}`);
        const data = await res.json();

        document.getElementById('page-indicator').innerText = `PAGE ${page}`;
        const btnPrev = document.getElementById('btn-prev');
        if (page > 1) {
            btnPrev.classList.remove('hidden');
            btnPrev.onclick = () => navigate(`/?page=${page - 1}`);
        } else btnPrev.classList.add('hidden');
        document.getElementById('btn-next').onclick = () => navigate(`/?page=${page + 1}`);

        // Trending
        if (data.popular) {
            popularEl.innerHTML = data.popular.map(m => `
                <div onclick="navigate('/manga?url=${encodeURIComponent(m.url)}')" class="flex-none w-40 group cursor-pointer snap-start">
                    <div class="relative overflow-hidden rounded-xl aspect-[2/3] mb-2 border border-white/5">
                        <img src="${proxify(m.image)}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" loading="lazy">
                        <div class="absolute inset-0 bg-gradient-to-t from-black via-transparent opacity-60"></div>
                    </div>
                    <h3 class="text-xs font-bold text-center truncate">${clean(m.title)}</h3>
                </div>`).join('');
        }

        // Latest
        updatesEl.innerHTML = data.updates.map(m => `
            <div onclick="navigate('/manga?url=${encodeURIComponent(m.url)}')" class="glass-card p-4 rounded-2xl flex gap-4 cursor-pointer hover:border-primary/40 transition-all">
                <img src="${proxify(m.image)}" class="w-24 aspect-[2/3] object-cover rounded-xl shadow-lg" loading="lazy">
                <div class="flex flex-col justify-between py-1 overflow-hidden">
                    <div>
                        <h3 class="text-sm font-bold line-clamp-2 leading-tight mb-3">${clean(m.title)}</h3>
                        <div class="flex flex-wrap gap-1">
                            ${(m.chapters || []).map(ch => `
                                <span class="bg-primary/10 text-primary text-[10px] px-2 py-0.5 rounded-lg font-bold">CH. ${clean(ch.name.replace(/\D/g, '')) || clean(ch.name)}</span>
                            `).join('')}
                        </div>
                    </div>
                    <span class="text-[10px] text-gray-500 uppercase tracking-widest">${clean(m.time || 'NEW')}</span>
                </div>
            </div>`).join('');
    } catch (e) { updatesEl.innerHTML = `<div class="col-span-full py-20 text-center text-red-500">FAILED TO CONNECT: ${e.message}</div>`; }
}

async function renderDetail(url) {
    const chaptersEl = document.getElementById('d-chapters');
    chaptersEl.innerHTML = `<div class="col-span-full py-12 text-center text-gray-600">DECRYPTING CHAPTERS...</div>`;

    try {
        const res = await fetch(`${API}/manga/details?url=${encodeURIComponent(url)}`);
        const d = await res.json();

        document.getElementById('d-title').innerText = d.title;
        document.getElementById('d-synopsis').innerText = d.synopsis || 'No synopsis available.';
        document.getElementById('d-image').src = proxify(d.image);
        document.getElementById('detail-bg').style.backgroundImage = `url('${proxify(d.image)}')`;

        document.getElementById('d-info').innerHTML = Object.entries(d.info || {}).map(([k, v]) => `
            <span class="glass px-3 py-1.5 rounded-lg text-gray-400"><b>${k}:</b> ${v}</span>
        `).join('');

        // Quick Actions
        const qaEl = document.getElementById('d-quick-actions');
        const isBookmarked = BOOKMARKS.some(b => b.url === url);
        qaEl.innerHTML = `
            <button onclick="toggleBookmark('${encodeURIComponent(JSON.stringify(d))}')" class="px-6 py-3 rounded-xl glass font-bold text-xs uppercase ${isBookmarked ? 'text-blue-400' : ''}">
                <i class="fa${isBookmarked ? 's' : 'r'} fa-bookmark mr-2"></i> ${isBookmarked ? 'Bookmarked' : 'Bookmark'}
            </button>
        `;

        chaptersEl.innerHTML = (d.chapters || []).map(c => {
            const isRead = READ_CHAPTERS.includes(c.url);
            return `
            <button onclick="navigate('/read?url=${encodeURIComponent(c.url)}&mangaUrl=${encodeURIComponent(url)}&title=${encodeURIComponent(`${clean(d.title)} - ${clean(c.name)}`)}')"
                class="glass hover:bg-white/10 p-4 rounded-xl text-left border ${isRead ? 'border-primary/40 bg-primary/5' : 'border-white/5'} transition-all group">
                <p class="text-xs font-bold truncate group-hover:text-primary">${clean(c.name)}</p>
                <span class="text-[9px] text-gray-500 uppercase tracking-widest">${clean(c.time)}</span>
            </button>`;
        }).join('');
    } catch (e) { chaptersEl.innerHTML = `<div class="col-span-full text-red-500 text-center">${e.message}</div>`; }
}

async function renderReader(url, title) {
    const container = document.getElementById('r-images');
    const navBottom = document.getElementById('reader-nav-bottom');
    const readerView = document.getElementById('reader-view');

    document.getElementById('r-title').innerText = title;
    container.innerHTML = `<div class="py-40 flex flex-col items-center gap-4"><div class="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div><p class="text-xs font-bold text-gray-500">DECRYPTING PAGES...</p></div>`;
    navBottom.innerHTML = '';
    readerView.scrollTo(0, 0);

    try {
        const res = await fetch(`${API}/manga/read?url=${encodeURIComponent(url)}`);
        const data = await res.json();

        // Track History
        const params = new URLSearchParams(window.location.search);
        const mangaUrl = params.get('mangaUrl');
        if (mangaUrl && data.images?.length > 0) {
            updateHistory({ title: title.split(' - ')[0], url: mangaUrl, image: data.images[0], lastChapter: title.split(' - ')[1] });
            if (!READ_CHAPTERS.includes(url)) {
                READ_CHAPTERS.push(url);
                localStorage.setItem('sm_read_chapters', JSON.stringify(READ_CHAPTERS.slice(-1000)));
            }
        }

        container.innerHTML = data.images.map((src, i) => `
            <img src="${proxify(src)}"
                onerror="handleImgError(this)"
                onload="this.classList.remove('opacity-0')"
                class="transition-opacity duration-700 opacity-0"
                loading="${i < 4 ? 'eager' : 'lazy'}">`
        ).join('');

        // Navigation
        if (data.prevUrl) navBottom.innerHTML += `<button onclick="navigate('/read?url=${encodeURIComponent(data.prevUrl)}&mangaUrl=${encodeURIComponent(mangaUrl)}&title=Previous')" class="glass px-8 py-3 rounded-xl font-bold text-xs uppercase">PREV</button>`;
        if (data.nextUrl) {
            const nextAction = () => navigate(`/read?url=${encodeURIComponent(data.nextUrl)}&mangaUrl=${encodeURIComponent(mangaUrl)}&title=Next`);
            navBottom.innerHTML += `<button onclick="handleNextClick()" class="bg-primary px-10 py-3 rounded-xl font-bold text-xs uppercase">NEXT</button>`;
            window.handleNextClick = nextAction;
            document.getElementById('float-next-btn').onclick = nextAction;
            document.getElementById('float-next-btn').classList.remove('hidden');
        } else {
            document.getElementById('float-next-btn').classList.add('hidden');
        }

    } catch (e) { container.innerHTML = `<div class="py-40 text-center text-red-500">${e.message}</div>`; }
}

function renderList(title, list) {
    const el = document.getElementById('list-view');
    const container = document.getElementById('list-container');
    document.getElementById('list-title').innerText = title;
    el.classList.remove('hidden');

    if (list.length === 0) {
        container.innerHTML = `<div class="col-span-full py-20 text-center text-gray-600">No entries found.</div>`;
        return;
    }

    container.innerHTML = list.map(m => `
        <div onclick="navigate('/manga?url=${encodeURIComponent(m.url)}')" class="glass-card p-4 rounded-2xl flex gap-4 cursor-pointer hover:border-primary/40 transition-all">
            <img src="${proxify(m.image)}" class="w-20 aspect-[2/3] object-cover rounded-xl" loading="lazy">
            <div class="flex flex-col justify-center overflow-hidden">
                <h3 class="text-sm font-bold truncate">${clean(m.title)}</h3>
                <p class="text-[10px] text-primary font-bold mt-1 uppercase">${clean(m.lastChapter)}</p>
            </div>
        </div>`).join('');
}

// ══════════════════════════════════════════════════
//  STATE MANAGEMENT
// ══════════════════════════════════════════════════

function updateHistory(m) {
    HISTORY = [m, ...HISTORY.filter(x => x.url !== m.url)].slice(0, 30);
    localStorage.setItem('sm_history', JSON.stringify(HISTORY));
}

window.toggleBookmark = (mStr) => {
    const m = JSON.parse(decodeURIComponent(mStr));
    const idx = BOOKMARKS.findIndex(x => x.url === m.url);
    if (idx > -1) BOOKMARKS.splice(idx, 1);
    else BOOKMARKS.unshift({ title: m.title, url: m.url, image: m.image, lastChapter: m.chapters?.[0]?.name || 'READ' });
    localStorage.setItem('sm_bookmarks', JSON.stringify(BOOKMARKS.slice(0, 100)));
    handleLocation();
};

handleLocation();