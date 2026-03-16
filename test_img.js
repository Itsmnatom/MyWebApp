const c = require('cheerio'), f = require('fs');
const $ = c.load(f.readFileSync('dump_detail.html', 'utf8'));

// Image candidates
const selectors = [
    '.seriestucon .seriestucont .thumb img',
    '.summary_image img',
    '.infox .thumb img',
    '.bigcontent .thumb img',
    '.ts-breadcrumb img',
    '.wd-full .summary_image img'
];
for (const s of selectors) {
    const v = $(s).first().attr('src') || $(s).first().attr('data-src');
    if (v) console.log(`[${s}]:`, v.substring(0, 80));
}

// Also dump all .thumb img
console.log('\nAll .thumb imgs:');
$('.thumb img').each((i, el) => {
    const s = $(el).attr('src') || $(el).attr('data-src') || '';
    const alt = $(el).attr('alt') || '';
    console.log(`  [${i}] alt="${alt.substring(0,30)}" src="${s.substring(0,70)}"`);
});
