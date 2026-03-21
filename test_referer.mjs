import { gotScraping } from 'got-scraping';
import fs from 'fs';

async function test() {
    const url = 'https://img.168toon.com/Manga/Moon-Shadow_Sword_Emperor/Moon-Shadow_Sword_Emperor_Chapter_85/0.jpg';
    const referers = [
        'https://1668manga.com/',
        'https://img.168toon.com/',
        '',
        'https://1668manga.com/moon-shadow-sword-emperor-%e0%b8%95%e0%b8%ad%e0%b8%99%e0%b8%97%e0%b8%b5%e0%b9%88-85/'
    ];

    for (const ref of referers) {
        try {
            console.log(`Testing referer: [${ref}]`);
            const options = {
                headers: ref ? { 'referer': ref } : {},
                responseType: 'buffer'
            };
            const res = await gotScraping(url, options);
            console.log(`  SUCCESS! Size: ${res.body.length}`);
            fs.writeFileSync('test_img.jpg', res.body);
            return;
        } catch (e) {
            console.log(`  FAILED: ${e.message} ${e.response?.statusCode || ''}`);
        }
    }
}
test();
