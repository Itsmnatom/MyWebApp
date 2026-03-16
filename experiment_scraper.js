/**
 * Experimental Scraper: Raw Regex Extraction
 * 
 * Goal: Minimize RAM by extracting data via regex from raw chunks, 
 * bypassing Cheerio/DOM parsing for the majority of the content.
 */

async function testExperimentalScraper(url) {
    const { gotScraping } = await import('got-scraping');
    console.log(`[EXP] Testing: ${url}`);
    const start = Date.now();
    
    try {
        const response = await gotScraping(url, {
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 115 }],
                devices: ['desktop'],
                operatingSystems: ['windows']
            },
            http2: true,
            timeout: { request: 30000 },
            retry: { limit: 1 }
        });

        const html = response.body;
        
        // 1. Precise Regex for ts_reader.run (Avoiding full DOM load)
        const configMatch = html.match(/ts_reader\.run\(\s*({[\s\S]+?})\s*\);/);
        
        if (configMatch) {
            const config = JSON.parse(configMatch[1]);
            const images = config.sources?.[0]?.images || [];
            console.log(`[EXP] Extracted ${images.length} images via JSON-Regex`);
            console.log(`[EXP] Duration: ${Date.now() - start}ms`);
            
            return {
                method: 'JSON_REGEX',
                count: images.length,
                time: Date.now() - start
            };
        }

        console.log(`[EXP] Failed to find JSON config, fallback needed.`);
        return { method: 'FAIL', time: Date.now() - start };

    } catch (e) {
        console.error(`[EXP] Error: ${e.message}`);
    }
}

// Test with Chapter 1
testExperimentalScraper('https://speed-manga.net/reality-quest-%e0%b8%95%e0%b8%ad%e0%b8%99%e0%b8%97%e0%b8%b5%e0%b9%88-1/');
