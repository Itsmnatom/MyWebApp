const cheerio = require('cheerio');
const fs = require('fs');
const html = fs.readFileSync('dump_home.html', 'utf8');
const $ = cheerio.load(html);

console.log('Total .bs items:', $('.listupd .bs').length);

$('.listupd .bs').each((i, el) => {
    const url = $(el).find('a').first().attr('href');
    const title = $(el).find('.tt').first().text().trim() || $(el).find('a').first().attr('title');
    
    // check chapters
    const chapters = [];
    $(el).find('.adds a').each((idx, a) => {
        if (idx >= 2) return;
        const chUrl = $(a).attr('href');
        const chName = $(a).find('.epxs').text().trim() || $(a).text().trim();
        if (chUrl && chName) chapters.push({ name: chName, url: chUrl });
    });
    
    console.log(`bs[${i}]: "${title}" -> chapters:`, chapters);
});
