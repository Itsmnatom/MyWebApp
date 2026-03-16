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

    const ajaxLog = [];
    await page.setRequestInterception(true);
    page.on('request', req => req.continue());
    page.on('response', async resp => {
        const url = resp.url();
        if (url.includes('admin-ajax') || url.includes('ajax')) {
            const text = await resp.text().catch(() => '');
            ajaxLog.push({ url, status: resp.status(), bodyLen: text.length, body: text.slice(0, 300) });
        }
    });

    console.log('Loading page...');
    await page.goto(`${BASE}/manga/the-regressed-mercenarys-machinations/`, {
        waitUntil: 'networkidle0', timeout: 45000
    });
    await new Promise(r => setTimeout(r, 3000));

    const html = await page.content();
    const sections = [];
    html.split('\n').forEach((line, i) => {
        if (/chapter|ajax_url|nonce|manga_id|data-id/i.test(line)) {
            sections.push({ line: i, content: line.slice(0, 400) });
        }
    });

    const windowVars = await page.evaluate(() => {
        const result = {};
        for (const key of Object.keys(window)) {
            try {
                const val = window[key];
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                    const str = JSON.stringify(val);
                    if (str.length < 2000 && /nonce|ajax|chapter|manga/i.test(str)) {
                        result[key] = val;
                    }
                }
            } catch { }
        }
        return result;
    });

    const out = { htmlSections: sections.slice(0, 20), ajaxLog, windowVars };
    fs.writeFileSync('D:\\WebApp\\debug_out.json', JSON.stringify(out, null, 2));
    console.log('Done. ajaxCalls:', ajaxLog.length, 'htmlSections:', sections.length);
    console.log('windowVars keys:', Object.keys(windowVars));
    await browser.close();
})();