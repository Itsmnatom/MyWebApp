/**
 * SpeedManga - Frontend App (Optimized v2)
 * Fixes: popular stuck loading, better error states, retry button
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
    if (!url) return 'https://placehold.co/300x450?text=No+Image';
    if (url.startsWith('http')) return `${API}/proxy?url=${encodeURIComponent(url)}`;
    return url;
}

function getBadgeUI(badge) {
    const b = (badge || '').toLowerCase();
    if (b.includes('manhwa') || b.includes('มังฮวา')) {
        return '<div class="absolute top-0 right-0 badge-manhwa text-white text-[9px] font-bold px-2 py-0.5 rounded-bl-lg shadow-lg z-10">MANHWA</div>';
    }
    return '<div class="absolute top-0 right-0 bg-gray-700/90 text-white text-[9px] font-bold px-2 py-0.5 rounded-bl-lg shadow-lg z-10">MANGA</div>';
}

function spinnerHTML(msg = 'กำลังโหลด...') {
    return `<div class="col-span-full flex flex-col items-center justify-center py-20 gap-4">
        <i class="fas fa-spinner fa-spin text-orange-500 text-4xl"></i>
        <p class="text-gray-400 text-sm">${msg}</p>
    </div>`;
}

function errorHTML(msg, retryFn = null) {
    const retryBtn = retryFn
        ? `<button onclick="${retryFn}" class="mt-4 bg-orange-600 hover:bg-orange-700 px-6 py-2 rounded-full text-sm font-bold transition">
               <i class="fas fa-redo mr-2"></i>ลองใหม่
           </button>`
        : '';
    return `<div class="col-span-full py-10 text-center bg-black/40 border border-red-900/40 rounded-2xl px-6">
        <i class="fas fa-exclamation-triangle text-red-500 text-3xl mb-3 block"></i>
        <p class="text-red-400 font-bold mb-1">โหลดข้อมูลล้มเหลว</p>
        <code class="text-xs text-gray-500 break-words">${clean(msg)}</code>
        ${retryBtn}
    </div>`;
}

// สร้าง skeleton cards
function skeletonCards(count = 4, className = 'h-64') {
    return Array(count).fill(0).map(() =>
        `<div class="skeleton ${className} rounded-xl"></div>`
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

    ['home-view', 'detail-view', 'reader-view'].forEach(id =>
        document.getElementById(id).classList.add('hidden')
    );
    document.getElementById('main-header').style.display = 'block';
    document.body.style.overflow = 'auto';
    window.scrollTo(0, 0);

    if (path === '/read' && targetUrl) {
        document.getElementById('reader-view').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        document.getElementById('main-header').style.display = 'none';
        await renderReader(targetUrl, targetTitle || 'กำลังอ่าน');
    } else if (path === '/manga' && targetUrl) {
        document.getElementById('detail-view').classList.remove('hidden');
        await renderDetail(targetUrl);
    } else {
        document.getElementById('home-view').classList.remove('hidden');
        await renderHome(page);
    }
}

// ══════════════════════════════════════════════════
//  RENDER: HOME
// ══════════════════════════════════════════════════

async function renderHome(page) {
    const popContainer = document.getElementById('popular-container');
    const upContainer = document.getElementById('updates-container');
    const popSection = document.getElementById('popular-section');

    // Popular section เฉพาะหน้า 1
    popSection.style.display = page === 1 ? 'block' : 'none';
    if (page === 1) {
        popContainer.innerHTML = skeletonCards(7, 'h-64');
    }
    upContainer.innerHTML = spinnerHTML(`กำลังโหลดรายการอัปเดต หน้า ${page}...`);

    // Pagination
    document.getElementById('page-indicator').innerText = `หน้า ${page}`;
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    btnPrev.classList.toggle('hidden', page <= 1);
    btnPrev.onclick = () => navigate(`/?page=${page - 1}`);
    btnNext.onclick = () => navigate(`/?page=${page + 1}`);
    btnNext.disabled = false;

    try {
        const res = await fetch(`${API}/manga/home?page=${page}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const { popular = [], updates = [] } = data;

        // ── Popular ───────────────────────────────
        if (page === 1) {
            if (popular.length > 0) {
                popContainer.innerHTML = popular.map(m => `
                    <div onclick="navigate('/manga?url=${encodeURIComponent(m.url)}')" class="cursor-pointer group">
                        <div class="relative overflow-hidden rounded-xl aspect-[2/3] bg-gray-900 mb-2 border border-gray-800 shadow-lg">
                            <img src="${proxify(m.image)}"
                                class="w-full h-full object-cover group-hover:scale-110 transition duration-500"
                                loading="lazy"
                                onerror="this.src='https://placehold.co/300x450?text=No+Image'">
                            ${getBadgeUI(m.badge)}
                            <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black via-black/70 to-transparent p-2 pt-8 text-[10px] text-center text-orange-400 font-bold">
                                ${clean(m.lastChapter)}
                            </div>
                        </div>
                        <h3 class="text-[11px] font-bold line-clamp-2 group-hover:text-orange-500 transition leading-tight">
                            ${clean(m.title)}
                        </h3>
                    </div>`
                ).join('');
            } else {
                // Popular อาจว่างได้ถ้า selector ไม่ตรง — ซ่อน section แทน error
                popSection.style.display = 'none';
            }
        }

        // ── Updates ───────────────────────────────
        if (updates.length === 0) {
            upContainer.innerHTML = '<div class="col-span-full text-center py-10 text-gray-500">ไม่พบรายการอัปเดตในหน้านี้</div>';
            btnNext.disabled = true;
            btnNext.classList.add('opacity-40', 'cursor-not-allowed');
        } else {
            upContainer.innerHTML = updates.map(m => {
                const chaptersHTML = (m.chapters || []).map(c => {
                    const readPath = `/read?url=${encodeURIComponent(c.url)}&title=${encodeURIComponent(`${clean(m.title)} - ${clean(c.name)}`)}`;
                    return `<div onclick="event.stopPropagation(); navigate('${readPath}')"
                        class="text-[10px] bg-black/40 p-1.5 px-3 rounded mt-1 hover:bg-orange-600 hover:text-white transition flex justify-between items-center group/btn border border-gray-800 hover:border-orange-500/30 cursor-pointer">
                        <span class="font-medium truncate">${clean(c.name)}</span>
                        <span class="text-[8px] opacity-40 group-hover/btn:opacity-100 ml-2 flex-shrink-0">อ่าน →</span>
                    </div>`;
                }).join('');

                return `<div class="bg-[#151515] p-3 rounded-xl flex gap-3 border border-gray-800 hover:border-orange-500/60 transition cursor-pointer relative shadow-md group"
                    onclick="navigate('/manga?url=${encodeURIComponent(m.url)}')">
                    ${getBadgeUI(m.badge)}
                    <div class="flex-shrink-0">
                        <img src="${proxify(m.image)}"
                            class="w-[72px] h-[100px] object-cover rounded-lg bg-gray-800"
                            loading="lazy"
                            onerror="this.src='https://placehold.co/150x220?text=No+Image'">
                    </div>
                    <div class="flex-1 overflow-hidden flex flex-col justify-center min-w-0">
                        <h3 class="font-bold text-sm truncate mb-1 pr-12 group-hover:text-orange-400 transition">${clean(m.title)}</h3>
                        ${chaptersHTML}
                    </div>
                </div>`;
            }).join('');
        }
    } catch (e) {
        upContainer.innerHTML = errorHTML(e.message, `renderHome(${page})`);
        if (page === 1) popSection.style.display = 'none';
    }
}

// ══════════════════════════════════════════════════
//  RENDER: DETAIL
// ══════════════════════════════════════════════════

async function renderDetail(url) {
    const chaptersEl = document.getElementById('d-chapters');
    chaptersEl.innerHTML = spinnerHTML('กำลังดึงข้อมูลมังงะ...');

    // Reset fields
    document.getElementById('d-title').innerText = '';
    document.getElementById('d-synopsis').innerText = '';
    document.getElementById('d-info').innerHTML = '';
    document.getElementById('d-image').src = 'https://placehold.co/300x450?text=Loading';

    try {
        const res = await fetch(`${API}/manga/details?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (d.error) throw new Error(d.error);

        document.getElementById('d-title').innerText = d.title || 'Unknown';
        document.getElementById('d-synopsis').innerText = d.synopsis || 'ไม่มีเนื้อเรื่อง';
        document.getElementById('d-image').src = proxify(d.image);
        document.getElementById('d-image').onerror = function () {
            this.src = 'https://placehold.co/300x450?text=No+Image';
        };

        document.getElementById('d-info').innerHTML = Object.entries(d.info || {}).map(([k, v]) => `
            <div class="bg-black/40 p-3 rounded-xl border border-gray-800">
                <b class="text-orange-500 block text-[10px] uppercase mb-1">${clean(k)}</b>
                <span class="text-xs">${clean(v)}</span>
            </div>`
        ).join('');

        if (d.chapters?.length > 0) {
            chaptersEl.innerHTML = d.chapters.map(c => {
                const readPath = `/read?url=${encodeURIComponent(c.url)}&title=${encodeURIComponent(`${clean(d.title)} - ${clean(c.name)}`)}`;
                return `<button onclick="navigate('${readPath}')"
                    class="bg-black/30 p-4 rounded-xl text-left text-sm hover:bg-orange-600 hover:text-white transition flex justify-between items-center group border border-gray-800/50 hover:border-orange-500/30">
                    <span class="font-medium truncate mr-2">${clean(c.name)}</span>
                    <span class="text-[9px] opacity-40 whitespace-nowrap group-hover:opacity-100 flex-shrink-0">${clean(c.time)}</span>
                </button>`;
            }).join('');
        } else {
            chaptersEl.innerHTML = '<p class="col-span-full text-center py-10 text-gray-500">ไม่พบรายการตอน</p>';
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

    container.innerHTML = `<div class="py-40 flex flex-col items-center gap-4">
        <i class="fas fa-spinner fa-spin fa-3x text-orange-500"></i>
        <p class="animate-pulse text-gray-400">ทะลวงปุ่ม 18+ และดึงภาพ...</p>
        <p class="text-xs text-gray-600">อาจใช้เวลา 5-15 วินาที</p>
    </div>`;

    try {
        const res = await fetch(`${API}/manga/read?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (!data.images?.length) {
            container.innerHTML = `<div class="mt-40 text-center px-4">
                <i class="fas fa-image text-4xl mb-4 text-gray-600 block"></i>
                <p class="text-gray-400">ไม่พบรูปภาพในตอนนี้</p>
                <p class="text-xs text-gray-600 mt-2">อาจถูก block หรือ URL เปลี่ยน</p>
            </div>`;
            return;
        }

        container.innerHTML = data.images.map((src, i) => `
            <img src="${proxify(src)}"
                class="w-full md:max-w-3xl border-b border-gray-900/60"
                loading="${i < 3 ? 'eager' : 'lazy'}"
                onerror="this.style.display='none'">`
        ).join('');

        // Navigation buttons
        if (data.prevUrl) {
            const prevPath = `/read?url=${encodeURIComponent(data.prevUrl)}&title=ตอนก่อนหน้า`;
            navBottom.innerHTML += `<button onclick="navigate('${prevPath}')"
                class="bg-gray-800 hover:bg-gray-700 px-6 py-2 rounded-full text-xs font-bold transition shadow-lg">
                <i class="fas fa-chevron-left mr-2"></i>ตอนก่อนหน้า
            </button>`;
        }
        if (data.nextUrl) {
            const nextPath = `/read?url=${encodeURIComponent(data.nextUrl)}&title=ตอนถัดไป`;
            navBottom.innerHTML += `<button onclick="navigate('${nextPath}')"
                class="bg-orange-600 hover:bg-orange-700 px-6 py-2 rounded-full text-xs font-bold transition shadow-lg">
                ตอนถัดไป<i class="fas fa-chevron-right ml-2"></i>
            </button>`;
            floatNext.classList.remove('hidden');
            floatNext.onclick = () => navigate(nextPath);
        }
    } catch (e) {
        container.innerHTML = `<div class="mt-40 text-center px-4">
            <i class="fas fa-times-circle text-5xl mb-4 text-red-500 block"></i>
            <p class="text-red-400 font-bold text-lg mb-2">โหลดรูปภาพล้มเหลว</p>
            <code class="text-xs text-gray-600 block max-w-sm mx-auto">${clean(e.message)}</code>
            <button onclick="renderReader('${url.replace(/'/g, "\\'")}', '${title.replace(/'/g, "\\'")}')"
                class="mt-6 bg-orange-600 hover:bg-orange-700 px-8 py-2 rounded-full text-sm font-bold transition">
                <i class="fas fa-redo mr-2"></i>ลองใหม่
            </button>
        </div>`;
    }
}

// ══════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════
window.onload = handleLocation;