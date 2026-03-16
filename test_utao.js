const cheerio = require('cheerio');
const fs = require('fs');
const html = fs.readFileSync('dump_home.html', 'utf8');
const $ = cheerio.load(html);

// Inspect first .utao item
const first = $('.listupd .utao').first();
console.log('First .utao outer HTML:\n', first.html()?.substring(0, 800));

// Check chapter selectors for .utao
const chapSelectors = ['.lch ul li', '.lch li', '.adds a', '.eph-num a'];
console.log('\n--- .utao chapter selectors ---');
for (const sel of chapSelectors) {
    const n = first.find(sel).length;
    if (n > 0) {
        const t = first.find(sel).first().find('a').text().trim() || first.find(sel).first().text().trim();
        const u = first.find(sel).first().find('a').attr('href') || first.find(sel).first().attr('href') || '';
        console.log(`[${sel}] (${n}): "${t.substring(0,40)}" -> ${u.substring(0,60)}`);
    }
}
