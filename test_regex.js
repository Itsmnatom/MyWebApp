const fs = require('fs');

const html = fs.readFileSync('dump_detail.html', 'utf8');

// The original regex from server.js details route
// const chBlocks = extractAll(html, /class="(?:wp-manga-chapter|eplister[^"]*|chapterlist[^"]*)[^>]*>([\s\S]*?)<\/li>/gi);

// Testing broader matches for chapters
const regexes = [
    { name: 'Original', rx: /class="(?:wp-manga-chapter|eplister[^"]*|chapterlist[^"]*)[^>]*>([\s\S]*?)<\/li>/gi },
    { name: 'Broad LI', rx: /<li[^>]*>([\s\S]*?)<\/li>/gi },
    { name: 'WPT', rx: /class="wpt[^"]*"[^>]*>([\s\S]*?)<\/div>/gi },
    { name: 'Chapter Item div', rx: /class="chapter-item[^"]*"[^>]*>([\s\S]*?)<\/div>(?=\s*<div class="chapter-item)/gi },
    { name: 'eph-num', rx: /class="eph-num"[^>]*>([\s\S]*?)<\/div>/gi },
    { name: 'chbox', rx: /class="chbox"[^>]*>([\s\S]*?)<\/div>/gi }
];

console.log('--- Testing Regex Extraction ---');
for (const entry of regexes) {
    let match;
    let count = 0;
    let sample = '';
    while ((match = entry.rx.exec(html)) !== null) {
        count++;
        if (count === 1) sample = match[1].replace(/\s+/g, ' ').trim().substring(0, 150);
    }
    console.log(`[${entry.name}]: Found ${count} items. Sample -> ${sample}`);
}
