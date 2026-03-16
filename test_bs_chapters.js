const cheerio = require('cheerio');
const fs = require('fs');
const html = fs.readFileSync('dump_home.html', 'utf8');
const $ = cheerio.load(html);

// Inspect first .bs for chapters
const first = $('.listupd .bs').first();
console.log('First .bs HTML (full):\n', first.html()?.substring(0, 1200));

// Check chapter selectors
const chapSelectors = ['.lch ul li', '.cl ul li', '.list-chapter li', '.chapter-item', '.bsx li', '.extras li', 'ul li'];
console.log('\n--- Chapter Selectors ---');
for (const sel of chapSelectors) {
    const n = first.find(sel).length;
    if (n > 0) {
        console.log(`[${sel}] (${n}) ->`, first.find(sel).first().text().trim().substring(0, 60));
    }
}
