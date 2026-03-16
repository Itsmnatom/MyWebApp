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

function getBadgeUI(badge) {
    const b = (badge || '').toLowerCase();
    if (b.includes('manhwa') || b.includes('มังฮวา')) {
        return '<div class="absolute top-2 left-2 bg-gradient-to-r from-primary to-[#ff2a5f] text-white text-[9px] font-bold tracking-widest px-2.5 py-1 rounded-full shadow-lg z-10 uppercase backdrop-blur-md">Manhwa</div>';
    }
    return '<div class="absolute top-2 left-2 glass text-white text-[9px] font-bold tracking-widest px-2.5 py-1 rounded-full shadow-lg z-10 uppercase">Manga</div>';
}

function spinnerHTML(msg = 'Authenticating Data...') {
    return `<div class="col-span-full flex flex-col items-center justify-center py-32 gap-6 animate-fade-in-up">
        <div class="relative w-16 h-16">
            <div class="absolute inset-0 rounded-full border-t-2 border-primary animate-spin"></div>
            <div class="absolute inset-2 rounded-full border-r-2 border-secondary animate-spin" style="animation-direction: reverse; animation-duration: 1.5s;"></div>
            <i class="fas fa-bolt absolute inset-0 flex items-center justify-center text-primary/50 text-xl animate-pulse"></i>
        </div>
        <p class="text-gray-400 text-xs tracking-widest uppercase font-bold animate-pulse">${msg}</p>
    </div>`;
}

function errorHTML(msg, retryFn = null) {
    const retryBtn = retryFn
        ? `<button onclick="${retryFn}" class="mt-6 bg-white/10 hover:bg-primary text-white border border-white/20 hover:border-primary px-8 py-2.5 rounded-full text-xs tracking-widest uppercase font-bold transition-all duration-300 shadow-xl hover:-translate-y-1">
               <i class="fas fa-rotate-right mr-2"></i> Retry Connection
           </button>`
        : '';
    return `<div class="col-span-full py-16 text-center glass-card rounded-3xl px-8 max-w-lg mx-auto border-red-900/30 animate-fade-in-up">
        <div class="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6">
            <i class="fas fa-triangle-exclamation text-red-500 text-2xl"></i>
        </div>
        <h3 class="text-white text-lg font-display font-black tracking-tight mb-2 uppercase">System Malfunction</h3>
        <code class="text-[10px] text-red-300/60 block bg-black/40 p-3 rounded-lg border border-red-900/20 break-words mb-2">${clean(msg)}</code>
        ${retryBtn}
    </div>`;
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
        }
        await renderHome(page);
    }
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
                            <i class="fas fa-fire text-primary mr-1"></i> ${clean(m.lastChapter)}
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
        upContainer.innerHTML = updates.map((m, i) => {
            const chaptersHTML = (m.chapters || []).map(c => `
                <div onclick="event.stopPropagation(); navigate('/read?url=${encodeURIComponent(c.url)}&title=${encodeURIComponent(`${clean(m.title)} - ${clean(c.name)}`)}')"
                    class="glass text-[10px] md:text-xs px-3 py-1.5 rounded-lg mt-1.5 hover:bg-primary/20 hover:border-primary/50 border border-white/5 transition-all duration-300 flex justify-between items-center group/btn cursor-pointer">
                    <span class="font-bold truncate text-gray-300 group-hover/btn:text-white">${clean(c.name)}</span>
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <span class="text-[8px] md:text-[9px] text-gray-500 group-hover/btn:text-primary transition-colors uppercase font-bold tracking-wider">${clean(c.time)}</span>
                        <i class="fas fa-play text-[8px] text-primary opacity-0 group-hover/btn:opacity-100 transition-opacity transform group-hover/btn:translate-x-1 duration-300"></i>
                    </div>
                </div>`).join('');

            return `
            <div class="glass-card p-2 md:p-3 rounded-2xl flex gap-3 md:gap-4 hover:border-primary/40 transition-colors duration-500 cursor-pointer group ${fromCache ? '' : 'animate-fade-in-up'} shadow-lg hover:shadow-[0_8px_30px_rgba(255,69,0,0.15)]"
                style="animation-delay: ${i * 0.03}s"
                onclick="navigate('/manga?url=${encodeURIComponent(m.url)}')">
                <div class="relative w-20 md:w-24 flex-shrink-0 overflow-hidden rounded-xl border border-white/5">
                    <img src="${proxify(m.image)}" class="w-full h-[120px] md:h-[135px] object-cover bg-dark-800 group-hover:scale-110 transition-transform duration-700" loading="lazy">
                    ${getBadgeUI(m.badge)}
                </div>
                <div class="flex-1 flex flex-col justify-center min-w-0 pr-1">
                    <h3 class="font-black font-display text-sm md:text-base leading-tight truncate mb-2 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-primary transition-all pb-1">${clean(m.title)}</h3>
                    <div class="flex flex-col gap-0.5">${chaptersHTML}</div>
                </div>
            </div>`;
        }).join('');
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

        if (d.chapters?.length > 0) {
            const firstCh = [...d.chapters].sort((a, b) => a.num - b.num)[0];
            const lastCh = [...d.chapters].sort((a, b) => b.num - a.num)[0];

            if (firstCh) {
                qaEl.innerHTML += `
                <button onclick="navigate('/read?url=${encodeURIComponent(firstCh.url)}&title=${encodeURIComponent(`${clean(d.title)} - ${clean(firstCh.name)}`)}')"
                    class="bg-white/10 hover:bg-white/20 border border-white/10 px-6 py-3 rounded-2xl text-xs font-black tracking-widest uppercase transition-all duration-300 flex items-center gap-3">
                    <i class="fas fa-play text-primary"></i> Read First
                </button>`;
            }
            if (lastCh && lastCh !== firstCh) {
                qaEl.innerHTML += `
                <button onclick="navigate('/read?url=${encodeURIComponent(lastCh.url)}&title=${encodeURIComponent(`${clean(d.title)} - ${clean(lastCh.name)}`)}')"
                    class="bg-gradient-to-r from-primary to-secondary hover:brightness-110 px-8 py-3 rounded-2xl text-xs font-black tracking-widest uppercase transition-all duration-300 shadow-[0_0_20px_rgba(255,69,0,0.3)] hover:-translate-y-1 flex items-center gap-3">
                    Read Latest <i class="fas fa-bolt text-white/80"></i>
                </button>`;
            }

            chaptersEl.innerHTML = d.chapters.map((c, i) => {
                const readPath = `/read?url=${encodeURIComponent(c.url)}&title=${encodeURIComponent(`${clean(d.title)} - ${clean(c.name)}`)}`;
                return `<button onclick="navigate('${readPath}')"
                    class="w-full relative overflow-hidden glass hover:bg-white/10 p-4 rounded-2xl text-left transition-all duration-200 flex justify-between items-center group border border-white/5 hover:border-primary/50">
                    <div class="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-primary to-secondary transform scale-x-0 origin-left group-hover:scale-x-100 transition-transform duration-200"></div>
                    <div class="flex items-center gap-3 min-w-0 pr-2">
                        <div class="w-8 h-8 rounded-full bg-dark-800 border border-white/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:border-primary transition-colors">
                            <i class="fas fa-book-open text-[10px] text-gray-400 group-hover:text-white"></i>
                        </div>
                        <span class="font-bold text-sm text-gray-200 group-hover:text-white truncate">${clean(c.name)}</span>
                    </div>
                    <span class="text-[10px] font-bold tracking-widest uppercase opacity-40 group-hover:opacity-100 group-hover:text-primary transition-colors flex-shrink-0 whitespace-nowrap pl-2">${clean(c.time)}</span>
                </button>`;
            }).join('');
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
    floatNext.classList.add('hidden');

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