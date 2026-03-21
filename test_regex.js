
const example_script = `var post_id=136271;var chapter_id=136358;var readerVerified=false;var readerStarted=false;var turnstileToken='';var verifyInProgress=false;var readerConfig={"post_id":136358,"noimagehtml":"","prevUrl":"https:\\/\\/1668manga.com\\/moon-shadow-sword-emperor-%e0%b8%95%e0%b8%ad%e0%b8%99%e0%b8%97%e0%b8%b5%e0%b9%88-84\\/","nextUrl":"","mode":"full","sources":[{"source":"Server 1","images":["https:\\/\\/img.168toon.com\\/Manga\\/Moon-Shadow_Sword_Emperor\\/Moon-Shadow_Sword_Emperor_Chapter_85\\/0.jpg","https:\\/\\/img.168toon.com\\/Manga\\/Moon-Shadow_Sword_Emperor\\/Moon-Shadow_Sword_Emperor_Chapter_85\\/1.jpg"]}]}...`;

const regex = /readerConfig\s*=\s*({[\s\S]+?});/;
const m = example_script.match(regex);
if (m) {
    console.log('Match Found!');
    try {
        const data = JSON.parse(m[1]);
        console.log('Images length:', data.sources[0].images.length);
    } catch (e) {
        console.log('Parse error:', e.message);
    }
} else {
    console.log('No match');
}
