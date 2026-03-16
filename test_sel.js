const cheerio = require('cheerio');
const fs = require('fs');
const html = fs.readFileSync('dump_home.html', 'utf8');
const $ = cheerio.load(html);

const selectors = [
    '.slider__container .owl-item:not(.cloned) .page-item-detail',
    '.slider__container .page-item-detail',
    '.page-item-detail',
    '.page-content-listing .page-item-detail',
    '.listupd .utao',
    '.listupd .bs',
    '.uta',
    '.page-content-listing',
    '.listupd',
];

console.log('--- Selector Test ---');
for (const sel of selectors) {
    const n = $(sel).length;
    if (n > 0) {
        const first = $(sel).first();
        const url = first.find('a').first().attr('href') || '';
        const title = first.find('.post-title a, h3 a, .tt, .title, .name').first().attr('title') || first.find('.post-title, .tt, .title, h3, .name').first().text().trim() || '';
        console.log(`[${n}] "${sel}" -> ${title.substring(0, 40)} | ${url.substring(0, 60)}`);
    }
}
