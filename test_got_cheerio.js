const cheerio = require('cheerio');
const got = require('got');

async function main() {
    const resp = await got('https://speed-manga.net/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0' }
    });
    const $ = cheerio.load(resp.body);
    console.log('size:', resp.body.length);
    console.log('.listupd .utao:', $('.listupd .utao').length);
    console.log('.listupd .bs:', $('.listupd .bs').length);
    
    const first = $('.listupd .utao').first();
    if (first.length) {
        const title = first.find('.tt').text().trim() || first.find('h3').text().trim();
        const url = first.find('a').first().attr('href');
        const img = first.find('img').attr('data-src') || first.find('img').attr('src');
        console.log('First item:', { title, url, img });
    }
}

main().catch(e => console.error('Error:', e.message));
