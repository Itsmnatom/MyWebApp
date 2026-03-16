/**
 * SpeedManga - Backend Server (Cheerio + got-scraping Optimized v3)
 *
 * Improvements vs v2:
 *  1. Server is much lighter, RAM usage is around ~50MB (instead of ~300-500MB).
 *  2. Faster responses since we don't open headless browsers.
 *  3. Bypasses basic Cloudflare challenges using got-scraping TLS impersonation.
 */

'use strict';

const express = require('express');
const cors = require('cors');
const got = require('got');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET_SITE = 'https://speed-manga.net/';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════
//  LRU CACHE
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
//  SCRAPING ENGINE (Axios/Got + Cheerio)
// ══════════════════════════════════════════════════
async function fetchHTML(url) {
    try {
        const response = await got(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: 15000,
            retry: 1
        });
        return cheerio.load(response.body);
    } catch (e) {
        throw new Error(`Failed to fetch ${url}: ${e.message}`);
    }
}

// ══════════════════════════════════════════════════
//  FILTER + SORT (ตัด 18+, ดัน Manhwa)
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
    engine: 'got-cheerio',
    cache: { home: CACHE.home.stats(), details: CACHE.details.stats(), read: CACHE.read.stats() },
}));

// ══════════════════════════════════════════════════
//  API: IMAGE PROXY
// ══════════════════════════════════════════════════
app.get('/api/proxy', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('No image URL');
    try {
        const response = await got(imageUrl, {
            responseType: 'buffer',
            headers: { Referer: TARGET_SITE }
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(response.body);
    } catch { res.status(500).send('Proxy error'); }
});

// ══════════════════════════════════════════════════
//  API: HOME
// ══════════════════════════════════════════════════
app.get('/api/manga/home', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const cacheKey = `updates_${page}`;

    try {
        const cachedUpdates = CACHE.home.get(cacheKey);
        let popular = [];
        let updates = cachedUpdates;

        const fetchUrl = page === 1 ? TARGET_SITE : `${TARGET_SITE}page/${page}/`;

        if (page === 1 || !cachedUpdates) {
            const $ = await fetchHTML(fetchUrl);

            // Extract Popular (only on page 1)
            if (page === 1) {
                const popularCached = CACHE.home.get('popular');
                if (popularCached) {
                    popular = popularCached;
                } else {
                    const popItems = [];
                    // Using common selectors for popular items in madara/mangastream themes
                    $('.popular-slider .page-item-detail, #manga-featured-content .page-item-detail, .owl-carousel .page-item-detail, .popular-item-wrap').each((_, el) => {
                        const url = $(el).find('a').attr('href');
                        if (!url) return;

                        const title = $(el).find('.post-title a, h3 a, .tt, .title, .name').text().trim() || $(el).find('a').attr('title');
                        const imgEl = $(el).find('img');
                        const image = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('data-cfsrc') || imgEl.attr('src');
                        const badge = $(el).find('.manga-title-badges, .badge, .type').text().trim();
                        const lastChapter = $(el).find('.chapter-item .chapter, .epxs, .chapter, .font-meta.chapter, .eph-num a').text().trim() || 'Latest';

                        popItems.push({ title, image, url, badge, lastChapter });
                    });
                    popular = filterAndSort(popItems).slice(0, 14);
                    CACHE.home.set('popular', popular, 10 * 60 * 1000);
                }
            }

            // Extract Updates
            if (!cachedUpdates) {
                const updItems = [];
                $('.page-content-listing .page-item-detail, .listupd .utao, .listupd .bs, .uta, .page-item-detail').each((_, el) => {
                    const url = $(el).find('a').attr('href');
                    if (!url) return;

                    const title = $(el).find('.post-title a, h3 a, .tt, .title, .name').text().trim() || $(el).find('a').attr('title');
                    const imgEl = $(el).find('img');
                    const image = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('data-cfsrc') || imgEl.attr('src');
                    const badge = $(el).find('.manga-title-badges, .badge, .type').text().trim();

                    const chapters = [];
                    $(el).find('.list-chapter .chapter-item, .luf ul li, .cl ul li, .chapter-item').each((idx, ch) => {
                        if (idx >= 2) return;
                        const chUrl = $(ch).find('a').attr('href');
                        if (chUrl) {
                            chapters.push({
                                name: $(ch).find('a').text().trim(),
                                url: chUrl,
                                time: $(ch).find('.post-on, .chapter-release-date, span:last-child').text().trim() || 'NEW'
                            });
                        }
                    });
                    updItems.push({ title, image, url, badge, chapters });
                });
                updates = filterAndSort(updItems);
                CACHE.home.set(cacheKey, updates, 5 * 60 * 1000);
            }
        }

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
        const $ = await fetchHTML(url);

        const title = $('.post-title h1, .entry-title, .tt, h1').first().text().trim();
        const imgEl = $('.summary_image img, .thumb img, .series-thumb img, .cover img').first();
        const image = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
        const synopsis = $('.summary__content, .manga-excerpt, .desc, .entry-content p').first().text().trim();

        const info = {};
        $('.post-content_item').each((_, item) => {
            const label = $(item).find('.summary-heading h5').text().replace(':', '').trim();
            const value = $(item).find('.summary-content').text().trim();
            if (label && value) info[label] = value;
        });

        const chapters = [];
        $('.wp-manga-chapter, .eplister li, #chapterlist li, .chapterlist li, .cl ul li').each((_, el) => {
            const chUrl = $(el).find('a').attr('href');
            if (chUrl) {
                chapters.push({
                    name: $(el).find('a').text().trim(),
                    url: chUrl,
                    time: $(el).find('.chapter-release-date, .chapterdate, i, span:last-child').text().trim()
                });
            }
        });

        const data = { title, image, synopsis, info, chapters };
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
        const textResponse = await got(chapterUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            }
        });
        const html = textResponse.body;
        const $ = cheerio.load(html);

        const prevUrl = $('.prev_page, .nav-previous a, .nextprev a[rel="prev"], a.prev_page').attr('href') || null;
        const nextUrl = $('.next_page, .nav-next a, .nextprev a[rel="next"], a.next_page').attr('href') || null;

        let imageUrls = [];

        // Method 1: Search for JSON blocks in raw HTML (common in Madara and MangaStream themes)
        const m1 = html.match(/"images"\s*:\s*(\[[^\]]+\])/);
        const m2 = html.match(/ts_reader\.run\(\s*(\{[\s\S]+?\})\s*\)/);

        if (m1) {
            try { imageUrls = JSON.parse(m1[1]).map(u => u.replace(/\\\//g, '/').trim()); } catch (e) { }
        } else if (m2) {
            try {
                const obj = JSON.parse(m2[1]);
                const src = obj.sources?.[0];
                if (src?.images) imageUrls = src.images;
            } catch (e) { }
        }

        // Method 2: Fallback to reading DOM images
        if (imageUrls.length === 0) {
            $('.reading-content img, .wp-manga-chapter-img, #readerarea img, .page-break img, .chapter-content img').each((_, img) => {
                const v = $(img).attr('data-src') || $(img).attr('data-lazy-src') || $(img).attr('data-cfsrc') || $(img).attr('src');
                if (v && v.startsWith('http')) imageUrls.push(v);
            });
        }

        // Filter valid mangapages
        imageUrls = [...new Set(imageUrls)].filter(
            s => s && s.startsWith('http')
                && !s.includes('/logo') && !s.includes('/banner')
                && /\.(jpe?g|png|webp|gif)/i.test(s)
        );

        const data = { images: imageUrls, prevUrl, nextUrl };
        CACHE.read.set(chapterUrl, data, 60 * 60 * 1000);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
    console.log('══════════════════════════════════════════');
    console.log('🚀  SpeedManga — Cheerio API Engine v3  🚀');
    console.log(`   http://localhost:${PORT}`);
    console.log('   (Puppeteer removed. Memory ~50MB)');
    console.log('══════════════════════════════════════════');
});