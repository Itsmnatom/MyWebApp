import { gotScraping } from 'got-scraping';
import fs from 'fs';

async function test() {
    try {
        const url = 'https://1668manga.com/moon-shadow-sword-emperor-%e0%b8%95%e0%b8%ad%e0%b8%99%e0%b8%97%e0%b8%b5%e0%b9%88-85/';
        const res = await gotScraping(url);
        fs.writeFileSync('chapter_85.html', res.body);
        console.log('Saved chapter_85.html');
    } catch (e) {
        console.error(e.message);
    }
}
test();
