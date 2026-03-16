const cheerio = require('cheerio');
const fs = require('fs');
const html = fs.readFileSync('dump_home.html', 'utf8');
const $ = cheerio.load(html);

const first = $('.listupd .bs').first();
console.log('--- .adds ---');
console.log('.adds:', first.find('.adds').length, 'children:', first.find('.adds').html()?.substring(0, 400));
console.log('.adds a:', first.find('.adds a').length);
first.find('.adds a').each((i, a) => {
    console.log(`  a[${i}]: href=${$(a).attr('href')?.substring(0, 60)}, text="${$(a).text().trim()}"`);
});
