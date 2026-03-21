
const cheerio = require('cheerio');

async function test(url) {
    try {
        const { gotScraping } = await import('got-scraping');
        console.log(`Fetching ${url} with got-scraping...`);
        const response = await gotScraping(url, {
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 115 }],
                devices: ['desktop'],
                operatingSystems: ['windows']
            },
            http2: true,
            timeout: { request: 30000 },
            retry: { limit: 1 }
        });
        
        const html = response.body;
        const $ = cheerio.load(html);
        
        console.log('--- Home Page Classes ---');
        console.log('Has .listupd?', $('.listupd').length);
        console.log('Has .bs?', $('.bs').length);
        console.log('Has .utao?', $('.utao').length);
        
        if ($('.listupd').length === 0) {
            console.log('No .listupd. Top-level container classes:');
            $('div').each((i, el) => {
                const cls = $(el).attr('class');
                if (cls && (cls.includes('manga') || cls.includes('list') || cls.includes('update'))) {
                     console.log('Class:', cls);
                }
            });
        }

        // Check for common manga card classes
        const cards = $('.bsx, .uta, .mangaListItem, .card-manga, .post-item');
        console.log('Found card candidates count:', cards.length);

    } catch (e) {
        console.error('Error:', e.message);
        if (e.response) {
            console.error('Status:', e.response.statusCode);
            console.error('Body snippet:', e.response.body.slice(0, 500));
        }
    }
}

test('https://1668manga.com/');
