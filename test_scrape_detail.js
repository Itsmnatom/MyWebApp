
const cheerio = require('cheerio');

async function test_read_manga(mangaUrl) {
    try {
        const { gotScraping } = await import('got-scraping');
        console.log(`Fetching Manga Detail: ${mangaUrl}...`);
        const response = await gotScraping(mangaUrl);
        const html = response.body;
        const $ = cheerio.load(html);
        
        console.log('Title:', $('.entry-title').text().trim());
        const chapters = [];
        $('#chapterlist li a').each((i, el) => {
             chapters.push({ name: $(el).find('.chapternum').text().trim(), url: $(el).attr('href') });
        });
        
        console.log('Found', chapters.length, 'chapters.');
        if (chapters.length > 0) {
             const chUrl = chapters[0].url;
             console.log(`Fetching Chapter: ${chUrl}...`);
             const respCh = await gotScraping(chUrl);
             const chHtml = respCh.body;
             
             console.log('Checking for ts_reader in chapter source...');
             console.log('Contains ts_reader.run?', chHtml.includes('ts_reader.run'));
             
             const mConfig = chHtml.match(/ts_reader\.run\(\s*({[\s\S]+?})\s*\);/);
             if (mConfig) {
                 console.log('Found ts_reader config!');
                 try {
                     const cfg = JSON.parse(mConfig[1]);
                     console.log('Images count:', cfg.sources?.[0]?.images?.length || 0);
                     if (cfg.sources?.[0]?.images) {
                         console.log('First image sample:', cfg.sources[0].images[0]);
                     }
                 } catch (e) {
                     console.error('JSON Parse Error for ts_reader!');
                 }
             } else {
                 console.warn('ts_reader.run NOT FOUND in source!');
                 // Try looking for images directly
                 const $ch = cheerio.load(chHtml);
                 const imageCount = $ch('#readerarea img').length;
                 console.log('Direct #readerarea img count:', imageCount);
                 if (imageCount > 0) {
                      console.log('First image sample:', $ch('#readerarea img').first().attr('src') || $ch('#readerarea img').first().attr('data-src'));
                 }
             }
        }

    } catch (e) {
        console.error('Error:', e.message);
    }
}

// First, get a manga link from home
async function find_sample() {
    const { gotScraping } = await import('got-scraping');
    const response = await gotScraping('https://1668manga.com/');
    const $ = cheerio.load(response.body);
    const mangaUrl = $('.listupd .bs a').first().attr('href') || $('.listupd .utao a').first().attr('href');
    if (mangaUrl) {
        test_read_manga(mangaUrl);
    } else {
        console.log('No manga URL found on home page');
    }
}

find_sample();
