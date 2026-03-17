/**
 * SpeedManga — Test Server (All-in-One v4)
 *
 * Sources:
 *  1. speed-manga.net     → /api/manga/*
 *  2. 1668manga.com       → /api/alt/*
 *  3. readrealm.co        → /api/readrealm/*
 *  4. readtoon.vip        → /api/readtoon/*
 *
 * Setup:
 *   npm install express cors cheerio got-scraping got axios
 *   node test.js
 *
 * Tester UI:
 *   http://localhost:3000/
 */

'use strict';

const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const path = require('path');
const got = require('got');

const app = express();
const PORT = process.env.PORT || 3000;

const SPEEDMANGA_SITE = 'https://speed-manga.net/';
const ALT_SITE = 'https://1668manga.com/';
const READREALM_SITE = 'https://readrealm.co';
const READTOON_SITE = 'https://readtoon.vip';

// ─── Global Error Handlers ────────────────────────────────────
process.on('uncaughtException', e => console.error('[CRITICAL] Uncaught Exception:', e.message, e.stack));
process.on('unhandledRejection', e => console.error('[CRITICAL] Unhandled Rejection:', e));

app.use(cors());
app.use(express.json());

// ─── Tester UI — serve api-tester.html ───────────────────────
const TESTER_FILE = path.join(__dirname, 'api-tester.html');
app.get('/', (_req, res) => res.sendFile(TESTER_FILE));

// Static assets (css/js/images in same folder) — optional
app.use(express.static(__dirname));

// ══════════════════════════════════════════════════════════════
//  LRU CACHE
// ══════════════════════════════════════════════════════════════
class LRUCache {
    constructor(maxSize = 100) { this.maxSize = maxSize; this.map = new Map(); }
    get(key) {
        const e = this.map.get(key);
        if (!e) return null;
        if (Date.now() > e.expire) { this.map.delete(key); return null; }
        this.map.delete(key); this.map.set(key, e);
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
    home: new LRUCache(10),
    details: new LRUCache(50),
    read: new LRUCache(50),
};
const CACHE_RR = { home: new LRUCache(10), details: new LRUCache(50), read: new LRUCache(100) };
const CACHE_RT = { home: new LRUCache(10), details: new LRUCache(50), read: new LRUCache(100) };

// ══════════════════════════════════════════════════════════════
//  FETCH HELPER
// ══════════════════════════════════════════════════════════════
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';
const PROXY_URL = process.env.PROXY_URL || '';

let _gotScraping = null;
async function getGotScraping() {
    if (!_gotScraping) { const m = await import('got-scraping'); _gotScraping = m.gotScraping; }
    return _gotScraping;
}

async function fetchHtml(url) {
    try {
        const gs = await getGotScraping();
        const normalizedUrl = encodeURI(decodeURI(url));
        let targetUrl = normalizedUrl;
        const options = {
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 115 }],
                devices: ['desktop'],
                operatingSystems: ['windows'],
            },
            http2: true,
            timeout: { request: 30000 },
            retry: { limit: 1 },
        };

        if (SCRAPER_API_KEY) {
            targetUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
            options.http2 = false;
        } else if (PROXY_URL) {
            options.proxyUrl = PROXY_URL;
        }

        const response = await gs(targetUrl, options);
        return response.body;
    } catch (err) {
        if (err.response?.statusCode) throw new Error(`Upstream ${err.response.statusCode}`);
        throw err;
    }
}

// ══════════════════════════════════════════════════════════════
//  SHARED UTILITIES
// ══════════════════════════════════════════════════════════════
const BAD_WORDS = ['18+', '18 +', 'nc-17', 'smut', 'mature', 'ผู้ใหญ่', 'ntr', 'adult', 'Adult'];

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


// ══════════════════════════════════════════════════════════════
//  ①  SPEED-MANGA.NET
// ══════════════════════════════════════════════════════════════

async function scrapeHome(page) {
    const fetchUrl = page === 1 ? SPEEDMANGA_SITE : `${SPEEDMANGA_SITE}page/${page}/`;
    const html = await fetchHtml(fetchUrl);
    const $ = cheerio.load(html);
    const popular = [], updates = [], seen = new Set();

    $('.listupd .bs').each((_, el) => {
        const url = $(el).find('a').first().attr('href');
        if (!url || seen.has(url)) return;
        seen.add(url);
        const title = $(el).find('.tt').first().text().trim() || $(el).find('a').first().attr('title') || '';
        if (!title) return;
        const imgEl = $(el).find('img').first();
        const image = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
        const lastChapter = $(el).find('.adds a .epxs').first().text().trim() || 'Latest';
        const badge = $(el).find('.colored').first().text().trim() || '';
        const chapters = [];
        $(el).find('.adds a').each((_, a) => {
            const h = $(a).attr('href'), t = $(a).find('.epxs').text().trim() || $(a).text().trim();
            if (h && t && chapters.length < 3) chapters.push({ name: t, url: h, time: 'NEW' });
        });
        popular.push({ title, image, lastChapter, url, badge });
        updates.push({ title, image, url, badge, chapters });
    });

    $('.listupd .utao').each((_, el) => {
        const url = $(el).find('.imgu a').attr('href') || $(el).find('a.series').first().attr('href') || '';
        if (!url || seen.has(url)) return;
        seen.add(url);
        const title = $(el).find('.luf h4').first().text().trim() || $(el).find('a').first().attr('title') || '';
        if (!title) return;
        const imgEl = $(el).find('img').first();
        const image = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || '';
        const badge = $(el).find('.luf ul').attr('class') || '';
        const chapters = [];
        $(el).find('.luf a').each((_, a) => {
            const h = $(a).attr('href'), t = $(a).text().trim();
            if (h && t && (t.includes('ตอนที่') || t.includes('Chapter') || t.includes('Ch.'))) {
                if (chapters.length < 5) chapters.push({ name: t, url: h, time: $(a).parent().find('span').first().text().trim() || 'NEW' });
            }
        });
        if (chapters.length === 0) {
            $(el).find('.luf ul li a').each((_, a) => {
                if (chapters.length < 5) chapters.push({ name: $(a).text().trim(), url: $(a).attr('href'), time: 'NEW' });
            });
        }
        updates.push({ title, image, url, badge, chapters, lastChapter: chapters[0]?.name || 'Latest', time: chapters[0]?.time || 'NEW' });
    });

    return {
        popular: filterAndSort(popular).slice(0, 14),
        updates: filterAndSort(updates).slice(0, 32),
    };
}

app.get('/api/manga/home', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const cacheKey = `home_${page}`;
    try {
        const cached = CACHE.home.get(cacheKey);
        if (cached) return res.json(cached);
        const result = await scrapeHome(page);
        if (result.updates.length > 0) CACHE.home.set(cacheKey, result, 10 * 60 * 1000);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/manga/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing query' });
    try {
        const fetchUrl = `${SPEEDMANGA_SITE}/?s=${encodeURIComponent(q)}&post_type=wp-manga`;
        const html = await fetchHtml(fetchUrl);
        const $ = cheerio.load(html);
        const results = [], seen = new Set();

        $('.listupd .bs, .row-search-chapter, .manga-item').each((_, el) => {
            const a = $(el).find('a').first();
            const url = a.attr('href') || '';
            if (!url || seen.has(url)) return;
            seen.add(url);
            const title = a.attr('title') || $(el).find('.tt, .post-title, h3, h4').first().text().trim() || '';
            if (!title) return;
            const imgEl = $(el).find('img').first();
            const image = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
            const lastChapter = $(el).find('.epxs, .tab-chapter a').first().text().trim() || '';
            const badge = $(el).find('.colored, .type').first().text().trim() || '';
            results.push({ title, image, url, lastChapter, badge });
        });

        res.json({ results: results.slice(0, 30), query: q });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/manga/details', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing URL' });
    const cached = CACHE.details.get(url);
    if (cached) return res.json(cached);
    try {
        const html = await fetchHtml(url);
        const $ = cheerio.load(html);

        let title = $('.entry-title').first().text().trim() || $('.post-title h1').first().text().trim() || url;
        title = title.replace(/^Manga\s*\/\s*/i, '').trim();
        const imgEl = $('.thumb img').first();
        const image = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || '';
        const synopsis = $('.entry-content p').map((_, el) => $(el).text().trim()).get().filter(t => t.length > 20).join('\n\n') || 'ไม่มีเรื่องย่อ';

        const info = {};
        $('.imptdt').each((_, el) => {
            const label = $(el).contents().filter((_, n) => n.nodeType === 3).text().trim() || $(el).find('b, span').first().text().trim();
            const value = $(el).find('i, a, span:last-child').first().text().trim();
            if (label && value && label.length < 30) info[label.replace(':', '').trim()] = value;
        });

        const chapters = [];
        const chSeen = new Set();
        $('#chapterlist ul li').each((i, el) => {
            const a = $(el).find('.eph-num a').first();
            const href = a.attr('href') || '';
            if (!href || chSeen.has(href)) return;
            const name = a.find('.chapternum').text().trim() || a.text().trim().replace(/\s+/g, ' ');
            if (!name) return;
            chSeen.add(href);
            const time = a.find('.chapterdate').text().trim() || '';
            const numMatch = name.match(/(\d+\.?\d*)/);
            chapters.push({ name, url: href, time, num: numMatch ? parseFloat(numMatch[1]) : (9999 - i) });
        });

        if (chapters.length === 0) {
            $('a[href]').each((i, el) => {
                const href = $(el).attr('href') || '', text = $(el).text().trim();
                if (chSeen.has(href) || !href.startsWith('http')) return;
                if (/chapter|ตอน|ch-|ch\d/i.test(href) && /ตอนที่|ตอน|chapter|ch\./i.test(text) && text.length < 60) {
                    chSeen.add(href);
                    const numMatch = text.match(/(\d+\.?\d*)/);
                    chapters.push({ name: text, url: href, time: '', num: numMatch ? parseFloat(numMatch[1]) : (9999 - i) });
                }
            });
        }

        chapters.sort((a, b) => b.num - a.num);
        const data = { title, image, synopsis, info, chapters };
        if (chapters.length > 0) CACHE.details.set(url, data, 60 * 60 * 1000);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/manga/read', async (req, res) => {
    let chapterUrl = req.query.url;
    if (!chapterUrl) return res.status(400).json({ error: 'Missing URL' });
    try {
        chapterUrl = decodeURIComponent(chapterUrl);
        if (!chapterUrl.startsWith('http')) {
            if (chapterUrl.startsWith('/')) chapterUrl = SPEEDMANGA_SITE.slice(0, -1) + chapterUrl;
            else throw new Error('Invalid URL');
        }
    } catch (e) { console.error('[URL Norm]', e.message); }

    if (req.query.nocache !== '1') {
        const cached = CACHE.read.get(chapterUrl);
        if (cached) return res.json(cached);
    }

    try {
        const html = await fetchHtml(chapterUrl);
        let imageUrls = [], prevUrl = null, nextUrl = null;

        const mConfig = html.match(/ts_reader\.run\(\s*({[\s\S]+?})\s*\);/);
        if (mConfig) {
            try {
                const cfg = JSON.parse(mConfig[1]);
                if (cfg.sources?.[0]?.images) imageUrls = cfg.sources[0].images;
                if (cfg.prevUrl) prevUrl = cfg.prevUrl.replace(/\\\//g, '/');
                if (cfg.nextUrl) nextUrl = cfg.nextUrl.replace(/\\\//g, '/');
            } catch { }
        }

        if (imageUrls.length === 0 || !prevUrl || !nextUrl) {
            const $ = cheerio.load(html);
            if (!prevUrl || prevUrl.includes('#')) prevUrl = $('.prev_page, .nav-previous a, a[rel="prev"], .ch-prev-btn').attr('href') || null;
            if (!nextUrl || nextUrl.includes('#')) nextUrl = $('.next_page, .nav-next a, a[rel="next"], .ch-next-btn').attr('href') || null;
            if (imageUrls.length === 0) {
                const mJson = $('script').map((_, e) => $(e).html()).get().join('\n').match(/"images"\s*:\s*(\[[^\]]+\])/);
                if (mJson) { try { imageUrls = JSON.parse(mJson[1]); } catch { } }
                if (imageUrls.length === 0) {
                    $('.reading-content img, .wp-manga-chapter-img, #readerarea img, .page-break img').each((_, img) => {
                        let v = $(img).attr('data-src') || $(img).attr('data-lazy-src') || $(img).attr('src') || '';
                        v = v.trim();
                        if (v.startsWith('//')) v = 'https:' + v;
                        if (v.startsWith('http')) imageUrls.push(v);
                    });
                }
            }
        }

        if (prevUrl?.startsWith('#')) prevUrl = null;
        if (nextUrl?.startsWith('#')) nextUrl = null;
        imageUrls = [...new Set(imageUrls)].filter(s => s?.startsWith('http') && !s.includes('logo') && !s.includes('banner')).map(s => s.replace(/\\\//g, '/'));

        const data = { images: imageUrls, prevUrl, nextUrl };
        CACHE.read.set(chapterUrl, data, 60 * 60 * 1000);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════════════════
//  ②  1668MANGA.COM (ALT SOURCE)
// ══════════════════════════════════════════════════════════════

app.get('/api/alt/read', async (req, res) => {
    const chapterUrl = req.query.url;
    if (!chapterUrl) return res.status(400).json({ error: 'No URL' });
    try {
        const html = await fetchHtml(chapterUrl);
        const $ = cheerio.load(html);
        let imageUrls = [];

        $('#readerarea img, .readerarea img, .reading-content img, .page-break img').each((_, img) => {
            const src = $(img).attr('data-src') || $(img).attr('data-lazy-src') || $(img).attr('src');
            if (src && (src.includes('1668manga.com') || src.includes('168toon.com')) && !src.includes('logo')) imageUrls.push(src.trim());
        });

        if (imageUrls.length === 0) {
            $('script').each((_, el) => {
                let content = $(el).html() || '';
                if (content.includes('ts_reader.run')) {
                    const m = content.match(/ts_reader\.run\(([\s\S]+?)\);/);
                    if (m) { try { const d = JSON.parse(m[1]); if (d.sources?.[0]?.images) imageUrls = d.sources[0].images; } catch { } }
                }
            });
        }

        if (imageUrls.length === 0) {
            const rx = /"([^"]+(?:cdn\.1668manga\.com|img\.168toon\.com)\/[^"]+\.(?:jpe?g|webp|png|avif)(?:\?[^"]*)?)"/gi;
            let m;
            while ((m = rx.exec(html)) !== null) {
                const s = m[1].replace(/\\\//g, '/');
                if (!s.includes('logo') && !s.includes('banner') && !s.includes('avatar') && !s.includes('cropped')) imageUrls.push(s);
            }
        }

        imageUrls = [...new Set(imageUrls)].filter(s => s?.startsWith('http') && !s.includes('logo-1668manga-png'));
        res.json({ images: imageUrls, prevUrl: $('.ch-prev-btn, .nextprev a.prev').attr('href') || null, nextUrl: $('.ch-next-btn, .nextprev a.next').attr('href') || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/alt/manga', async (req, res) => {
    let mangaUrl = req.query.url;
    if (!mangaUrl) return res.status(400).json({ error: 'No URL' });
    try {
        let html = await fetchHtml(mangaUrl);
        let $ = cheerio.load(html);
        if ($('#readerarea').length > 0 || !$('.infotable').length) {
            const real = $('.allc a').attr('href') || $('.breadcrumb a[href*="/manga/"]').first().attr('href');
            if (real && real !== mangaUrl) { mangaUrl = real; html = await fetchHtml(mangaUrl); $ = cheerio.load(html); }
        }
        const title = $('.entry-title').text().trim();
        const imgEl = $('.thumb img').first();
        const image = imgEl.attr('data-src') || imgEl.attr('src');
        const description = $('.entry-content p').text().trim() || $('.description').text().trim();
        const info = {};
        $('.infotable tr').each((_, el) => {
            const l = $(el).find('td:first-child').text().replace(':', '').trim();
            const v = $(el).find('td:last-child').text().trim();
            if (l && v) info[l] = v;
        });
        const chapters = [];
        $('#chapterlist li').each((_, el) => {
            const a = $(el).find('a');
            const name = a.find('.chapternum').text().trim() || a.text().trim().replace(/\s+/g, ' ');
            const url = a.attr('href');
            if (url) chapters.push({ name, url, date: a.find('.chapterdate').text().trim() });
        });
        res.json({ title, image, description, info, chapters });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/alt/home', async (req, res) => {
    try {
        const html = await fetchHtml(ALT_SITE);
        const $ = cheerio.load(html);
        const results = [], seen = new Set();
        $('.listupd .bs').each((_, el) => {
            const a = $(el).find('a').first();
            const url = a.attr('href');
            if (!url || seen.has(url)) return;
            seen.add(url);
            const imgEl = $(el).find('img');
            results.push({ title: a.attr('title') || $(el).find('.tt').text().trim(), url, image: imgEl.attr('data-src') || imgEl.attr('src'), lastChapter: $(el).find('.epxs').text().trim(), source: '1668manga' });
        });
        $('.listupd .utao').each((_, el) => {
            const url = $(el).find('.imgu a').attr('href') || $(el).find('a.series').attr('href');
            if (!url || seen.has(url)) return;
            seen.add(url);
            const imgEl = $(el).find('img');
            results.push({ title: $(el).find('h4').text().trim() || imgEl.attr('title'), url, image: imgEl.attr('data-src') || imgEl.attr('src'), lastChapter: $(el).find('.luf ul li:first-child a').text().trim(), source: '1668manga' });
        });
        res.json({ updates: results });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════════════════
//  ③  READREALM.CO  (Next.js — scrape HTML + __NEXT_DATA__)
//
//  ReadRealm block direct /api/* calls from external scrapers
//  → fetch the real page HTML and pull data from __NEXT_DATA__
//  → fallback to Cheerio DOM scraping if __NEXT_DATA__ misses
// ══════════════════════════════════════════════════════════════

/** Extract __NEXT_DATA__ pageProps from any ReadRealm page */
function extractNextData(html) {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
}

app.get('/api/readrealm/home', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const cacheKey = `rr_home_${page}`;
    try {
        const cached = CACHE_RR.home.get(cacheKey);
        if (cached) return res.json(cached);

        // Fetch the actual home / browse page
        const fetchUrl = page === 1 ? READREALM_SITE : `${READREALM_SITE}/?page=${page}`;
        const html = await fetchHtml(fetchUrl);
        const nd = extractNextData(html);
        const $ = cheerio.load(html);

        let comics = [];

        // ── Strategy 1: __NEXT_DATA__ (fastest when available) ──
        if (nd) {
            const props = nd?.props?.pageProps || {};
            // Common key names ReadRealm uses
            const raw = props.comics || props.mangas || props.data?.comics
                || props.latestComics || props.updatedComics || [];
            comics = raw.map(c => ({
                id: c.id || c._id || c.slug || '',
                title: c.title || c.name || '',
                image: c.coverImage || c.cover || c.thumbnail || c.image || '',
                url: c.slug ? `${READREALM_SITE}/comic/${c.slug}` : `${READREALM_SITE}/comic/${c.id || c._id}`,
                lastChapter: c.latestChapter?.title || c.latestChapterTitle || c.lastChapter || 'ล่าสุด',
                badge: c.type || c.category || c.status || '',
            }));
        }

        // ── Strategy 2: Cheerio DOM scrape (fallback) ──
        if (comics.length === 0) {
            const seen = new Set();
            // Attempt common card selectors used by various Next.js manga sites
            $('a[href*="/comic/"]').each((_, el) => {
                const href = $(el).attr('href') || '';
                const url = href.startsWith('http') ? href : READREALM_SITE + href;
                if (seen.has(url)) return;
                seen.add(url);

                const title = $(el).find('h2, h3, .title, [class*="title"]').first().text().trim()
                    || $(el).attr('title') || $(el).attr('aria-label') || '';
                if (!title || title.length < 2) return;

                const imgEl = $(el).find('img').first();
                const image = imgEl.attr('src') || imgEl.attr('data-src') || '';
                const badge = $(el).find('[class*="type"],[class*="badge"],[class*="genre"]').first().text().trim() || '';

                comics.push({ title, image, url, lastChapter: 'ล่าสุด', badge });
            });
        }

        const result = { updates: filterAndSort(comics), page };
        if (result.updates.length > 0) CACHE_RR.home.set(cacheKey, result, 8 * 60 * 1000);
        res.json(result);
    } catch (e) { console.error('[RR:HOME]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/readrealm/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing query' });
    try {
        // ReadRealm search URL — common Next.js pattern
        const searchUrl = `${READREALM_SITE}/search?keyword=${encodeURIComponent(q)}`;
        const html = await fetchHtml(searchUrl);
        const nd = extractNextData(html);
        const $ = cheerio.load(html);
        let results = [];

        if (nd) {
            const props = nd?.props?.pageProps || {};
            const raw = props.comics || props.results || props.data?.comics || props.searchResults || [];
            results = raw.map(c => ({
                id: c.id || c._id || c.slug || '',
                title: c.title || c.name || '',
                image: c.coverImage || c.cover || c.thumbnail || '',
                url: c.slug ? `${READREALM_SITE}/comic/${c.slug}` : `${READREALM_SITE}/comic/${c.id || c._id}`,
                badge: c.type || c.status || '',
            }));
        }

        if (results.length === 0) {
            const seen = new Set();
            $('a[href*="/comic/"]').each((_, el) => {
                const href = $(el).attr('href') || '';
                const url = href.startsWith('http') ? href : READREALM_SITE + href;
                if (seen.has(url)) return; seen.add(url);
                const title = $(el).find('h2,h3,.title,[class*="title"]').first().text().trim() || $(el).attr('title') || '';
                if (!title || title.length < 2) return;
                const imgEl = $(el).find('img').first();
                results.push({ title, image: imgEl.attr('src') || imgEl.attr('data-src') || '', url, badge: '' });
            });
        }

        res.json({ results, query: q });
    } catch (e) { console.error('[RR:SEARCH]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/readrealm/details', async (req, res) => {
    const comicUrl = req.query.url;
    if (!comicUrl) return res.status(400).json({ error: 'Missing URL' });
    const cached = CACHE_RR.details.get(comicUrl);
    if (cached) return res.json(cached);
    try {
        const html = await fetchHtml(comicUrl);
        const nd = extractNextData(html);
        const $ = cheerio.load(html);

        let title = '', image = '', synopsis = 'ไม่มีเรื่องย่อ', info = {}, chapters = [];

        // ── Strategy 1: __NEXT_DATA__ ──
        if (nd) {
            const props = nd?.props?.pageProps || {};
            const c = props.comic || props.manga || props.data?.comic || props.comicDetail || {};

            title = c.title || c.name || '';
            image = c.coverImage || c.cover || c.thumbnail || '';
            synopsis = c.description || c.synopsis || c.summary || 'ไม่มีเรื่องย่อ';
            info = {
                ประเภท: c.type || c.category || '',
                แนว: (c.genres || c.tags || []).map(g => g.name || g).join(', '),
                สถานะ: c.status || '',
                ผู้แปล: c.translator || c.author || '',
            };

            const chapList = c.chapters || props.chapters || props.data?.chapters || [];
            chapters = chapList.map((ch, i) => ({
                name: ch.title || ch.name || `บทที่ ${ch.number || ch.chapterNumber || i + 1}`,
                url: ch.slug ? `${READREALM_SITE}/comic/chapter/${ch.slug}` : `${READREALM_SITE}/comic/chapter/${ch.id || ch._id}`,
                num: ch.number || ch.chapterNumber || (chapList.length - i),
                time: ch.publishedAt || ch.createdAt || '',
                isFree: ch.isFree !== false && !ch.requireCoin,
            }));
        }

        // ── Strategy 2: Cheerio DOM fallback ──
        if (!title) {
            title = $('h1').first().text().trim()
                || $('[class*="title"]').first().text().trim() || comicUrl;
        }
        if (!image) {
            image = $('img[class*="cover"], img[class*="thumbnail"], .cover img').first().attr('src') || '';
        }
        if (chapters.length === 0) {
            const seen = new Set();
            $('a[href*="/chapter/"], a[href*="chapter-"]').each((i, el) => {
                const href = $(el).attr('href') || '';
                const url = href.startsWith('http') ? href : READREALM_SITE + href;
                if (seen.has(url)) return; seen.add(url);
                const name = $(el).text().trim().replace(/\s+/g, ' ') || `Chapter ${i + 1}`;
                const numMatch = name.match(/(\d+\.?\d*)/);
                chapters.push({ name, url, num: numMatch ? parseFloat(numMatch[1]) : (9999 - i), time: '', isFree: true });
            });
        }

        chapters.sort((a, b) => b.num - a.num);
        const result = { title, image, synopsis, info, chapters };
        if (chapters.length > 0) CACHE_RR.details.set(comicUrl, result, 30 * 60 * 1000);
        res.json(result);
    } catch (e) { console.error('[RR:DETAILS]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/readrealm/read', async (req, res) => {
    const chapterUrl = req.query.url;
    if (!chapterUrl) return res.status(400).json({ error: 'Missing URL' });
    const cached = CACHE_RR.read.get(chapterUrl);
    if (cached) return res.json(cached);
    try {
        const html = await fetchHtml(chapterUrl);
        const nd = extractNextData(html);
        const $ = cheerio.load(html);

        let images = [], prevUrl = null, nextUrl = null;

        // ── Strategy 1: __NEXT_DATA__ ──
        if (nd) {
            const props = nd?.props?.pageProps || {};
            const ch = props.chapter || props.chapterData || props.data?.chapter || {};

            images = (ch.images || ch.pages || ch.content || []).map(img =>
                typeof img === 'string' ? img : (img.url || img.src || img.image || '')
            ).filter(Boolean);

            // prev / next
            const prev = ch.prevChapter || props.prevChapter || {};
            const next = ch.nextChapter || props.nextChapter || {};
            if (prev.slug || prev.id) prevUrl = `${READREALM_SITE}/comic/chapter/${prev.slug || prev.id}`;
            if (next.slug || next.id) nextUrl = `${READREALM_SITE}/comic/chapter/${next.slug || next.id}`;
        }

        // ── Strategy 2: DOM image scrape ──
        if (images.length === 0) {
            $('img[src], img[data-src]').each((_, el) => {
                const src = $(el).attr('data-src') || $(el).attr('src') || '';
                if (src.startsWith('http') && !src.includes('logo') && !src.includes('avatar')
                    && !src.includes('icon') && src.match(/\.(jpe?g|png|webp|avif)/i)) {
                    images.push(src);
                }
            });
        }

        // ── Strategy 3: JSON blob in page scripts ──
        if (images.length === 0) {
            const mImgs = html.match(/"(https?:\/\/[^"]+\.(?:jpe?g|png|webp|avif))"/gi);
            if (mImgs) {
                mImgs.forEach(m => {
                    const u = m.replace(/"/g, '');
                    if (!u.includes('logo') && !u.includes('icon')) images.push(u);
                });
            }
        }

        images = [...new Set(images)].filter(s => s?.startsWith('http'));
        const result = { images, prevUrl, nextUrl };
        if (images.length > 0) CACHE_RR.read.set(chapterUrl, result, 60 * 60 * 1000);
        res.json(result);
    } catch (e) { console.error('[RR:READ]', e.message); res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════════════════
//  ④  READTOON.VIP  (WordPress + Madara/Custom Theme)
//
//  Strategy layers (tries each until data found):
//   1. Madara standard  .listupd .bs / .utao
//   2. Madara alt       .manga-item / .c-latest-comic
//   3. WP Manga         .page-item-detail / .chapter-item
//   4. Generic          any a[href*="/manga/"] with img
// ══════════════════════════════════════════════════════════════

// Debug endpoint v2 — deep HTML inspector
app.get('/api/readtoon/debug', async (req, res) => {
    try {
        const html = await fetchHtml(READTOON_SITE);
        const $ = cheerio.load(html);

        // Collect all unique class names from elements that contain images + links
        const classMap = {};
        $('*').each((_, el) => {
            const cls = $(el).attr('class');
            if (!cls) return;
            cls.split(/\s+/).forEach(c => {
                if (c) classMap[c] = (classMap[c] || 0) + 1;
            });
        });
        // Sort by count, top 60
        const topClasses = Object.entries(classMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 60)
            .map(([cls, count]) => ({ cls, count }));

        // Sample: first .chapter-item HTML
        const chapterItemSample = $('.chapter-item').first().html()?.slice(0, 400) || '';

        // Find all hrefs patterns
        const hrefPatterns = {};
        $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || '';
            const match = href.match(/^https?:\/\/[^/]+\/([^/]+)\//);
            if (match) hrefPatterns[match[1]] = (hrefPatterns[match[1]] || 0) + 1;
        });
        const topHrefs = Object.entries(hrefPatterns).sort((a, b) => b[1] - a[1]).slice(0, 20);

        // Elements that have BOTH an img AND an a tag (likely manga cards)
        const cardCandidates = [];
        $('div, article, li, section').each((_, el) => {
            if ($(el).find('img').length > 0 && $(el).find('a').length > 0) {
                const cls = $(el).attr('class') || '';
                if (cls && !cardCandidates.includes(cls)) cardCandidates.push(cls);
            }
        });

        res.json({
            title: $('title').text(),
            topClasses,
            topHrefs,
            chapterItemSample,
            cardCandidates: cardCandidates.slice(0, 30),
            selectorCounts: {
                '.chapter-item': $('.chapter-item').length,
                '[class*="manga"]': $('[class*="manga"]').length,
                '[class*="comic"]': $('[class*="comic"]').length,
                '[class*="series"]': $('[class*="series"]').length,
                '[class*="card"]': $('[class*="card"]').length,
                '[class*="item"]': $('[class*="item"]').length,
                '[class*="list"]': $('[class*="list"]').length,
                '[class*="book"]': $('[class*="book"]').length,
                '[class*="cover"]': $('[class*="cover"]').length,
                '[class*="thumb"]': $('[class*="thumb"]').length,
                '[class*="latest"]': $('[class*="latest"]').length,
                '[class*="update"]': $('[class*="update"]').length,
                '[class*="recent"]': $('[class*="recent"]').length,
                'article': $('article').length,
                '.swiper-slide': $('.swiper-slide').length,
            },
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/readtoon/home', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const cacheKey = `rt_home_${page}`;
    try {
        const cached = CACHE_RT.home.get(cacheKey);
        if (cached) return res.json(cached);

        const fetchUrl = page === 1 ? READTOON_SITE : `${READTOON_SITE}/page/${page}/`;
        const html = await fetchHtml(fetchUrl);
        const $ = cheerio.load(html);
        const popular = [], updates = [], seen = new Set();

        // ── Layer 1: Madara standard ──────────────────────────
        $('.listupd .bs, .popular-slider .bs, .serieslist .bs').each((_, el) => {
            const url = $(el).find('a').first().attr('href');
            if (!url || seen.has(url)) return; seen.add(url);
            const title = $(el).find('.tt').first().text().trim() || $(el).find('a').first().attr('title') || '';
            if (!title) return;
            const imgEl = $(el).find('img').first();
            const image = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
            const lastChapter = $(el).find('.adds a .epxs, .epxs').first().text().trim() || 'ล่าสุด';
            const badge = $(el).find('.colored, .type, .cate').first().text().trim() || '';
            const chapters = [];
            $(el).find('.adds a').each((_, a) => {
                const h = $(a).attr('href'), t = $(a).find('.epxs').text().trim() || $(a).text().trim();
                if (h && t && chapters.length < 3) chapters.push({ name: t, url: h, time: 'NEW' });
            });
            popular.push({ title, image, lastChapter, url, badge });
            updates.push({ title, image, url, badge, chapters });
        });

        $('.listupd .utao, .utao').each((_, el) => {
            const url = $(el).find('.imgu a').attr('href') || $(el).find('a').first().attr('href') || '';
            if (!url || seen.has(url)) return; seen.add(url);
            const title = $(el).find('.luf h4, h4, .tt').first().text().trim() || $(el).find('img').first().attr('alt') || '';
            if (!title) return;
            const imgEl = $(el).find('img').first();
            const image = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || '';
            const badge = $(el).find('.luf ul').attr('class') || '';
            const chapters = [];
            $(el).find('.luf a, ul li a').each((_, a) => {
                const h = $(a).attr('href'), t = $(a).text().trim();
                if (h && t && chapters.length < 5) chapters.push({ name: t, url: h, time: $(a).parent().find('span').first().text().trim() || 'NEW' });
            });
            updates.push({ title, image, url, badge, chapters, lastChapter: chapters[0]?.name || 'ล่าสุด' });
        });

        // ── Layer 2: Madara alt selectors ─────────────────────
        if (updates.length === 0) {
            $('.page-item-detail, .manga-item, .c-latest-comic__item').each((_, el) => {
                const a = $(el).find('a[href*="/manga/"]').first();
                const url = a.attr('href') || '';
                if (!url || seen.has(url)) return; seen.add(url);
                const title = a.attr('title') || $(el).find('h3,h4,.title,[class*="title"]').first().text().trim() || '';
                if (!title) return;
                const imgEl = $(el).find('img').first();
                const image = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
                const lastChapter = $(el).find('.chapter-item a, .list-chapter a, [class*="chapter"] a').first().text().trim() || 'ล่าสุด';
                const badge = $(el).find('[class*="type"],[class*="badge"]').first().text().trim() || '';
                updates.push({ title, image, url, badge, chapters: [], lastChapter });
            });
        }

        // ── Layer 3: WP-Manga AJAX recent ─────────────────────
        if (updates.length === 0) {
            $('.widget-manga .manga-widget-image, .manga-list-wrap .manga-item').each((_, el) => {
                const a = $(el).find('a').first();
                const url = a.attr('href') || '';
                if (!url || seen.has(url)) return; seen.add(url);
                const title = a.attr('title') || a.text().trim() || '';
                if (!title) return;
                const imgEl = $(el).find('img').first();
                const image = imgEl.attr('data-src') || imgEl.attr('src') || '';
                updates.push({ title, image, url, badge: '', chapters: [], lastChapter: 'ล่าสุด' });
            });
        }

        // ── Layer 4: Generic link-scan fallback ───────────────
        if (updates.length === 0) {
            $('a[href*="/manga/"]').each((_, el) => {
                const url = $(el).attr('href') || '';
                if (!url || seen.has(url) || url === READTOON_SITE + '/manga/') return;
                seen.add(url);
                const title = $(el).attr('title') || $(el).find('h2,h3,h4,[class*="title"]').first().text().trim() || $(el).text().trim().slice(0, 80);
                if (!title || title.length < 2) return;
                const imgEl = $(el).find('img').first();
                const image = imgEl.attr('data-src') || imgEl.attr('src') || '';
                if (!image) return; // only include if has image (avoids nav links)
                updates.push({ title, image, url, badge: '', chapters: [], lastChapter: 'ล่าสุด' });
            });
        }

        const result = { popular: filterAndSort(popular).slice(0, 14), updates: filterAndSort(updates).slice(0, 32) };
        if (result.updates.length > 0) CACHE_RT.home.set(cacheKey, result, 10 * 60 * 1000);
        res.json(result);
    } catch (e) { console.error('[RT:HOME]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/readtoon/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing query' });
    try {
        const searchUrl = `${READTOON_SITE}/?s=${encodeURIComponent(q)}&post_type=wp-manga`;
        const html = await fetchHtml(searchUrl);
        const $ = cheerio.load(html);
        const results = [], seen = new Set();

        $('.c-tabs-item .row-search-chapter, .manga-item, .c-tabs-item__content, .tab-thumb').each((_, el) => {
            const a = $(el).find('a').first();
            const url = a.attr('href') || '';
            if (!url || seen.has(url)) return;
            seen.add(url);
            const title = a.attr('title') || $(el).find('.post-title, h3, h4').first().text().trim() || '';
            if (!title) return;
            const imgEl = $(el).find('img').first();
            const image = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
            results.push({ title, image, url, lastChapter: $(el).find('.chapter, .tab-chapter a').first().text().trim() || '', badge: $(el).find('.manga-title-badges, .type').first().text().trim() || '' });
        });

        // Fallback: wp-json REST API
        if (results.length === 0) {
            try {
                const apiUrl = `${READTOON_SITE}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&type=wp-manga&per_page=20`;
                const json = JSON.parse(await fetchHtml(apiUrl));
                json.forEach(p => results.push({
                    title: p.title?.rendered || p.slug || '',
                    image: p.featured_media_src_url || p.yoast_head_json?.og_image?.[0]?.url || '',
                    url: p.link || `${READTOON_SITE}/manga/${p.slug}/`,
                    lastChapter: '', badge: '',
                }));
            } catch { }
        }

        res.json({ results, query: q });
    } catch (e) { console.error('[RT:SEARCH]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/readtoon/details', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing URL' });
    const cached = CACHE_RT.details.get(url);
    if (cached) return res.json(cached);
    try {
        const html = await fetchHtml(url);
        const $ = cheerio.load(html);

        let title = $('.post-title h1, .entry-title').first().text().trim() || url;
        title = title.replace(/^Manga\s*\/\s*/i, '').trim();
        const imgEl = $('.summary_image img, .thumb img, .manga-thumbnail img').first();
        const image = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
        const synopsis = $('.summary__content p, .entry-content p, .manga-summary').map((_, el) => $(el).text().trim()).get().filter(t => t.length > 10).join('\n\n') || 'ไม่มีเรื่องย่อ';

        const info = {};
        $('.post-content_item, .manga-details-info li').each((_, el) => {
            const label = $(el).find('.summary-heading h5, dt, .label').first().text().replace(':', '').trim();
            const value = $(el).find('.summary-content, dd, .value').first().text().trim() || $(el).find('a').map((_, a) => $(a).text()).get().join(', ');
            if (label && value && label.length < 30) info[label] = value;
        });

        const chapters = [], chSeen = new Set();
        $('#chapterlist ul li, .listing-chapters_wrap li, .wp-manga-chapter').each((i, el) => {
            const a = $(el).find('a').first();
            const href = a.attr('href') || '';
            if (!href || chSeen.has(href)) return;
            const name = $(el).find('.chapter-manhwa-title, .chapter-title, span:first-child').first().text().trim() || a.text().trim().replace(/\s+/g, ' ');
            if (!name) return;
            chSeen.add(href);
            const time = $(el).find('.chapter-release-date, .chapter-time').first().text().trim() || '';
            const numMatch = name.match(/(\d+\.?\d*)/);
            chapters.push({ name, url: href, time, num: numMatch ? parseFloat(numMatch[1]) : (9999 - i) });
        });

        chapters.sort((a, b) => b.num - a.num);
        const data = { title, image, synopsis, info, chapters };
        if (chapters.length > 0) CACHE_RT.details.set(url, data, 60 * 60 * 1000);
        res.json(data);
    } catch (e) { console.error('[RT:DETAILS]', e.message); res.status(500).json({ error: e.message }); }
});

// ReadToon: Madara AJAX chapter loader (เรียกแยก เมื่อ details ไม่มี chapter)
app.get('/api/readtoon/chapters', async (req, res) => {
    const mangaId = req.query.id;
    if (!mangaId) return res.status(400).json({ error: 'Missing manga ID' });
    try {
        const gs = await getGotScraping();
        const response = await gs.post(`${READTOON_SITE}/wp-admin/admin-ajax.php`, {
            form: { action: 'manga_get_chapters', manga: mangaId },
            headerGeneratorOptions: { browsers: [{ name: 'chrome', minVersion: 115 }], devices: ['desktop'], operatingSystems: ['windows'] },
            timeout: { request: 20000 },
        });
        const $ = cheerio.load(response.body);
        const chapters = [], seen = new Set();
        $('.wp-manga-chapter, li.a-h').each((i, el) => {
            const a = $(el).find('a').first();
            const href = a.attr('href') || '';
            if (!href || seen.has(href)) return;
            seen.add(href);
            const name = a.text().trim().replace(/\s+/g, ' ');
            const time = $(el).find('.chapter-release-date').text().trim() || '';
            const numMatch = name.match(/(\d+\.?\d*)/);
            chapters.push({ name, url: href, time, num: numMatch ? parseFloat(numMatch[1]) : (9999 - i) });
        });
        chapters.sort((a, b) => b.num - a.num);
        res.json({ chapters });
    } catch (e) { console.error('[RT:CHAPTERS]', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/readtoon/read', async (req, res) => {
    let chapterUrl = req.query.url;
    if (!chapterUrl) return res.status(400).json({ error: 'Missing URL' });
    try { chapterUrl = decodeURIComponent(chapterUrl); } catch { }
    const cached = CACHE_RT.read.get(chapterUrl);
    if (cached) return res.json(cached);
    try {
        const html = await fetchHtml(chapterUrl);
        let imageUrls = [], prevUrl = null, nextUrl = null;

        const mConfig = html.match(/ts_reader\.run\(\s*({[\s\S]+?})\s*\);/);
        if (mConfig) {
            try {
                const cfg = JSON.parse(mConfig[1]);
                if (cfg.sources?.[0]?.images) imageUrls = cfg.sources[0].images;
                if (cfg.prevUrl) prevUrl = cfg.prevUrl.replace(/\\\//g, '/');
                if (cfg.nextUrl) nextUrl = cfg.nextUrl.replace(/\\\//g, '/');
            } catch { }
        }

        if (imageUrls.length === 0 || !prevUrl || !nextUrl) {
            const $ = cheerio.load(html);
            if (!prevUrl) prevUrl = $('a.prev_page, .nav-previous a, .ch-prev-btn, a[rel="prev"]').attr('href') || null;
            if (!nextUrl) nextUrl = $('a.next_page, .nav-next a, .ch-next-btn, a[rel="next"]').attr('href') || null;
            if (imageUrls.length === 0) {
                const mJson = html.match(/"images"\s*:\s*(\[[^\]]+\])/);
                if (mJson) { try { imageUrls = JSON.parse(mJson[1]); } catch { } }
                if (imageUrls.length === 0) {
                    $('.reading-content img, .wp-manga-chapter-img, #readerarea img, .page-break img').each((_, img) => {
                        let v = $(img).attr('data-src') || $(img).attr('data-lazy-src') || $(img).attr('src') || '';
                        v = v.trim();
                        if (v.startsWith('//')) v = 'https:' + v;
                        if (v.startsWith('http') && !v.includes('logo')) imageUrls.push(v);
                    });
                }
            }
        }

        if (prevUrl?.startsWith('#')) prevUrl = null;
        if (nextUrl?.startsWith('#')) nextUrl = null;
        imageUrls = [...new Set(imageUrls)].filter(s => s?.startsWith('http') && !s.includes('logo') && !s.includes('banner')).map(s => s.replace(/\\\//g, '/'));

        const result = { images: imageUrls, prevUrl, nextUrl };
        CACHE_RT.read.set(chapterUrl, result, 60 * 60 * 1000);
        res.json(result);
    } catch (e) { console.error('[RT:READ]', e.message); res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════════════════
//  IMAGE PROXY  (ทุกแหล่งรูปภาพ)
// ══════════════════════════════════════════════════════════════
app.get('/api/proxy', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('No image URL');
    try {
        let referer = SPEEDMANGA_SITE;
        try {
            const u = new URL(imageUrl);
            referer = u.origin + '/';
            // Adjust referer per known CDN domains
            if (imageUrl.includes('imgez.org') || imageUrl.includes('speed-manga.net')) referer = 'https://speed-manga.net/';
            if (imageUrl.includes('1668manga.com') || imageUrl.includes('168toon.com')) referer = 'https://1668manga.com/';
            if (imageUrl.includes('readrealm.co')) referer = 'https://readrealm.co/';
            if (imageUrl.includes('readtoon.vip')) referer = 'https://readtoon.vip/';
        } catch { }

        const response = await got(imageUrl, {
            headers: {
                'referer': referer,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            },
            timeout: { request: 15000 },
            followRedirect: true,
            maxRedirects: 10,
            retry: { limit: 2 },
            responseType: 'buffer',
            https: { rejectUnauthorized: false },
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Proxy-By', 'SpeedManga-Engine');
        res.send(response.body);
    } catch (err) {
        console.error(`[PROXY] Failed: ${imageUrl} — ${err.message}`);
        res.status(404).send('Image not found');
    }
});


// ══════════════════════════════════════════════════════════════
//  STATUS
// ══════════════════════════════════════════════════════════════
app.get('/api/status', (_req, res) => res.json({
    status: 'online',
    engine: 'got-scraping + cheerio (No Puppeteer)',
    sources: ['speed-manga.net', '1668manga.com', 'readrealm.co', 'readtoon.vip'],
    cache: {
        speedmanga: { home: CACHE.home.stats(), details: CACHE.details.stats(), read: CACHE.read.stats() },
        readrealm: { home: CACHE_RR.home.stats(), details: CACHE_RR.details.stats(), read: CACHE_RR.read.stats() },
        readtoon: { home: CACHE_RT.home.stats(), details: CACHE_RT.details.stats(), read: CACHE_RT.read.stats() },
    },
}));

// ─── 404 fallback ─────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));


// ══════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
    console.log('══════════════════════════════════════════════════');
    console.log('🧪  SpeedManga API Tester — test.js');
    console.log(`    http://localhost:${PORT}/`);
    console.log('    → เปิด browser แล้วไปที่ URL ด้านบน');
    console.log('    Sources: speed-manga | 1668manga | readrealm | readtoon');
    console.log('══════════════════════════════════════════════════');
});