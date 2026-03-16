const puppeteer = require('puppeteer');
const fs = require('fs');

const BASE = 'https://1668manga.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';

(async () => {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {} };
    });

    // intercept ทุก request/response รวมถึง body ที่ส่งไป
    const networkLog = [];
    await page.setRequestInterception(true);

    page.on('request', req => {
        const entry = {
            url: req.url(),
            method: req.method(),
            resourceType: req.resourceType(),
            postData: req.postData() || null,
        };
        // log ทุก XHR/fetch และ admin-ajax
        if (['xhr', 'fetch'].includes(req.resourceType()) || req.url().includes('ajax')) {
            networkLog.push(entry);
        }
        req.continue();
    });

    page.on('response', async resp => {
        const url = resp.url();
        if (['xhr', 'fetch'].includes(resp.request().resourceType()) || url.includes('ajax')) {
            const text = await resp.text().catch(() => '');
            const existing = networkLog.find(e => e.url === url);
            if (existing) existing.responseBody = text.slice(0, 500);
            else networkLog.push({ url, responseBody: text.slice(0, 500) });
        }
    });

    console.log('Loading...');
    await page.goto(`${BASE}/manga/the-regressed-mercenarys-machinations/`, {
        waitUntil: 'networkidle0', timeout: 45000
    });
    await new Promise(r => setTimeout(r, 3000));

    // ดึง HTML ส่วน chapter list โดยตรง
    const chapterSection = await page.evaluate(() => {
        // หา element ที่น่าจะเป็น chapter list
        const selectors = [
            '#chapterlist', '.chapter-list', '.eplister',
            '[class*="chapter"]', '[id*="chapter"]',
            '.ts-chl-collapsible-content', '.bixbox',
            'ul.clstyle', '.eplisterfull'
        ];
        const results = {};
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) results[sel] = el.outerHTML.slice(0, 1000);
        }
        // ดู body HTML ส่วน main content
        const main = document.querySelector('.mainholder, main, #content, .ts-cont');
        if (main) results['_mainHTML'] = main.innerHTML.slice(0, 3000);
        return results;
    });

    // ดู all classes ใน body ที่น่าสนใจ
    const allClasses = await page.evaluate(() => {
        const classes = new Set();
        document.querySelectorAll('[class]').forEach(el => {
            el.className.split(' ').forEach(c => {
                if (c && (c.includes('chapter') || c.includes('ep') || c.includes('list') ||
                    c.includes('ts-') || c.includes('series'))) {
                    classes.add(c);
                }
            });
        });
        return [...classes];
    });

    const out = { networkLog, chapterSection, allClasses };
    fs.writeFileSync('./debug_out2.json', JSON.stringify(out, null, 2));

    console.log('Network calls:', networkLog.length);
    console.log('Chapter selectors found:', Object.keys(chapterSection).filter(k => !k.startsWith('_')));
    console.log('Relevant classes:', allClasses);
    console.log('AJAX calls:');
    networkLog.forEach(n => {
        console.log(' URL:', n.url);
        console.log(' POST:', n.postData);
        console.log(' Response:', n.responseBody?.slice(0, 200));
        console.log('---');
    });

    await browser.close();
})();
