/**
 * SpeedManga - Backend Server (Optimized v2)
 *
 * Improvements vs v1:
 *  1. Page Pool      — reuse browser tabs, no new browser per request
 *  2. LRU + TTL      — stable cache with size limit, no unbounded Map growth
 *  3. Parser fallback — wide selectors + null-safe extraction + ts_reader.run support
 *  4. Faster reader  — 18+ wait 1500ms→400ms, scroll 100ms→60ms/step, wait 800ms→400ms
 *  5. Lower RAM      — single shared browser, abort all heavy assets
 *
 * npm install express cors puppeteer
 * node server.js
 */

'use strict';

const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET_SITE = 'https://speed-manga.net/';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════
//  LRU CACHE  (no external lib)
//  — จำกัด maxSize, evict oldest on overflow
//  — ทุก entry มี TTL เป็นของตัวเอง
// ══════════════════════════════════════════════════
class LRUCache {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.map = new Map();
    }
    get(key) {
        const e = this.map.get(key);
        if (!e) return null;
        if (Date.now() > e.expire) { this.map.delete(key); return null; }
        this.map.delete(key);
        this.map.set(key, e);
        return e.value;
    }
    set(key, value, ttlMs) {
        if (this.map.has(key)) this.map.delete(key);
        if (this.map.size >= this.maxSize) this.map.delete(this.map.keys().next().value);
        this.map.set(key, { value, expire: Date.now() + ttlMs });
    }
    stats() { return { size: this.map.size, max: this.maxSize }; }
}

const CACHE = {
    home: new LRUCache(20),
    details: new LRUCache(200),
    read: new LRUCache(500),
};

// ══════════════════════════════════════════════════
//  PAGE POOL  — single Browser, reuse tabs
// ══════════════════════════════════════════════════
const POOL_SIZE = 3;
const POOL_QUEUE = [];
let sharedBrowser = null;
const pagePool = [];

async function getBrowser() {
    if (!sharedBrowser || !sharedBrowser.connected) {
        // ใช้ PUPPETEER_EXECUTABLE_PATH จาก Environment (สำหรับ Render/Docker)
        // หรือใช้ path เริ่มต้นของ Chrome บน Linux/Mac/Windows ถ้าไม่มี
        const defaultPath = process.platform === 'win32'
            ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
            : process.platform === 'darwin'
                ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
                : '/usr/bin/google-chrome-stable';

        sharedBrowser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || defaultPath,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', '--disable-gpu',
                '--disable-extensions', '--disable-background-networking',
                '--disable-default-apps', '--mute-audio', '--no-first-run',
            ],
        });
        console.log('🌐 Browser launched');
        sharedBrowser.on('disconnected', () => {
            sharedBrowser = null;
            console.warn('⚠️  Browser disconnected — will relaunch on next request');
        });
    }
    return sharedBrowser;
}

async function createPoolPage() {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    page.on('dialog', async d => { try { await d.accept(); } catch { } });
    return page;
}

function acquirePage() {
    return new Promise(async (resolve) => {
        const slot = pagePool.find(s => !s.busy);
        if (slot) { slot.busy = true; return resolve(slot); }
        if (pagePool.length < POOL_SIZE) {
            try {
                const page = await createPoolPage();
                const slot = { page, busy: true };
                pagePool.push(slot);
                return resolve(slot);
            } catch (e) { console.error('Failed to create pool page:', e.message); }
        }
        POOL_QUEUE.push(resolve);
    });
}

function releasePage(slot) {
    if (POOL_QUEUE.length > 0) {
        const next = POOL_QUEUE.shift();
        next(slot);
    } else {
        slot.busy = false;
    }
}

async function warmUpPool() {
    try { await getBrowser(); console.log('🔥 Pool warm-up done'); }
    catch (e) { console.error('Pool warm-up failed:', e.message); }
}

// ══════════════════════════════════════════════════
//  SCRAPING RUNNER  (pool-based)
// ══════════════════════════════════════════════════
const ALWAYS_BLOCK = new Set(['font', 'media', 'websocket', 'manifest', 'other']);
const CONTENT_BLOCK = new Set([...ALWAYS_BLOCK, 'image', 'stylesheet', 'script']);
const READER_BLOCK = new Set([...ALWAYS_BLOCK, 'stylesheet']);

async function executeScraping(url, extractFn, options = {}) {
    const slot = await acquirePage();
    const { page } = slot;
    try {
        await page.setRequestInterception(true);
        page.removeAllListeners('request');

        const blockSet = options.blockMedia ? CONTENT_BLOCK
            : options.isReadPage ? READER_BLOCK
                : ALWAYS_BLOCK;

        page.on('request', req => {
            if (blockSet.has(req.resourceType())) req.abort().catch(() => { });
            else req.continue().catch(() => { });
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // ── ทะลวงปุ่ม 18+ (wait ลดจาก 1500 → 400 ms) ──
        if (options.isReadPage || options.isDetailPage) {
            await page.evaluate(() => {
                for (const sel of [
                    '.btn-adult-confirm', '#adult_confirm', '.c-btn.btn-confirm-yes',
                    'button[class*="adult"]', 'a[href*="adult"]',
                    '.chapter-warning a', 'button.btn-warning',
                ]) {
                    const btn = document.querySelector(sel);
                    if (btn) { btn.click(); break; }
                }
            }).catch(() => { });
            await new Promise(r => setTimeout(r, 400));
        }

        // ── auto-scroll (เร็วขึ้น: step 1200px, interval 60ms) ──
        if (options.autoScroll) {
            await page.evaluate(() => new Promise(resolve => {
                let moved = 0;
                const step = 1200;
                const timer = setInterval(() => {
                    window.scrollBy(0, step);
                    moved += step;
                    if (moved >= document.body.scrollHeight || moved > 60000) {
                        clearInterval(timer); resolve();
                    }
                }, 60);
            }));
            await new Promise(r => setTimeout(r, 400));
        }

        const data = await page.evaluate(extractFn);
        await page.evaluate(() => { try { window.stop(); } catch { } }).catch(() => { });
        return data;
    } catch (e) {
        try { await page.close(); } catch { }
        const idx = pagePool.indexOf(slot);
        if (idx !== -1) pagePool.splice(idx, 1);
        throw new Error(`Scraping Error: ${e.message}`);
    } finally {
        releasePage(slot);
    }
}

// ══════════════════════════════════════════════════
//  FILTER + SORT  (ตัด 18+, ดัน Manhwa)
// ══════════════════════════════════════════════════
const BAD_WORDS = ['18+', '18 +', 'nc-17', 'smut', 'mature', 'ผู้ใหญ่', 'ntr', 'adult'];

function filterAndSort(items) {
    const seen = new Set();
    return items
        .filter(m => {
            if (!m.url || seen.has(m.url)) return false;
            seen.add(m.url);
            const text = `${m.title || ''} ${m.badge || ''}`.toLowerCase();
            return !BAD_WORDS.some(w => text.includes(w));
        })
        .sort((a, b) => {
            const aM = `${a.badge} ${a.title}`.toLowerCase().includes('manhwa') ? 1 : 0;
            const bM = `${b.badge} ${b.title}`.toLowerCase().includes('manhwa') ? 1 : 0;
            return bM - aM;
        });
}

// ══════════════════════════════════════════════════
//  SPA ROUTING
// ══════════════════════════════════════════════════
app.get(['/', '/manga', '/read'], (_req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ══════════════════════════════════════════════════
//  API: STATUS
// ══════════════════════════════════════════════════
app.get('/api/status', (_req, res) => res.json({
    status: 'online',
    pool: pagePool.map(s => ({ busy: s.busy })),
    cache: { home: CACHE.home.stats(), details: CACHE.details.stats(), read: CACHE.read.stats() },
}));

// ══════════════════════════════════════════════════
//  API: IMAGE PROXY
// ══════════════════════════════════════════════════
app.get('/api/proxy', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('No image URL');
    try {
        const r = await fetch(imageUrl, {
            headers: {
                Referer: TARGET_SITE,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) return res.status(r.status).send('Upstream error');
        const buf = Buffer.from(await r.arrayBuffer());
        res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buf);
    } catch { res.status(500).send('Proxy error'); }
});

// ══════════════════════════════════════════════════
//  DEBUG: dump DOM ของหน้าแรก — ใช้หา selector จริง
//  GET /api/debug/home
// ══════════════════════════════════════════════════
app.get('/api/debug/home', async (req, res) => {
    try {
        const data = await executeScraping(TARGET_SITE, () => {
            const snap = {
                bodyClasses: document.body.className,
                sliderHTML: document.querySelector(
                    '.slider__container, .owl-carousel, #manga-featured-content, .popular-slider, [class*="slider"]'
                )?.outerHTML?.slice(0, 3000) || 'NOT FOUND',
                listHTML: document.querySelector(
                    '.page-content-listing, .listupd, .mangalist'
                )?.outerHTML?.slice(0, 1000) || 'NOT FOUND',
                allSections: Array.from(document.querySelectorAll(
                    'section, [class*="popular"], [class*="slider"], [class*="featured"], [id*="popular"], [id*="slider"]'
                )).map(el => ({ tag: el.tagName, id: el.id, cls: el.className.slice(0, 100) })).slice(0, 30),
            };
            return snap;
        }, { blockMedia: false });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════
//  API: HOME  (?page=N)
//  Popular และ Updates แยก scraping:
//   - Popular: blockMedia=false เพื่อให้ JS render carousel
//   - Updates: blockMedia=true เพื่อความเร็ว
// ══════════════════════════════════════════════════

/** helpers ที่ใช้ซ้ำใน page.evaluate (inline เพราะไม่มี closure) */
const INLINE_HELPERS = `
    const _img = el => {
        const img = el.querySelector('img');
        if (!img) return '';
        return img.getAttribute('data-src') || img.getAttribute('data-lazy-src')
            || img.getAttribute('data-cfsrc') || img.getAttribute('src') || '';
    };
    const _title = el =>
        el.querySelector('.post-title a, h3 a, .tt, .title, .name')?.getAttribute('title')
        || el.querySelector('.post-title, .tt, .title, h3, .name')?.innerText?.trim() || '';
    const _badge = el =>
        el.querySelector('.manga-title-badges, .badge, .type')?.innerText?.trim() || '';
    const _lastCh = el =>
        el.querySelector('.chapter-item .chapter, .epxs, .chapter, .font-meta.chapter, .eph-num a')?.innerText?.trim() || 'Latest';
`;

/** ดึง popular — อนุญาต JS render (ใช้ blockMedia: false) */
async function scrapePopular() {
    const cached = CACHE.home.get('popular');
    if (cached) return cached;

    const results = await executeScraping(TARGET_SITE, () => {
        // inline helpers
        const _img = el => {
            const img = el.querySelector('img');
            if (!img) return '';
            return img.getAttribute('data-src') || img.getAttribute('data-lazy-src')
                || img.getAttribute('data-cfsrc') || img.getAttribute('src') || '';
        };
        const _title = el =>
            el.querySelector('.post-title a, h3 a, .tt, .title, .name')?.getAttribute('title')
            || el.querySelector('.post-title, .tt, .title, h3, .name')?.innerText?.trim() || '';
        const _badge = el =>
            el.querySelector('.manga-title-badges, .badge, .type')?.innerText?.trim() || '';
        const _lastCh = el =>
            el.querySelector('.chapter-item .chapter, .epxs, .chapter, .font-meta.chapter, .eph-num a')?.innerText?.trim() || 'Latest';

        const items = [];
        const seen = new Set();

        // selector fallback หลายชั้น — ลองจนเจอ
        const selectors = [
            '.slider__container .owl-item:not(.cloned) .page-item-detail',
            '.slider__container .page-item-detail',
            '#manga-featured-content .page-item-detail',
            '.owl-carousel.manga-popular .page-item-detail',
            '.popular-slider .page-item-detail',
            '.owl-item .page-item-detail',
            '.popular-item-wrap',
            '[class*="popular"] .page-item-detail',
            // fallback สุดท้าย: ใช้ update list แทน
            '.page-content-listing .page-item-detail',
            '.listupd .utao',
            '.listupd .bs',
        ];

        for (const sel of selectors) {
            const found = document.querySelectorAll(sel);
            found.forEach(el => {
                const url = el.querySelector('a')?.href;
                if (!url || seen.has(url)) return;
                seen.add(url);
                items.push({
                    title: _title(el),
                    image: _img(el),
                    lastChapter: _lastCh(el),
                    url,
                    badge: _badge(el),
                    _src: sel,  // debug: บอก selector ที่ดึงมาได้
                });
            });
            if (items.length >= 14) break;
        }
        return items;
    }, { blockMedia: false });  // ✅ ต้องการ JS สำหรับ carousel

    const filtered = filterAndSort(results).slice(0, 14);
    CACHE.home.set('popular', filtered, 10 * 60 * 1000);
    return filtered;
}

/** ดึง updates สำหรับหน้า N — block media เพื่อความเร็ว */
async function scrapeUpdates(page) {
    const fetchUrl = page === 1 ? TARGET_SITE : `${TARGET_SITE}page/${page}/`;

    return executeScraping(fetchUrl, () => {
        const _img = el => {
            const img = el.querySelector('img');
            if (!img) return '';
            return img.getAttribute('data-src') || img.getAttribute('data-lazy-src')
                || img.getAttribute('data-cfsrc') || img.getAttribute('src') || '';
        };
        const _title = el =>
            el.querySelector('.post-title a, h3 a, .tt, .title, .name')?.getAttribute('title')
            || el.querySelector('.post-title, .tt, .title, h3, .name')?.innerText?.trim() || '';
        const _badge = el =>
            el.querySelector('.manga-title-badges, .badge, .type')?.innerText?.trim() || '';

        const items = [];
        document.querySelectorAll(
            '.page-content-listing .page-item-detail, .listupd .utao, .listupd .bs, .uta'
        ).forEach(el => {
            const url = el.querySelector('a')?.href;
            if (!url) return;
            const chapters = [];
            el.querySelectorAll('.list-chapter .chapter-item, .luf ul li, .cl ul li, .chapter-item').forEach((ch, idx) => {
                if (idx >= 2) return;
                const chUrl = ch.querySelector('a')?.href;
                if (chUrl) chapters.push({
                    name: ch.querySelector('a')?.innerText?.trim() || '',
                    url: chUrl,
                    time: ch.querySelector('.post-on, .chapter-release-date, span:last-child')?.innerText?.trim() || 'NEW',
                });
            });
            items.push({ title: _title(el), image: _img(el), url, badge: _badge(el), chapters });
        });
        return items;
    }, { blockMedia: true });  // ✅ ไม่ต้องการ JS — เร็วกว่า
}

app.get('/api/manga/home', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const cacheKey = `updates_${page}`;

    try {
        const cachedUpdates = CACHE.home.get(cacheKey);

        // Popular และ Updates ดึงพร้อมกัน
        const [popular, updatesRaw] = await Promise.all([
            page === 1 ? scrapePopular().catch(e => { console.error('popular err:', e.message); return []; }) : Promise.resolve([]),
            cachedUpdates ? Promise.resolve(cachedUpdates) : scrapeUpdates(page).catch(e => { console.error('updates err:', e.message); return []; }),
        ]);

        const updates = cachedUpdates || filterAndSort(updatesRaw);
        if (!cachedUpdates) CACHE.home.set(cacheKey, updates, 5 * 60 * 1000);

        res.json({ popular, updates });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════
//  API: MANGA DETAILS
// ══════════════════════════════════════════════════
app.get('/api/manga/details', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    const cached = CACHE.details.get(url);
    if (cached) return res.json(cached);

    try {
        const data = await executeScraping(url, () => {
            const qs = sel => document.querySelector(sel);

            const title =
                qs('.post-title h1')?.innerText?.trim()
                || qs('.entry-title')?.innerText?.trim()
                || qs('.tt')?.innerText?.trim()
                || qs('h1')?.innerText?.trim() || '';

            const imgEl = qs('.summary_image img, .thumb img, .series-thumb img, .cover img');
            const image =
                imgEl?.getAttribute('data-src')
                || imgEl?.getAttribute('data-lazy-src')
                || imgEl?.getAttribute('src') || '';

            const synopsis =
                qs('.summary__content')?.innerText?.trim()
                || qs('.manga-excerpt')?.innerText?.trim()
                || qs('.desc')?.innerText?.trim()
                || qs('.entry-content p')?.innerText?.trim() || '';

            const info = {};
            document.querySelectorAll('.post-content_item').forEach(item => {
                const label = item.querySelector('.summary-heading h5')?.innerText?.replace(':', '')?.trim();
                const value = item.querySelector('.summary-content')?.innerText?.trim();
                if (label && value) info[label] = value;
            });

            const chapters = Array.from(document.querySelectorAll(
                '.wp-manga-chapter, .eplister li, #chapterlist li, .chapterlist li, .cl ul li'
            )).map(el => ({
                name: el.querySelector('a')?.innerText?.trim() || '',
                url: el.querySelector('a')?.href || '',
                time: el.querySelector('.chapter-release-date, .chapterdate, i, span:last-child')?.innerText?.trim() || '',
            })).filter(c => c.url);

            return { title, image, synopsis, info, chapters };
        }, { blockMedia: true, isDetailPage: true });

        CACHE.details.set(url, data, 30 * 60 * 1000);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════
//  API: READ CHAPTER
// ══════════════════════════════════════════════════
app.get('/api/manga/read', async (req, res) => {
    const chapterUrl = req.query.url;
    if (!chapterUrl) return res.status(400).json({ error: 'Missing URL' });

    const cached = CACHE.read.get(chapterUrl);
    if (cached) return res.json(cached);

    try {
        const data = await executeScraping(chapterUrl, () => {
            const prev = document.querySelector('.prev_page, .nav-previous a, .nextprev a[rel="prev"], a.prev_page')?.href || null;
            const next = document.querySelector('.next_page, .nav-next a, .nextprev a[rel="next"], a.next_page')?.href || null;

            let imageUrls = [];

            // Method 1: JSON in source (supports both "images" key and ts_reader.run)
            try {
                const html = document.documentElement.innerHTML;
                const m1 = html.match(/"images"\s*:\s*(\[[^\]]+\])/);
                const m2 = html.match(/ts_reader\.run\(\s*(\{[\s\S]+?\})\s*\)/);
                if (m1) {
                    imageUrls = JSON.parse(m1[1]).map(u => u.replace(/\\\//g, '/').trim());
                } else if (m2) {
                    const obj = JSON.parse(m2[1]);
                    const src = obj.sources?.[0];
                    if (src?.images) imageUrls = src.images;
                }
            } catch (_) { }

            // Method 2: DOM img tags fallback
            if (imageUrls.length === 0) {
                document.querySelectorAll(
                    '.reading-content img, .wp-manga-chapter-img, #readerarea img, .page-break img, .chapter-content img'
                ).forEach(img => {
                    const v = img.getAttribute('data-src')
                        || img.getAttribute('data-lazy-src')
                        || img.getAttribute('data-cfsrc')
                        || img.getAttribute('src');
                    if (v && v.startsWith('http')) imageUrls.push(v);
                });
            }

            // กรอง noise
            imageUrls = [...new Set(imageUrls)].filter(
                s => s && s.startsWith('http')
                    && !s.includes('/logo') && !s.includes('/banner')
                    && /\.(jpe?g|png|webp|gif)/i.test(s)
            );

            return { images: imageUrls, prevUrl: prev, nextUrl: next };
        }, { isReadPage: true, autoScroll: true });

        CACHE.read.set(chapterUrl, data, 60 * 60 * 1000);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════
//  GRACEFUL SHUTDOWN
// ══════════════════════════════════════════════════
async function shutdown() {
    console.log('\n🛑 Shutting down...');
    for (const slot of pagePool) await slot.page.close().catch(() => { });
    if (sharedBrowser) await sharedBrowser.close().catch(() => { });
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ══════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════
app.listen(PORT, async () => {
    console.log('══════════════════════════════════════════');
    console.log('🚀  SpeedManga — Optimized Engine v2  🚀');
    console.log(`   http://localhost:${PORT}`);
    console.log(`   Pool size : ${POOL_SIZE} tabs`);
    console.log('══════════════════════════════════════════');
    await warmUpPool();
});