async function main() {
    const { gotScraping } = await import('got-scraping');
    const cheerio = require('cheerio');
    const fs = require('fs');
    
    console.log('Fetching with got-scraping...');
    const resp = await gotScraping.get({
        url: 'https://speed-manga.net/',
        headerGeneratorOptions: {
            browsers: [{ name: 'chrome', minVersion: 110 }],
            devices: ['desktop'],
            locales: ['th-TH', 'en-US'],
            operatingSystems: ['windows']
        },
        timeout: { request: 15000 }
    });
    
    console.log('Status:', resp.statusCode);
    console.log('Size:', resp.body.length);
    fs.writeFileSync('dump_gotscraping.html', resp.body);
    
    const $ = cheerio.load(resp.body);
    console.log('Items .listupd .bs:', $('.listupd .bs').length);
    console.log('Items .listupd .utao:', $('.listupd .utao').length);
    console.log('cloudflare block?', resp.body.includes('Just a moment') || resp.body.includes('Checking your browser'));
}

main().catch(e => console.error('Error:', e.message));
