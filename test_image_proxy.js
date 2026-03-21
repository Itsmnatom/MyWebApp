
const got = require('got');

async function test_image(imgUrl) {
    const referers = [
        'https://1668manga.com/',
        'https://img.168toon.com/'
    ];

    for (const ref of referers) {
        try {
            console.log(`Testing image with referer: ${ref}...`);
            const res = await got(imgUrl, {
                headers: {
                    'referer': ref,
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: { request: 5000 },
                https: { rejectUnauthorized: false }
            });
            console.log(`Success! Status: ${res.statusCode}, Content-Type: ${res.headers['content-type']}`);
        } catch (e) {
            console.log(`Failed! Status: ${e.response?.statusCode || 'ERROR'}, Msg: ${e.message}`);
        }
    }
}

test_image('https://img.168toon.com/Manga/Moon-Shadow_Sword_Emperor/Moon-Shadow_Sword_Emperor_Chapter_85/0.jpg');
