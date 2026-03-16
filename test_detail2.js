const cheerio = require('cheerio');
const fs = require('fs');
const $ = cheerio.load(fs.readFileSync('dump_detail.html', 'utf8'));

// First chapter li structure
const li = $('#chapterlist ul li').first();
console.log('chapter li HTML:\n', li.html()?.substring(0, 500));

// Title check
console.log('\n=== TITLE ===');
console.log('.entry-title:', $('.entry-title').first().text().trim());
console.log('.postbody .bixbox h1:', $('.postbody .bixbox h1').first().text().trim());

// Image check
console.log('\n=== IMAGE ===');
const img = $('.thumb img').first();
console.log('src:', img.attr('src'));
console.log('data-src:', img.attr('data-src'));
console.log('data-cfsrc:', img.attr('data-cfsrc'));
