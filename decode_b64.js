
const cheerio = require('cheerio');

async function test_decode_b64(chapterUrl) {
    try {
        const { gotScraping } = await import('got-scraping');
        console.log(`Fetching Chapter: ${chapterUrl}...`);
        const response = await gotScraping(chapterUrl);
        const html = response.body;
        const $ = cheerio.load(html);
        
        console.log('--- Decoded Base64 Scripts ---');
        $('script').each((i, el) => {
            const src = $(el).attr('src') || '';
            if (src.startsWith('data:text/javascript;base64,')) {
                const b64 = src.split('base64,')[1];
                const decoded = Buffer.from(b64, 'base64').toString('utf-8');
                console.log(`Decoded Script [length ${decoded.length}]:`);
                if (decoded.includes('ts_reader')) {
                    console.log('FOUND TS_READER!');
                    console.log(decoded);
                } else if (decoded.includes('images')) {
                    console.log('FOUND IMAGES keyword!');
                    console.log(decoded.slice(0, 1000));
                } else {
                    console.log(`Snippet: ${decoded.slice(0, 100)}...`);
                }
                console.log('----------------------------');
            }
        });

    } catch (e) { console.error(e.message); }
}

test_decode_b64('https://1668manga.com/moon-shadow-sword-emperor-%e0%b8%95%e0%b8%ad%e0%b8%99%e0%b8%97%e0%b8%b5%e0%b9%88-85/');

