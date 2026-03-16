const cheerio = require('cheerio');
const fs = require('fs');
const html = fs.readFileSync('dump_home.html', 'utf8');
const $ = cheerio.load(html);

// Inspect first .utao
const first = $('.listupd .utao').first();
console.log('First .utao HTML snippet (500ch):', first.html()?.substring(0, 500));

console.log('\n--- title selectors ---');
const titleCandidates = ['h3', '.title', '.name', '.tt', 'a[title]', 'a'];
for (const sel of titleCandidates) {
    const v = first.find(sel).first().attr('title') || first.find(sel).first().text().trim();
    if (v) console.log(`  [${sel}]:`, v.substring(0, 60));
}

console.log('\n--- chapter selectors ---');
const chCandidates = ['.lch ul li', '.lch li', '.lastest a', '.luf ul li'];
for (const sel of chCandidates) {
    const n = first.find(sel).length;
    if (n > 0) {
        const txt = first.find(sel).first().find('a').text().trim();
        const url = first.find(sel).first().find('a').attr('href') || '';
        console.log(`  [${sel}] (${n} items): "${txt}" -> ${url.substring(0, 60)}`);
    }
}

// Inspect .bs items (popular/featured)
console.log('\n--- .bs (featured) items ---');
$('.listupd .bs').each((i, el) => {
    const url = $(el).find('a').first().attr('href') || '';
    const title = $(el).find('h3, .tt, .title').first().text().trim() || $(el).find('a').first().attr('title') || '';
    console.log(`  bs[${i}]: "${title.substring(0, 40)}" -> ${url.substring(0, 60)}`);
});
