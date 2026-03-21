
const cheerio = require('cheerio');

async function dump_scripts(chapterUrl) {
    try {
        const { gotScraping } = await import('got-scraping');
        console.log(`Fetching Chapter: ${chapterUrl}...`);
        const response = await gotScraping(chapterUrl);
        const html = response.body;
        const $ = cheerio.load(html);
        
        console.log('--- Scripts Dump ---');
        $('script').each((i, el) => {
            const src = $(el).attr('src');
            const content = $(el).html();
            if (src) {
                console.log(`Script src: ${src}`);
            } else {
                console.log(`Inline script length: ${content.length}`);
                if (content.includes('images') || content.includes('data') || content.includes('render')) {
                    console.log(`Snippet: ${content.slice(0, 500)}...`);
                }
            }
        });

    } catch (e) { console.error(e.message); }
}

dump_scripts('https://1668manga.com/moon-shadow-sword-emperor-%e0%b8%95%e0%b8%ad%e0%b8%99%e0%b8%97%e0%b8%b5%e0%b9%88-85/');
