/**
 * SpeedManga - Backend Server (Super Optimized v3)
 *
 * Improvements vs v2:
 * 1. No Puppeteer! Removed headless browser entirely.
 * 2. RAM usage dropped from ~500MB to < 50MB.
 * 3. Speed increased dramatically using pure HTTP parsing.
 * 4. Uses `got-scraping` to bypass basic bot protections.
 * 5. Uses `cheerio` to parse DOM exactly like the browser version.
 *
 * Setup:
 * npm uninstall puppeteer
 * npm install express cors cheerio got-scraping
 * node server.js
 */

'use strict';

const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const path = require('path');
const got = require('got'); // Required for Stable Proxy
const axios = require('axios'); // Optional but in package.json

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET_SITE = 'https://speed-manga.net/';

// Global Error Logging
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err.message);
    console.error(err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

app.use(cors());
app.use(express.json());

// SPA Routes — must be before express.static so refreshing these paths returns index.html
const SPA_ROUTES = ['/', '/history', '/bookmarks', '/manga', '/read', '/alt', '/search'];
SPA_ROUTES.forEach(r => {
    app.get(r, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
});

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
    home: new LRUCache(10),    // Reduced from 20
    details: new LRUCache(50), // Reduced from 200
    read: new LRUCache(50),    // Reduced from 500
};

// --- Optimization & Masking Config ---
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || ''; // If provided, uses ScraperAPI.com (Free 5k/mo)
const PROXY_URL = process.env.PROXY_URL || '';           // Generic Proxy URL support

let _gotScraping = null;
async function getGotScraping() {
    if (!_gotScraping) {
        const mod = await import('got-scraping');
        _gotScraping = mod.gotScraping;
    }
    return _gotScraping;
}

async function fetchHtml(url) {
    try {
        const gotScraping = await getGotScraping();
        // Decode first in case it's already encoded, then encode strictly
        const normalizedUrl = encodeURI(decodeURI(url));

        let targetUrl = normalizedUrl;
        let options = {
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 115 }],
                devices: ['desktop'],
                operatingSystems: ['windows']
            },
            http2: true,
            timeout: { request: 30000 },
            retry: { limit: 1 }
        };

        // 1. If ScraperAPI key is provided, route through it (Fastest Masking)
        if (SCRAPER_API_KEY) {
            targetUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
            options.http2 = false; // ScraperAPI works better with http1
            console.log('[SpeedManga] Masking through ScraperAPI...');
        }
        // 2. Else if a Generic Proxy is provided
        else if (PROXY_URL) {
            options.proxyUrl = PROXY_URL;
            console.log('[SpeedManga] Masking through Proxy:', PROXY_URL.substring(0, 20) + '...');
        }

        console.log('[SpeedManga] Initiating fetch for:', url);
        const response = await gotScraping(targetUrl, options);
        console.log(`[fetchHtml] Success [${response.statusCode}] for ${url.substring(0, 60)}...`);
        return response.body;
    } catch (error) {
        // If it's a 404 or 403, it's not a server crash, but a target site issue
        if (error.response && error.response.statusCode) {
            console.error(`[fetchHtml] Target site returned ${error.response.statusCode} for ${url}`);
            throw new Error(`Upstream site returned ${error.response.statusCode}`);
        }
        console.error(`[fetchHtml] CRASH for ${url}:`, error.message);
        throw error;
    }
}

// ══════════════════════════════════════════════════
//  FILTER + SORT (ตัด 18+, ดัน Manhwa)
// ══════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════
//  SCRAPING LOGIC (Cheerio) — Single Fetch for Home
// ══════════════════════════════════════════════════

/**
 * Scrape home page — fetch ONCE, extract popular (.bs) + updates (.utao).
 *
 * HTML structure confirmed from dump:
 *  Popular: .listupd.popularslider .bs -> .bsx > a[href] (cover link), .tt (title), .adds a .epxs (latest chapter), .colored (badge), img (cover)
 *  Updates: .listupd .utao -> .uta > .imgu > a[href] (cover link), img (cover), .luf > a > h4 (title), .luf > ul > li > a (chapter link+name), li > span (time)
 */
async function scrapeHome(page) {
    const fetchUrl = page === 1 ? TARGET_SITE : `${TARGET_SITE}page/${page}/`;
    const html = await fetchHtml(fetchUrl);
    const $ = cheerio.load(html);
    const popular = [];
    const updates = [];
    const seen = new Set(); // shared dedup across popular+updates

    // ── POPULAR + UPDATES: .bs (featured slider, internal) ──
    $('.listupd .bs').each((_, el) => {
        const url = $(el).find('a').first().attr('href');
        if (!url || seen.has(url)) return;
        seen.add(url);

        const title = $(el).find('.tt').first().text().trim()
            || $(el).find('a').first().attr('title') || '';
        if (!title) return;

        const imgEl = $(el).find('img').first();
        const image = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
        const lastChapter = $(el).find('.adds a .epxs').first().text().trim() || 'Latest';
        const badge = $(el).find('.colored').first().text().trim() || '';

        // Chapters from .adds a (Aggressive)
        const chapters = [];
        $(el).find('.adds a').each((idx, a) => {
            const h = $(a).attr('href');
            const t = $(a).text().trim();
            const epxs = $(a).find('.epxs').text().trim();
            const chName = epxs || t;

            if (h && chName && (chName.includes('ตอนที่') || chName.includes('Chapter') || chName.includes('Ch.'))) {
                if (chapters.length < 3) {
                    chapters.push({ name: chName, url: h, time: 'NEW' });
                }
            }
        });

        popular.push({ title, image, lastChapter, url, badge });
        updates.push({ title, image, url, badge, chapters }); // also in updates
    });

    // ── UPDATES ONLY: .utao (latest updates grid — 42 items, internal + affiliate) ──
    $('.listupd .utao').each((_, el) => {
        const url = $(el).find('.imgu a').attr('href')
            || $(el).find('a.series').first().attr('href') || '';
        if (!url || seen.has(url)) return;
        seen.add(url);

        const title = $(el).find('.luf h4').first().text().trim()
            || $(el).find('a').first().attr('title') || '';
        if (!title) return;

        const imgEl = $(el).find('img').first();
        const image = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || '';
        const badge = $(el).find('.luf ul').attr('class') || '';

        // Aggressive Chapter Extraction for Updates
        const chapters = [];
        $(el).find('.luf a').each((_, a) => {
            const h = $(a).attr('href');
            const t = $(a).text().trim();
            // Match anything that looks like a chapter link
            if (h && t && (t.includes('ตอนที่') || t.includes('Chapter') || t.includes('Ch.'))) {
                if (chapters.length < 5) {
                    const timeEl = $(a).parent().find('span').first();
                    chapters.push({
                        name: t,
                        url: h,
                        time: timeEl.text().trim() || 'NEW'
                    });
                }
            }
        });

        // If still empty, try looking for ANY link that isn't the title link
        if (chapters.length === 0) {
            $(el).find('.luf ul li a').each((_, a) => {
                if (chapters.length < 5) {
                    chapters.push({ name: $(a).text().trim(), url: $(a).attr('href'), time: 'NEW' });
                }
            });
        }

        const lastChapter = chapters.length > 0 ? chapters[0].name : 'Latest';
        const time = chapters.length > 0 ? chapters[0].time : 'NEW';

        updates.push({ title, image, url, badge, chapters, lastChapter, time });
    });

    return {
        popular: filterAndSort(popular).slice(0, 14),
        updates: filterAndSort(updates).slice(0, 32)
    };
}

// ══════════════════════════════════════════════════
//  API: SEARCH
// ══════════════════════════════════════════════════
app.get('/api/manga/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing query' });
    try {
        const fetchUrl = `${TARGET_SITE}/?s=${encodeURIComponent(q)}&post_type=wp-manga`;
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


// ══════════════════════════════════════════════════
//  API: HOME
// ══════════════════════════════════════════════════
app.get('/api/manga/home', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const cacheKey = `home_${page}`;

    try {
        const cached = CACHE.home.get(cacheKey);
        if (cached) return res.json(cached);

        const result = await scrapeHome(page);

        if (result.updates.length > 0) {
            CACHE.home.set(cacheKey, result, 10 * 60 * 1000); // 10 mins
        }

        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// ══════════════════════════════════════════════════
//  API: MANGA DETAILS
// ══════════════════════════════════════════════════
app.get('/api/manga/details', async (req, res) => {
    const url = req.query.url;
    console.log(`[API] Details requested for: ${url}`);
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    const cached = CACHE.details.get(url);
    if (cached) {
        console.log(`[API] Serving from cache: ${url}`);
        return res.json(cached);
    }

    try {
        console.log(`[API] Fetching HTML from upstream...`);
        const html = await fetchHtml(url);
        const $ = cheerio.load(html);

        // Title: .entry-title is the manga title on speed-manga.net
        // h1 is the site-wide SEO heading (wrong!) — must avoid it
        let title = $('.entry-title').first().text().trim()
            || $('.post-title h1').first().text().trim()
            || url;
        title = title.replace(/^Manga\s*\/\s*/i, '').trim();

        // Cover image: .thumb img src (confirmed correct from HTML dump)
        const imgEl = $('.thumb img').first();
        const image = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || '';

        // Synopsis: .entry-content p (actual text block on speed-manga)
        const synopsis = $('.entry-content p').map((_, el) => $(el).text().trim()).get()
            .filter(t => t.length > 20).join('\n\n') || 'ไม่มีเรื่องย่อ';

        const info = {};
        $('.imptdt').each((_, el) => {
            const text = $(el).text().trim();
            // Structure is usually "Label <i>Value</i>" or similar
            const label = $(el).contents().filter((_, node) => node.nodeType === 3).text().trim()
                || $(el).find('b, span').first().text().trim();
            const value = $(el).find('i, a, span:last-child').first().text().trim();

            if (label && value && label.length < 30) {
                const cleanLabel = label.replace(':', '').trim();
                if (cleanLabel) info[cleanLabel] = value;
            }
        });

        // Chapters: #chapterlist ul li → .eph-num a → .chapternum (name) + .chapterdate (time)
        const chapters = [];
        const chSeen = new Set();

        $('#chapterlist ul li').each((i, el) => {
            const a = $(el).find('.eph-num a').first();
            const href = a.attr('href') || '';
            if (!href || href.startsWith('#') || chSeen.has(href)) return;

            const name = a.find('.chapternum').text().trim()
                || a.text().trim().replace(/\s+/g, ' ');
            if (!name) return;

            chSeen.add(href);
            const time = a.find('.chapterdate').text().trim() || '';
            const numMatch = name.match(/(\d+\.?\d*)/);
            chapters.push({
                name,
                url: href,
                time,
                num: numMatch ? parseFloat(numMatch[1]) : (9999 - i)
            });
        });

        // Fallback: generic link scan if no chapters found
        if (chapters.length === 0) {
            $('a[href]').each((i, el) => {
                const href = $(el).attr('href') || '';
                const text = $(el).text().trim();
                if (chSeen.has(href) || !href.startsWith('http')) return;
                const isChLink = /chapter|ตอน|ch-|ch\d/i.test(href);
                const hasChText = /ตอนที่|ตอน|chapter|ch\./i.test(text);
                if (isChLink && hasChText && text.length < 60) {
                    chSeen.add(href);
                    const numMatch = text.match(/(\d+\.?\d*)/);
                    chapters.push({ name: text, url: href, time: '', num: numMatch ? parseFloat(numMatch[1]) : (9999 - i) });
                }
            });
        }

        chapters.sort((a, b) => b.num - a.num);
        const data = { title, image, synopsis, info, chapters };

        if (data.chapters && data.chapters.length > 0) {
            CACHE.details.set(url, data, 60 * 60 * 1000); // 1 hour
        }
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════
//  API: READ CHAPTER
// ══════════════════════════════════════════════════
app.get('/api/manga/read', async (req, res) => {
    let chapterUrl = req.query.url;
    if (!chapterUrl) return res.status(400).json({ error: 'Missing URL' });

    // Normalize URL (Handle Thai characters and encoding mess)
    try {
        chapterUrl = decodeURIComponent(chapterUrl);
        if (!chapterUrl.startsWith('http')) {
            // Check if it's relative
            if (chapterUrl.startsWith('/')) chapterUrl = TARGET_SITE.slice(0, -1) + chapterUrl;
            else throw new Error('Invalid URL format');
        }
    } catch (e) {
        console.error('[API] URL Normalization failed:', e.message);
    }

    console.log(`[API] Read requested: ${chapterUrl}`);
    const nocache = req.query.nocache === '1';

    if (!nocache) {
        const cached = CACHE.read.get(chapterUrl);
        if (cached) return res.json(cached);
    }

    try {
        const html = await fetchHtml(chapterUrl);

        // --- Faster Extraction: Raw Regex (Bypassing DOM if possible) ---
        let imageUrls = [];
        let prevUrl = null;
        let nextUrl = null;

        const mConfig = html.match(/ts_reader\.run\(\s*({[\s\S]+?})\s*\);/);
        if (mConfig) {
            try {
                const config = JSON.parse(mConfig[1]);
                if (config.sources?.[0]?.images) imageUrls = config.sources[0].images;
                if (config.prevUrl) prevUrl = config.prevUrl.replace(/\\\//g, '/');
                if (config.nextUrl) nextUrl = config.nextUrl.replace(/\\\//g, '/');
            } catch (e) { console.warn('[API:READ] Regex JSON parse failed'); }
        }

        // --- Fallback & Tuning: Only use Cheerio if Regex missed something ---
        if (imageUrls.length === 0 || !prevUrl || !nextUrl) {
            const $ = cheerio.load(html);
            const scripts = $('script').map((_, e) => $(e).html()).get().join('\n');

            if (!prevUrl || prevUrl.includes('#')) {
                prevUrl = $('.prev_page, .nav-previous a, .nextprev a[rel="prev"], a.prev_page, .ch-prev-btn').attr('href') || null;
            }
            if (!nextUrl || nextUrl.includes('#')) {
                nextUrl = $('.next_page, .nav-next a, .nextprev a[rel="next"], a.next_page, .ch-next-btn').attr('href') || null;
            }

            if (imageUrls.length === 0) {
                // Secondary JSON search
                const mJson = scripts.match(/"images"\s*:\s*(\[[^\]]+\])/);
                if (mJson) {
                    try { imageUrls = JSON.parse(mJson[1]); } catch (e) { }
                }

                // Final DOM Scrape
                if (imageUrls.length === 0) {
                    $('.reading-content img, .wp-manga-chapter-img, #readerarea img, .page-break img, .chapter-content img, .entry-content img').each((_, img) => {
                        let v = $(img).attr('data-src') || $(img).attr('data-lazy-src') || $(img).attr('data-cfsrc') || $(img).attr('src') || $(img).attr('data-original');
                        if (v) {
                            v = v.trim();
                            if (v.startsWith('//')) v = 'https:' + v;
                            if (v.startsWith('http')) imageUrls.push(v);
                        }
                    });
                }
            }
        }

        // Clean up placeholders
        if (prevUrl && prevUrl.startsWith('#')) prevUrl = null;
        if (nextUrl && nextUrl.startsWith('#')) nextUrl = null;

        // Standardize URLs and filter junk
        imageUrls = [...new Set(imageUrls)]
            .filter(s => s && s.startsWith('http') && !s.includes('logo') && !s.includes('banner'))
            .map(s => s.replace(/\\\//g, '/'));

        const data = { images: imageUrls, prevUrl, nextUrl };
        CACHE.read.set(chapterUrl, data, 60 * 60 * 1000);
        res.json(data);
    } catch (e) {
        console.error(`[API:READ] CRASH for ${chapterUrl}:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════════════
//  API: STATUS & PROXY
// ══════════════════════════════════════════════════
app.get('/api/status', (_req, res) => res.json({
    status: 'online',
    engine: 'got-scraping + cheerio',
    cache: { home: CACHE.home.stats(), details: CACHE.details.stats(), read: CACHE.read.stats() },
}));

// Proxy เพื่อหลบการบล็อก Hotlink และรองรับ Protocol ที่เสถียรขึ้น
app.get('/api/proxy', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('No image URL');

    try {
        let referer = TARGET_SITE;
        try {
            const urlObj = new URL(imageUrl);
            referer = urlObj.origin + '/';
        } catch (e) {}

        const imageUrlLower = imageUrl.toLowerCase();
        
        // SpeedManga sources (including various CDNs like imgez.org) 
        // usually work best with the primary site as referer.
        if (imageUrlLower.includes('imgez.org') || imageUrlLower.includes('speed-manga.net')) {
            referer = 'https://speed-manga.net/';
        }

        const response = await got(imageUrl, {
            headers: {
                'referer': referer,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'connection': 'keep-alive'
            },
            timeout: { request: 15000 },
            followRedirect: true,
            maxRedirects: 10,
            retry: { limit: 2 },
            responseType: 'buffer',
            https: { rejectUnauthorized: false } // ป้องกันปัญหา Cert ของบางเว็บบรรยายมังงะ
        });

        // ส่ง Headers ที่จำเป็นกลับไปให้ Browser
        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Access-Control-Allow-Origin', '*'); // รองรับ CORS
        res.setHeader('X-Proxy-By', 'SpeedManga-Engine');

        res.send(response.body);
    } catch (err) {
        console.error(`[PROXY ERROR] Failure for ${imageUrl}: ${err.message}`);
        res.status(404).send('Image extraction failed');
    }
});

// ══════════════════════════════════════════════════
//  API: ALTERNATIVE SOURCE (1668manga.com)
// ══════════════════════════════════════════════════
const ALT_SITE = 'https://1668manga.com/';

app.get('/api/alt/read', async (req, res) => {
    const chapterUrl = req.query.url;
    if (!chapterUrl) return res.status(400).json({ error: 'No URL provided' });

    try {
        const html = await fetchHtml(chapterUrl);
        const $ = cheerio.load(html);
        let imageUrls = [];

        // 1. Try direct images
        $('#readerarea img, .readerarea img, .reading-content img, .page-break img').each((_, img) => {
            const src = $(img).attr('data-src') || $(img).attr('data-lazy-src') || $(img).attr('src');
            if (src && (src.includes('1668manga.com') || src.includes('168toon.com')) && !src.includes('logo')) {
                imageUrls.push(src.trim());
            }
        });

        // 2. Look for JSON (ts_reader.run pattern) - supporting Base64 obfuscation
        if (imageUrls.length === 0) {
            $('script').each((i, el) => {
                let content = $(el).html() || '';
                const srcValue = $(el).attr('src') || '';
                
                // Decode Base64 encoded scripts if present
                if (srcValue.includes('base64,')) {
                    try {
                        const parts = srcValue.split('base64,');
                        if (parts[1]) {
                            const decoded = Buffer.from(parts[1], 'base64').toString('utf-8');
                            if (decoded.includes('ts_reader')) {
                                content = decoded;
                            }
                        }
                    } catch (e) {}
                }

                if (content.includes('ts_reader.run')) {
                    const m = content.match(/ts_reader\.run\(([\s\S]+?)\);/);
                    if (m) {
                        try {
                            const data = JSON.parse(m[1]);
                            if (data.sources?.[0]?.images) {
                                imageUrls = data.sources[0].images;
                                console.log(`[API:ALT:READ] Method 2 (ts_reader) found ${imageUrls.length} images`);
                            }
                        } catch (e) {}
                    }
                }
            });
        }

        // 3. Fallback: Search for any manga-looking images in the body
        if (imageUrls.length === 0) {
             const fallbackRegex = /"([^"]+(?:cdn\.1668manga\.com|img\.168toon\.com)\/[^"]+\.(?:jpe?g|webp|png|avif)(?:\?[^"]*)?)"/gi;
             let fmatch;
             while ((fmatch = fallbackRegex.exec(html)) !== null) {
                 const s = fmatch[1].replace(/\\\//g, '/');
                 if (!s.includes('logo') && !s.includes('banner') && !s.includes('avatar') && !s.includes('cropped') && !s.includes('icon')) {
                     imageUrls.push(s);
                 }
             }
             if (imageUrls.length > 0) console.log(`[API:ALT:READ] Method 3 (Fallback) found ${imageUrls.length} images`);
        }

        imageUrls = [...new Set(imageUrls)].filter(s => s && s.startsWith('http') && !s.includes('logo-1668manga-png'));
        
        // Find Prev/Next
        const prevUrl = $('.ch-prev-btn, .nextprev a.prev').attr('href') || null;
        const nextUrl = $('.ch-next-btn, .nextprev a.next').attr('href') || null;

        res.json({ images: imageUrls, prevUrl, nextUrl });
    } catch (e) {
        console.error('[API:ALT:READ] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/alt/manga', async (req, res) => {
    let mangaUrl = req.query.url;
    if (!mangaUrl) return res.status(400).json({ error: 'No URL provided' });

    try {
        let html = await fetchHtml(mangaUrl);
        let $ = cheerio.load(html);

        // If this is actually a chapter page, find the manga link
        const titleText = $('.entry-title').text().trim();
        const hasInfotable = $('.infotable').length > 0;
        const hasReader = $('#readerarea').length > 0;

        if (hasReader || !hasInfotable || titleText.includes('ตอนที่') || titleText.includes('Chapter')) {
            const realMangaUrl = $('.allc a').attr('href') || $('.breadcrumb a[href*="/manga/"]').first().attr('href');
            if (realMangaUrl && realMangaUrl !== mangaUrl) {
                console.log(`[API:ALT:MANGA] Redirecting from chapter to manga: ${realMangaUrl}`);
                mangaUrl = realMangaUrl;
                html = await fetchHtml(mangaUrl);
                $ = cheerio.load(html);
            }
        }

        const title = $('.entry-title').text().trim() || $('h1.entry-title').text().trim();
        const imgEl = $('.thumb img').first();
        const image = imgEl.attr('data-src') || imgEl.attr('src');
        const description = $('.entry-content p').text().trim() || $('.description').text().trim();
        
        const info = {};
        $('.infotable tr').each((_, el) => {
            const label = $(el).find('td:first-child').text().replace(':', '').trim();
            const value = $(el).find('td:last-child').text().trim();
            if (label && value) info[label] = value;
        });

        const chapters = [];
        $('#chapterlist li').each((_, el) => {
            const a = $(el).find('a');
            const name = a.find('.chapternum').text().trim() || a.text().trim().replace(/\s+/g, ' ');
            const url = a.attr('href');
            const date = a.find('.chapterdate').text().trim();
            if (url) chapters.push({ name, url, date });
        });

        res.json({ title, image, description, info, chapters });
    } catch (e) {
        console.error('[API:ALT:MANGA] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/alt/home', async (req, res) => {
    try {
        const html = await fetchHtml(ALT_SITE);
        const $ = cheerio.load(html);
        const results = [];
        const seen = new Set();

        // 1. Popular (BS)
        $('.listupd .bs').each((_, el) => {
            const a = $(el).find('a').first();
            let url = a.attr('href');
            if (!url || seen.has(url)) return;
            seen.add(url);

            const title = a.attr('title') || $(el).find('.tt').text().trim();
            const imgEl = $(el).find('img');
            const image = imgEl.attr('data-src') || imgEl.attr('src');
            const lastChapter = $(el).find('.epxs').text().trim();
            
            results.push({ title, url, image, lastChapter, source: '1668manga' });
        });

        // 2. Latest Updates (UTAO)
        $('.listupd .utao').each((_, el) => {
            const mangaLink = $(el).find('.imgu a').attr('href') || $(el).find('a.series').attr('href');
            if (!mangaLink || seen.has(mangaLink)) return;
            seen.add(mangaLink);

            const title = $(el).find('h4').text().trim() || $(el).find('.imgu img').attr('title');
            const imgEl = $(el).find('img');
            const image = imgEl.attr('data-src') || imgEl.attr('src');
            const lastChapter = $(el).find('.luf ul li:first-child a').text().trim();

            results.push({ title, url: mangaLink, image, lastChapter, source: '1668manga' });
        });

        res.json({ updates: results });
    } catch (e) {
        console.error('[API:ALT:HOME] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// SPA Routing — serve index.html for any non-API path (fixes page refresh on /history, /bookmarks, etc.)
app.use((req, res, next) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/proxy')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        next();
    }
});

// ══════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════
app.listen(PORT, () => {
    console.log('══════════════════════════════════════════');
    console.log('🚀  SpeedManga — HTTP Engine v3 (No Puppeteer) 🚀');
    console.log(`   http://localhost:${PORT}`);
    console.log('══════════════════════════════════════════');
});