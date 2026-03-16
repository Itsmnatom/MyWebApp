/**
 * SpeedManga - Backend Server (Extreme Regex Optimized v4)
 *
 * Improvements vs v3:
 *  1. Cheerio is completely removed. HTML is parsed via raw Regex.
 *  2. RAM usage should drop to ~15-20MB. Very safe for 512MB limits.
 *  3. V8 Garbage Collector flags added to package.json start script.
 *  4. Enforced Brotli/Gzip compression to minimize bandwidth string sizes.
 */

'use strict';

const express = require('express');
const cors = require('cors');
const got = require('got');
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
//  HTTP FETCH ENGINE (Got with Compression & Fake Headers)
// ══════════════════════════════════════════════════
async function fetchHTML(url) {
    try {
        const response = await got(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br' // Force compression
            },
            timeout: 10000,
            retry: 1
        });
        return response.body; // pure HTML string
    } catch (e) {
        throw new Error(`Failed to fetch ${url}: ${e.message}`);
    }
}

// ══════════════════════════════════════════════════
//  REGEX EXTRACTION HELPERS
// ══════════════════════════════════════════════════
function extractAttr(html, regex) {
    const m = html.match(regex);
    return m ? m[1].trim() : '';
}

function extractAll(html, regex) {
    const results = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        results.push(match[1]);
    }
    return results;
}

// ══════════════════════════════════════════════════
//  FILTER + SORT
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

app.get('/api/status', (_req, res) => res.json({
    status: 'online',
    engine: 'got-regex-extreme',
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
            const html = await fetchHTML(fetchUrl);
            
            // Extract Popular (only on page 1)
            // Look for blocks containing class="page-item-detail"
            if (page === 1) {
                const popularCached = CACHE.home.get('popular');
                if (popularCached) {
                    popular = popularCached;
                } else {
                    const popItems = [];
                    // Extract slider/popular section roughly
                    const sliderHtmlMatch = html.match(/class="(?:slider__container|popular-slider|owl-carousel)[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i);
                    const sliderHtml = sliderHtmlMatch ? sliderHtmlMatch[1] : '';

                    const itemRegex = /class="page-item-detail[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
                    const itemsH = extractAll(sliderHtml || html, itemRegex).slice(0, 30); // limit to search space
                    
                    for (const block of itemsH) {
                        const urlMatch = block.match(/href="([^"]+)"/);
                        if (!urlMatch) continue;
                        
                        const titleMatch = block.match(/title="([^"]+)"/) || block.match(/>([^<]+)<\/a>\s*<\/h3>/);
                        const imgMatch = block.match(/data-src="([^"]+)"/) || block.match(/data-lazy-src="([^"]+)"/) || block.match(/src="([^"]+)"/);
                        const badgeMatch = block.match(/class="(?:manga-title-badges|badge|type)[^>]*>([^<]+)/);
                        const chapterMatch = block.match(/class="(?:chapter|epxs)[^>]*>([^<]+)/);

                        popItems.push({
                            title: titleMatch ? titleMatch[1].trim() : '',
                            image: imgMatch ? imgMatch[1].trim() : '',
                            url: urlMatch[1],
                            badge: badgeMatch ? badgeMatch[1].trim() : '',
                            lastChapter: chapterMatch ? chapterMatch[1].trim() : 'Latest'
                        });
                    }
                    popular = filterAndSort(popItems).slice(0, 14);
                    CACHE.home.set('popular', popular, 10 * 60 * 1000);
                }
            }

            // Extract Updates
            if (!cachedUpdates) {
                const updItems = [];
                // Find all update items blocks
                const listBlocks = extractAll(html, /class="(?:page-item-detail|utao|bs|uta)[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi);
                
                for (const block of listBlocks) {
                    const urlMatch = block.match(/href="([^"]+)"/);
                    if (!urlMatch) continue;

                    const titleMatch = block.match(/title="([^"]+)"/) || block.match(/>([^<]+)<\/a>\s*<\/h3>/);
                    const imgMatch = block.match(/data-src="([^"]+)"/) || block.match(/data-lazy-src="([^"]+)"/) || block.match(/src="([^"]+)"/);
                    const badgeMatch = block.match(/class="(?:manga-title-badges|badge|type)[^>]*>([^<]+)/);
                    
                    const chapters = [];
                    const chBlocks = extractAll(block, /class="(?:chapter-item|chbox|eph-num)[^>]*>([\s\S]*?)<\/div>/gi);
                    
                    let count = 0;
                    for (const ch of chBlocks) {
                        if (count >= 2) break;
                        const cUrlMatch = ch.match(/href="([^"]+)"/);
                        const cNameMatch = ch.match(/>([^<]+)<\/a>/) || ch.match(/href="[^"]+">([^<]+)<\/a>/);
                        const cTimeMatch = ch.match(/class="(?:post-on|chapterdate|chapter-release-date)[^>]*>([^<]*)/);
                        
                        if (cUrlMatch) {
                            chapters.push({
                                name: cNameMatch ? cNameMatch[1].trim() : '',
                                url: cUrlMatch[1],
                                time: cTimeMatch ? cTimeMatch[1].trim() : 'NEW'
                            });
                            count++;
                        }
                    }

                    updItems.push({
                        title: titleMatch ? titleMatch[1].trim() : '',
                        image: imgMatch ? imgMatch[1].trim() : '',
                        url: urlMatch[1],
                        badge: badgeMatch ? badgeMatch[1].trim() : '',
                        chapters
                    });
                }
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
        const html = await fetchHTML(url);
        
        const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/class="(?:post-title|entry-title|tt)[^>]*>([^<]+)/i);
        const imgMatch = html.match(/class="(?:summary_image|thumb|series-thumb|cover)[^>]*>[\s\S]*?<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/i);
        const synopsisMatch = html.match(/class="(?:summary__content|manga-excerpt|desc|entry-content)[^>]*>([\s\S]*?)<\/div>/i);
        
        let synopsis = '';
        if (synopsisMatch) {
            synopsis = synopsisMatch[1].replace(/<[^>]+>/g, '').trim(); // Remove inner HTML tags
        }

        const info = {};
        const infoBlocks = extractAll(html, /class="post-content_item[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi);
        for (const block of infoBlocks) {
            const labelM = block.match(/<h5[^>]*>([^<]+)<\/h5>/);
            const valM = block.match(/class="summary-content[^>]*>([\s\S]*?)<\/div>/);
            if (labelM && valM) {
                const label = labelM[1].replace(':', '').trim();
                const value = valM[1].replace(/<[^>]+>/g, '').trim();
                if (label && value) info[label] = value;
            }
        }

        const chapters = [];
        const chBlocks = extractAll(html, /class="(?:wp-manga-chapter|eplister[^"]*|chapterlist[^"]*)[^>]*>([\s\S]*?)<\/li>/gi);
        for (const ch of chBlocks) {
            const cUrlM = ch.match(/href="([^"]+)"/);
            const cNameM = ch.match(/href="[^"]+">([^<]+)<\/a>/);
            const cTimeM = ch.match(/class="(?:chapter-release-date|chapterdate)[^>]*>([^<]*)/) || ch.match(/<i>([^<]+)<\/i>/);
            if (cUrlM) {
                chapters.push({
                    name: cNameM ? cNameM[1].trim() : '',
                    url: cUrlM[1],
                    time: cTimeM ? cTimeM[1].trim() : ''
                });
            }
        }

        const data = { 
            title: titleMatch ? titleMatch[1].trim() : '', 
            image: imgMatch ? imgMatch[1].trim() : '', 
            synopsis, 
            info, 
            chapters 
        };
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
        const html = await fetchHTML(chapterUrl);

        const prevMatch = html.match(/class="(?:prev_page|nav-previous)[^>]*href="([^"]+)"/) || html.match(/href="([^"]+)"[^>]*rel="prev"/);
        const nextMatch = html.match(/class="(?:next_page|nav-next)[^>]*href="([^"]+)"/) || html.match(/href="([^"]+)"[^>]*rel="next"/);

        let imageUrls = [];

        // Parse JSON Blocks
        const m1 = html.match(/"images"\s*:\s*(\[[^\]]+\])/);
        const m2 = html.match(/ts_reader\.run\(\s*(\{[\s\S]+?\})\s*\)/);
        
        if (m1) {
            try { imageUrls = JSON.parse(m1[1]).map(u => u.replace(/\\\//g, '/').trim()); } catch (e) {}
        } else if (m2) {
            try {
                const obj = JSON.parse(m2[1]);
                const src = obj.sources?.[0];
                if (src?.images) imageUrls = src.images;
            } catch (e) {}
        }

        // Fallback to DOM elements
        if (imageUrls.length === 0) {
            const imgBlocks = extractAll(html, /<img[^>]+class="(?:wp-manga-chapter-img|size-full)[^"]*"[^>]+>/gi)
                              .concat(extractAll(html, /<img[^>]+id="image-[^"]*"[^>]+>/gi));
            
            for (const img of imgBlocks) {
                const srcM = img.match(/data-src="([^"]+)"/) || img.match(/data-lazy-src="([^"]+)"/) || img.match(/src="([^"]+)"/);
                if (srcM) imageUrls.push(srcM[1].trim());
            }
        }

        // Filter valid mangapages
        imageUrls = [...new Set(imageUrls)].filter(
            s => s && s.startsWith('http')
                && !s.includes('/logo') && !s.includes('/banner')
                && /\.(jpe?g|png|webp|gif)/i.test(s)
        );

        const data = { 
            images: imageUrls, 
            prevUrl: prevMatch ? prevMatch[1] : null, 
            nextUrl: nextMatch ? nextMatch[1] : null 
        };
        CACHE.read.set(chapterUrl, data, 60 * 60 * 1000);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
    console.log('══════════════════════════════════════════');
    console.log('🚀  SpeedManga — Regex Micro API v4   🚀');
    console.log(`   http://localhost:${PORT}`);
    console.log('   (Extreme Memory Fix: ~20MB RAM)');
    console.log('══════════════════════════════════════════');
});