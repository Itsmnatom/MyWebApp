async function main() {
    const { gotScraping } = await import('got-scraping');
    const cheerio = require('cheerio');
    const fs = require('fs');
    
    const resp = await gotScraping('https://speed-manga.net/manga/magic-emperor/', {
        headerGeneratorOptions: {
            browsers: [{ name: 'chrome', minVersion: 110 }],
            devices: ['desktop'],
            locales: ['th-TH', 'en-US'],
            operatingSystems: ['windows']
        },
        timeout: { request: 15000 }
    });
    
    fs.writeFileSync('dump_detail.html', resp.body);
    const $ = cheerio.load(resp.body);
    
    // Test selectors
    console.log('title candidates:');
    ['.post-title h1', '.entry-title', '.tt', 'h1', '.seriestuheadtitle h1', '.series-title h1'].forEach(s => {
        const t = $(s).first().text().trim();
        if (t) console.log(`  [${s}]:`, t.substring(0, 60));
    });
    
    console.log('\nimage candidates:');
    ['.summary_image img', '.thumb img', '.series-thumb img', '.cover img', '.seriestucon .seriestucont img'].forEach(s => {
        const v = $(s).first().attr('data-src') || $(s).first().attr('src');
        if (v) console.log(`  [${s}]:`, v.substring(0, 80));
    });
    
    console.log('\nchapter selectors:');
    ['#chapterlist ul li', '.eph-num', '.chapter-list li', '.ts-episode-list', '#chapterlist li'].forEach(s => {
        const n = $(s).length;
        if (n > 0) console.log(`  [${s}] = ${n} items, first:`, $(s).first().text().trim().substring(0, 60));
    });
}
main().catch(e => console.error(e.message));
