
const example_script = `var post_id=136271;var chapter_id=136358;var readerVerified=false;var readerStarted=false;var turnstileToken='';var verifyInProgress=false;var readerConfig={"post_id":136358,"noimagehtml":"","prevUrl":"https:\\/\\/1668manga.com\\/moon-shadow-sword-emperor-%e0%b8%95%e0%b8%ad%e0%b8%99%e0%b8%97%e0%b8%b5%e0%b9%88-84\\/","nextUrl":"","mode":"full","sources":[{"source":"Server 1","images":["https:\\/\\/img.168toon.com\\/Manga\\/Moon-Shadow_Sword_Emperor\\/Moon-Shadow_Sword_Emperor_Chapter_85\\/0.jpg","https:\\/\\/img.168toon.com\\/Manga\\/Moon-Shadow_Sword_Emperor\\/Moon-Shadow_Sword_Emperor_Chapter_85\\/1.jpg"]}]};function startProtectedReader(){...}`;

// More robust patterns
const patterns = [
    /ts_reader\.run\(([\s\S]+?)\);/,
    /readerConfig\s*=\s*({[\s\S]+?});/
];

let imageUrls = [];
let prevUrl = null;
let nextUrl = null;

for (const rx of patterns) {
    const m = example_script.match(rx);
    if (m) {
        console.log('Match with pattern:', rx);
        try {
            const data = JSON.parse(m[1]);
            if (data.sources?.[0]?.images) imageUrls = data.sources[0].images;
            if (data.prevUrl) prevUrl = data.prevUrl;
            if (data.nextUrl) nextUrl = data.nextUrl;
            break;
        } catch (e) {
            console.log('Parse error:', e.message);
        }
    }
}

console.log('Extracted Images:', imageUrls.length);
console.log('Prev URL:', prevUrl);
