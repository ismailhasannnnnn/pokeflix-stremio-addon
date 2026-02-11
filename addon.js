const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const BASE_URL = 'https://www.pokeflix.tv';

// ==================== CACHING ====================
const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_MAX_SIZE = 500;

function getCached(key) {
    const item = cache.get(key);
    if (item && Date.now() - item.ts < CACHE_TTL) return item.data;
    cache.delete(key);
    return null;
}

function setCache(key, data) {
    // Evict oldest entries if cache is full
    if (cache.size >= CACHE_MAX_SIZE) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
    }
    cache.set(key, { data, ts: Date.now() });
    return data;
}

// ==================== CONCURRENCY ====================
const MAX_CONCURRENT_PAGES = 3;
let activePages = 0;
const pageQueue = [];

function acquirePage() {
    return new Promise(resolve => {
        if (activePages < MAX_CONCURRENT_PAGES) {
            activePages++;
            resolve();
        } else {
            pageQueue.push(resolve);
        }
    });
}

function releasePage() {
    activePages--;
    if (pageQueue.length > 0) {
        activePages++;
        pageQueue.shift()();
    }
}

// ==================== BROWSER (Cloudflare bypass) ====================
let browserInstance = null;
let browserLaunchPromise = null;

async function getBrowser() {
    if (browserInstance && browserInstance.isConnected()) return browserInstance;
    if (browserLaunchPromise) return browserLaunchPromise;
    browserLaunchPromise = (async () => {
        console.log('[Browser] Launching headless browser...');
        const launchOpts = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
            ],
        };
        // Use system Chromium in Docker (set via PUPPETEER_EXECUTABLE_PATH)
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }
        browserInstance = await puppeteer.launch(launchOpts);
        console.log('[Browser] Ready');
        browserLaunchPromise = null;
        return browserInstance;
    })();
    return browserLaunchPromise;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Create a configured browser page with common settings. */
async function createPage() {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 720 });
    return page;
}

/** Wait for Cloudflare challenge to finish. */
async function waitForCloudflare(page) {
    await page.waitForFunction(
        () => !document.title.includes('Just a moment'),
        { timeout: 20000 }
    ).catch(() => {});
}

async function fetchPage(path) {
    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
    const cacheKey = `page:${url}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    await acquirePage();
    let page;
    try {
        page = await createPage();

        // Block heavy resources — we only need HTML content
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log(`[Browse] Fetching ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await waitForCloudflare(page);

        const html = await page.content();
        await page.close();
        releasePage();

        if (html.includes('Just a moment')) {
            console.error(`[Browse] Cloudflare blocked: ${url}`);
            return null;
        }

        console.log(`[Browse] Got ${url} (${(html.length / 1024).toFixed(0)} KB)`);
        return setCache(cacheKey, html);
    } catch (err) {
        console.error(`[Browse Error] ${url}: ${err.message}`);
        if (page) await page.close().catch(() => {});
        releasePage();
        return null;
    }
}

function resolveUrl(url) {
    if (!url) return url;
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${BASE_URL}${url}`;
    return url;
}

// ==================== CONTENT DATA ====================

// All Pokémon anime seasons
const SERIES = [
    // Generation I
    { id: 'pokeflix-s01', num: 1, name: 'Pokémon: Indigo League', browse: 'pokemon-indigo-league', poster: `${BASE_URL}/static/season_logos/1.png`, gen: 'Generation I', desc: 'Follow Ash Ketchum, Misty and Brock on their adventure through the Kanto region. The classic series where it all began!' },
    { id: 'pokeflix-s02', num: 2, name: 'Pokémon: Orange Island Adventures', browse: 'pokemon-orange-islands', poster: `${BASE_URL}/static/season_logos/2.png`, gen: 'Generation I', desc: 'Ash, Misty and Tracey explore the Orange Archipelago.' },
    // Generation II
    { id: 'pokeflix-s03', num: 3, name: 'Pokémon: The Johto Journeys', browse: 'pokemon-johto-journeys', poster: `${BASE_URL}/static/season_logos/3.png`, gen: 'Generation II', desc: 'Ash, Misty and Brock journey through Johto from New Bark Town to Goldenrod City.' },
    { id: 'pokeflix-s04', num: 4, name: 'Pokémon: Johto League Champions', browse: 'pokemon-johto-league-champions', poster: `${BASE_URL}/static/season_logos/4.png`, gen: 'Generation II', desc: 'Adventures through Johto from Goldenrod City to Cianwood City.' },
    { id: 'pokeflix-s05', num: 5, name: 'Pokémon: Master Quest', browse: 'pokemon-master-quest', poster: `${BASE_URL}/static/season_logos/5.png`, gen: 'Generation II', desc: 'Adventures through Johto from Cianwood City to Mt. Silver.' },
    // Generation III
    { id: 'pokeflix-s06', num: 6, name: 'Pokémon: Advanced', browse: 'pokemon-advanced', poster: `${BASE_URL}/static/season_logos/6.png`, gen: 'Generation III', desc: 'Ash, May, Max and Brock begin their adventure through Hoenn.' },
    { id: 'pokeflix-s07', num: 7, name: 'Pokémon: Advanced Challenge', browse: 'pokemon-advanced-challenge', poster: `${BASE_URL}/static/season_logos/7.png`, gen: 'Generation III', desc: 'Continuing adventures through Hoenn from Mauville City to Lilycove City.' },
    { id: 'pokeflix-s08', num: 8, name: 'Pokémon: Advanced Battle', browse: 'pokemon-advanced-battle', poster: `${BASE_URL}/static/season_logos/8.png`, gen: 'Generation III', desc: 'Adventures through Hoenn to Ever Grande City and back to Kanto.' },
    { id: 'pokeflix-s09', num: 9, name: 'Pokémon: Battle Frontier', browse: 'pokemon-battle-frontier', poster: `${BASE_URL}/static/season_logos/9.png`, gen: 'Generation III', desc: "Adventures through Kanto's Battle Frontier." },
    // Generation IV
    { id: 'pokeflix-s10', num: 10, name: 'Pokémon: Diamond and Pearl', browse: 'pokemon-diamond-and-pearl', poster: `${BASE_URL}/static/season_logos/10.png`, gen: 'Generation IV', desc: 'Ash, Dawn and Brock begin their Sinnoh adventure.' },
    { id: 'pokeflix-s11', num: 11, name: 'Pokémon: DP Battle Dimension', browse: 'pokemon-dp-battle-dimension', poster: `${BASE_URL}/static/season_logos/11.png`, gen: 'Generation IV', desc: 'Sinnoh adventures from Solaceon Town to Hearthome City.' },
    { id: 'pokeflix-s12', num: 12, name: 'Pokémon: DP Galactic Battles', browse: 'pokemon-dp-galactic-battles', poster: `${BASE_URL}/static/season_logos/12.png`, gen: 'Generation IV', desc: 'Sinnoh adventures from Hearthome City to Sunyshore City.' },
    { id: 'pokeflix-s13', num: 13, name: 'Pokémon: DP Sinnoh League Victors', browse: 'pokemon-dp-sinnoh-league-victors', poster: `${BASE_URL}/static/season_logos/13.png`, gen: 'Generation IV', desc: 'The final stretch to the Sinnoh Pokémon League.' },
    // Generation V
    { id: 'pokeflix-s14', num: 14, name: 'Pokémon: Black & White', browse: 'pokemon-black-and-white', poster: `${BASE_URL}/static/season_logos/14.png`, gen: 'Generation V', desc: 'Ash, Iris and Cilan explore the Unova region.' },
    { id: 'pokeflix-s15', num: 15, name: 'Pokémon: BW Rival Destinies', browse: 'pokemon-bw-rival-destinies', poster: `${BASE_URL}/static/season_logos/15.png`, gen: 'Generation V', desc: 'Continuing adventures through Unova.' },
    { id: 'pokeflix-s16', num: 16, name: 'Pokémon: BW Adventures in Unova', browse: 'pokemon-bw-adventures-in-unova-and-beyond', poster: `${BASE_URL}/static/season_logos/16.png`, gen: 'Generation V', desc: 'The final season of the Best Wishes series.' },
    // Generation VI
    { id: 'pokeflix-s17', num: 17, name: 'Pokémon: XY', browse: 'pokemon-xy', poster: `${BASE_URL}/static/season_logos/17.png`, gen: 'Generation VI', desc: 'Ash ventures into Kalos with Clemont, Bonnie and Serena.' },
    { id: 'pokeflix-s18', num: 18, name: 'Pokémon: XY Kalos Quest', browse: 'pokemon-xy-kalos-quest', poster: `${BASE_URL}/static/season_logos/18.png`, gen: 'Generation VI', desc: 'More Kalos adventures and Mega Evolution mysteries.' },
    { id: 'pokeflix-s19', num: 19, name: 'Pokémon: XYZ', browse: 'pokemon-xyz', poster: `${BASE_URL}/static/season_logos/19.png`, gen: 'Generation VI', desc: 'The epic finale of the XY series.' },
    // Generation VII
    { id: 'pokeflix-s20', num: 20, name: 'Pokémon: Sun & Moon', browse: 'pokemon-sun-and-moon', poster: `${BASE_URL}/static/season_logos/20.png`, gen: 'Generation VII', desc: 'Ash attends a Pokémon school in the Alola region.' },
    { id: 'pokeflix-s21', num: 21, name: 'Pokémon: Sun & Moon Ultra Adventures', browse: 'pokemon-sun-and-moon-ultra-adventures', poster: `${BASE_URL}/static/season_logos/21.png`, gen: 'Generation VII', desc: 'Ultra Beast encounters in Alola.' },
    { id: 'pokeflix-s22', num: 22, name: 'Pokémon: Sun & Moon Ultra Legends', browse: 'pokemon-sun-and-moon-ultra-legends', poster: `${BASE_URL}/static/season_logos/22.png`, gen: 'Generation VII', desc: 'The final season of Sun & Moon.' },
    // Generation VIII
    { id: 'pokeflix-s23', num: 23, name: 'Pokémon Journeys', browse: 'pokemon-journeys', poster: `${BASE_URL}/static/season_logos/23.png`, gen: 'Generation VIII', desc: 'Ash and Goh travel the world researching Pokémon.' },
    { id: 'pokeflix-s24', num: 24, name: 'Pokémon Master Journeys', browse: 'pokemon-master-journeys', poster: `${BASE_URL}/static/season_logos/24.png`, gen: 'Generation VIII', desc: 'The Pokémon World Coronation Series intensifies!' },
    { id: 'pokeflix-s25', num: 25, name: 'Pokémon Ultimate Journeys', browse: 'pokemon-ultimate-journeys', poster: `${BASE_URL}/static/season_logos/25.png`, gen: 'Generation VIII', desc: "The grand finale of Ash's journey." },
    // Generation IX
    { id: 'pokeflix-s26', num: 26, name: 'Pokémon Horizons', browse: 'pokemon-horizons', poster: `${BASE_URL}/static/season_logos/26.png`, gen: 'Generation IX', desc: 'Liko, Roy and the Rising Volt Tacklers begin a new Pokémon adventure!' },
    { id: 'pokeflix-s27', num: 27, name: 'Pokémon Horizons: The Search for Laqua', browse: 'horizons-search-for-laqua', poster: `${BASE_URL}/static/season_logos/27.png`, gen: 'Generation IX', desc: 'The search for the Six Hero Pokémon and the legendary land of Laqua continues.' },
    { id: 'pokeflix-s28', num: 28, name: 'Pokémon Horizons: Rising Hope', browse: 'horizons-rising-hope', poster: `${BASE_URL}/static/season_logos/28.png`, gen: 'Generation IX', desc: 'A mysterious pink mist threatens Pokémon as the Rising Volt Tacklers return!' },
    // Specials - Mini-series
    { id: 'pokeflix-sp-origins', num: 100, name: 'Pokémon Origins', browse: 'pokemon-origins', poster: `${BASE_URL}/static/thumbnails/0-origins/1.jpg`, gen: 'Specials', desc: 'Follow Trainer Red on his journey through Kanto in this retelling of the original games.' },
    { id: 'pokeflix-sp-generations', num: 101, name: 'Pokémon Generations', browse: 'pokemon-generations', poster: `${BASE_URL}/static/thumbnails/0-generations/1.jpg`, gen: 'Specials', desc: 'Short episodes revisiting iconic moments from across all Pokémon generations.' },
    { id: 'pokeflix-sp-twilight', num: 102, name: 'Pokémon: Twilight Wings', browse: 'twilight-wings', poster: `${BASE_URL}/static/thumbnails/0-twilight-wings/1.jpg`, gen: 'Specials', desc: 'Short stories set in the Galar region.' },
    { id: 'pokeflix-sp-evolutions', num: 103, name: 'Pokémon Evolutions', browse: 'pokemon-evolutions', poster: `${BASE_URL}/static/thumbnails/0-evolutions/1.jpg`, gen: 'Specials', desc: 'Revisiting moments from across Pokémon history.' },
    { id: 'pokeflix-sp-hisuian', num: 104, name: 'Pokémon: Hisuian Snow', browse: 'hisuian-snow', poster: `${BASE_URL}/static/thumbnails/0-hisuian-snow/1.jpg`, gen: 'Specials', desc: 'A story set in the ancient Hisui region.' },
    { id: 'pokeflix-sp-paldean', num: 105, name: 'Pokémon: Paldean Winds', browse: 'paldean-winds', poster: `${BASE_URL}/static/thumbnails/0-paldean-winds/1.jpg`, gen: 'Specials', desc: 'Stories from students at a Paldean academy.' },
    { id: 'pokeflix-sp-mega', num: 106, name: 'Pokémon: Mega Evolution Specials', browse: 'pokemon-mega-evolution-special', poster: `${BASE_URL}/static/thumbnails/0-mega-evolution/1.jpg`, gen: 'Specials', desc: "Alain's journey to battle every Mega Evolution." },
    { id: 'pokeflix-sp-chronicles', num: 107, name: 'Pokémon Chronicles', browse: 'pokemon-chronicles', poster: `${BASE_URL}/static/thumbnails/0-chronicles/1.jpg`, gen: 'Specials', desc: 'Side stories featuring various Pokémon characters.' },
    { id: 'pokeflix-sp-mystery', num: 108, name: 'Pokémon Mystery Dungeon', browse: 'pokemon-mystery-dungeon', poster: `${BASE_URL}/static/thumbnails/0-mystery-dungeon/1.jpg`, gen: 'Specials', desc: 'Mystery Dungeon special episodes.' },
    { id: 'pokeflix-sp-pikachu', num: 109, name: 'Pikachu Shorts', browse: 'pokemon-pikachu-short', poster: `${BASE_URL}/static/thumbnails/0-pikachu-shorts/1.jpg`, gen: 'Specials', desc: 'Fun short adventures starring Pikachu and friends.' },
    { id: 'pokeflix-sp-specials', num: 110, name: 'Pokémon Specials', browse: 'pokemon-special', poster: `${BASE_URL}/static/thumbnails/0-specials/1.jpg`, gen: 'Specials', desc: 'Standalone Pokémon specials including Mewtwo Returns and more.' },
];

// All Pokémon movies
const MOVIES = [
    { id: 'pokeflix-m01', name: 'Pokémon: The First Movie - Mewtwo Strikes Back', slug: 'pokemon-movie-mewtwo-strikes-back', poster: `${BASE_URL}/static/thumbnails/movies/1.jpg`, year: 1998, desc: 'When Mewtwo, a powerful clone of Mew, seeks revenge, Ash and friends must stop its rampage.' },
    { id: 'pokeflix-m02', name: 'Pokémon: The Movie 2000 - The Power of One', slug: 'pokemon-movie-2000-power-of-one', poster: `${BASE_URL}/static/thumbnails/movies/2.jpg`, year: 1999, desc: 'Ash must save the world when a collector captures the Legendary birds.' },
    { id: 'pokeflix-m03', name: 'Pokémon 3: The Movie - Spell of the Unown', slug: 'pokemon-movie-3-spell-of-unown', poster: `${BASE_URL}/static/thumbnails/movies/3.jpg`, year: 2000, desc: 'Ash ventures into a crystal wasteland to rescue his mother from Entei and the Unown.' },
    { id: 'pokeflix-m04', name: 'Pokémon 4Ever: Celebi - Voice of the Forest', slug: 'pokemon-movie-4ever-celebi-voice-of-forest', poster: `${BASE_URL}/static/thumbnails/movies/4.jpg`, year: 2001, desc: 'Ash and friends protect the time-traveling Celebi from the Iron Masked Marauder.' },
    { id: 'pokeflix-m05', name: 'Pokémon Heroes: Latios & Latias', slug: 'pokemon-movie-heroes-laios-latias', poster: `${BASE_URL}/static/thumbnails/movies/5.jpg`, year: 2002, desc: 'Ash discovers the secret world of Latios and Latias in Alto Mare.' },
    { id: 'pokeflix-m06', name: 'Pokémon: Jirachi - Wish Maker', slug: 'pokemon-movie-jirachi-wishmaker', poster: `${BASE_URL}/static/thumbnails/movies/6.jpg`, year: 2003, desc: 'Max befriends the Mythical Pokémon Jirachi during the Millennium Festival.' },
    { id: 'pokeflix-m07', name: 'Pokémon: Destiny Deoxys', slug: 'pokemon-movie-destiny-deoxys', poster: `${BASE_URL}/static/thumbnails/movies/7.jpg`, year: 2004, desc: 'Deoxys and Rayquaza clash over Larousse City.' },
    { id: 'pokeflix-m08', name: 'Pokémon: Lucario and the Mystery of Mew', slug: 'pokemon-movie-lucario-mystery-of-mew', poster: `${BASE_URL}/static/thumbnails/movies/8.jpg`, year: 2005, desc: 'Ash and Lucario journey to the Tree of Life to rescue Pikachu and Mew.' },
    { id: 'pokeflix-m09', name: 'Pokémon Ranger and the Temple of the Sea', slug: 'pokemon-movie-ranger-temple-of-sea', poster: `${BASE_URL}/static/thumbnails/movies/9.jpg`, year: 2006, desc: 'Ash and friends race to find the Sea Temple before the pirate Phantom.' },
    { id: 'pokeflix-m10', name: 'Pokémon: The Rise of Darkrai', slug: 'pokemon-movie-rise-of-darkrai', poster: `${BASE_URL}/static/thumbnails/movies/10.jpg`, year: 2007, desc: 'Darkrai appears as Dialga and Palkia battle over Alamos Town.' },
    { id: 'pokeflix-m11', name: 'Pokémon: Giratina and the Sky Warrior', slug: 'pokemon-movie-giratina-sky-warrior', poster: `${BASE_URL}/static/thumbnails/movies/11.jpg`, year: 2008, desc: 'Ash helps Shaymin while Giratina battles in the Reverse World.' },
    { id: 'pokeflix-m12', name: 'Pokémon: Arceus and the Jewel of Life', slug: 'pokemon-movie-arceus-jewel-of-life', poster: `${BASE_URL}/static/thumbnails/movies/12.jpg`, year: 2009, desc: 'Ash travels through time to right an ancient wrong against Arceus.' },
    { id: 'pokeflix-m13', name: 'Pokémon: Zoroark - Master of Illusions', slug: 'pokemon-movie-zoroark-master-of-illusions', poster: `${BASE_URL}/static/thumbnails/movies/13.jpg`, year: 2010, desc: "Ash uncovers the truth behind Zoroark's rampage in Crown City." },
    { id: 'pokeflix-m14a', name: 'Pokémon The Movie: Black - Victini and Reshiram', slug: 'pokemon-movie-black-victini-reshiram', poster: `${BASE_URL}/static/thumbnails/movies/14.jpg`, year: 2011, desc: 'Ash and Victini team up with Reshiram to save the Kingdom of the Vale.' },
    { id: 'pokeflix-m14b', name: 'Pokémon The Movie: White - Victini and Zekrom', slug: 'pokemon-movie-white-victini-zekrom', poster: `${BASE_URL}/static/thumbnails/movies/14.jpg`, year: 2011, desc: 'Ash and Victini team up with Zekrom to save the Kingdom of the Vale.' },
    { id: 'pokeflix-m15', name: 'Pokémon the Movie: Kyurem VS. The Sword of Justice', slug: 'pokemon-movie-kyurem-vs-sword-of-justice', poster: `${BASE_URL}/static/thumbnails/movies/15.jpg`, year: 2012, desc: 'Ash helps Keldeo rescue the Swords of Justice from Kyurem.' },
    { id: 'pokeflix-m16', name: 'Pokémon the Movie: Genesect and the Legend Awakened', slug: 'pokemon-movie-genesect-legend-awakened', poster: `${BASE_URL}/static/thumbnails/movies/16.jpg`, year: 2013, desc: 'Mewtwo confronts a group of Genesect threatening the city.' },
    { id: 'pokeflix-m17', name: 'Pokémon the Movie: Diancie and the Cocoon of Destruction', slug: 'pokemon-movie-diancie-cocoon-of-destruction', poster: `${BASE_URL}/static/thumbnails/movies/17.jpg`, year: 2014, desc: 'Ash helps Diancie discover its true power while Yveltal awakens.' },
    { id: 'pokeflix-m18', name: 'Pokémon the Movie: Hoopa and the Clash of Ages', slug: 'pokemon-movie-hoopa-clash-of-ages', poster: `${BASE_URL}/static/thumbnails/movies/18.jpg`, year: 2015, desc: 'Ash helps Hoopa overcome the darkness within.' },
    { id: 'pokeflix-m19', name: 'Pokémon the Movie: Volcanion and the Mechanical Marvel', slug: 'pokemon-movie-volcanion-mechanical-marvel', poster: `${BASE_URL}/static/thumbnails/movies/19.jpg`, year: 2016, desc: 'Ash and Volcanion work together to rescue the Artificial Pokémon Magearna.' },
    { id: 'pokeflix-m20', name: 'Pokémon the Movie: I Choose You!', slug: 'pokemon-movie-2017-i-choose-you', poster: `${BASE_URL}/static/thumbnails/movies/20.jpg`, year: 2017, desc: 'A retelling of how Ash and Pikachu first met and began their journey.' },
    { id: 'pokeflix-m21', name: 'Pokémon the Movie: The Power of Us', slug: 'pokemon-movie-the-power-of-us', poster: `${BASE_URL}/static/thumbnails/movies/21.jpg`, year: 2018, desc: 'Ash and Pikachu journey to a seaside city and learn about teamwork.' },
    { id: 'pokeflix-m22', name: 'Pokémon: Mewtwo Strikes Back Evolution', slug: 'pokemon-movie-mewtwo-strikes-back-evolution', poster: `${BASE_URL}/static/thumbnails/movies/22.jpg`, year: 2019, desc: 'A CGI reimagining of the first Pokémon movie.' },
    { id: 'pokeflix-m23', name: 'Pokémon the Movie: Secrets of the Jungle', slug: 'pokemon-movie-secrets-of-jungle', poster: `${BASE_URL}/static/thumbnails/movies/23.jpg`, year: 2020, desc: 'Ash meets Koko, a boy raised by Zarude in the Forest of Okoya.' },
];

// ==================== SCRAPING ====================

// Stores video slug mapping: "seriesId:1:episodeNum" -> "video-slug"
const videoSlugMap = new Map();

/**
 * Scrape a browse page to get the episode list for a series.
 */
async function scrapeEpisodes(series) {
    const cacheKey = `episodes:${series.id}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const html = await fetchPage(`/browse/${series.browse}`);
    if (!html) return [];

    const $ = cheerio.load(html);
    const episodes = [];
    const seen = new Set();
    let autoNum = 0;

    // Find all links that go to /v/ video pages
    $('a[href*="/v/"]').each((i, el) => {
        const href = $(el).attr('href') || '';
        const slugMatch = href.match(/\/v\/(.+?)(?:\?|#|$)/);
        if (!slugMatch) return;

        const videoSlug = slugMatch[1];
        if (seen.has(videoSlug)) return;
        seen.add(videoSlug);

        // Walk up the DOM looking for a title (h4 or h3)
        let title = '';
        let container = $(el);
        for (let lvl = 0; lvl < 8; lvl++) {
            container = container.parent();
            if (!container.length) break;
            const heading = container.children('h4, h3').first();
            if (heading.length && heading.text().trim()) {
                title = heading.text().trim();
                break;
            }
        }

        // If still no title, try broader search in parent hierarchy
        if (!title) {
            container = $(el).parent();
            for (let lvl = 0; lvl < 6; lvl++) {
                const h4 = container.find('h4').first();
                if (h4.length && h4.text().trim()) {
                    title = h4.text().trim();
                    break;
                }
                container = container.parent();
                if (!container.length) break;
            }
        }

        // Extract episode number from "NN - Title" format
        let epNum = 0;
        let epTitle = title;
        const numMatch = title.match(/^(\d+)\s*[-–]\s*(.*)/);
        if (numMatch) {
            epNum = parseInt(numMatch[1]);
            epTitle = numMatch[2].trim();
        } else if (title) {
            // Check if the heading is just the series name (a section header, not a real title).
            // This happens when episodes appear in a "latest" or "recommended" section
            // whose parent heading is the series name.
            const seriesWords = series.name
                .toLowerCase()
                .replace(/pokémon|pokemon/gi, '')
                .replace(/[^a-z0-9\s]/g, '')
                .trim()
                .split(/\s+/)
                .filter(w => w.length > 2);
            const titleWords = title
                .toLowerCase()
                .replace(/pokémon|pokemon/gi, '')
                .replace(/[^a-z0-9\s]/g, '')
                .trim()
                .split(/\s+/)
                .filter(w => w.length > 2);
            const isSectionHeader = titleWords.length > 0 &&
                titleWords.every(w => seriesWords.includes(w));

            if (isSectionHeader) {
                // Derive a title from the video slug instead of discarding the episode
                // e.g. "01-friends-to-the-end" → "Friends to the End"
                const slugParts = videoSlug.replace(/^\d+-/, '').split('-');
                epTitle = slugParts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            }

            autoNum++;
            epNum = autoNum;
        } else {
            return; // Skip entries with no title
        }

        // Find thumbnail image
        let thumb = null;
        container = $(el).parent();
        for (let lvl = 0; lvl < 5; lvl++) {
            const img = container.find('img[src*="thumbnail"]').first();
            if (img.length) {
                thumb = img.attr('src');
                break;
            }
            container = container.parent();
            if (!container.length) break;
        }

        episodes.push({
            episode: epNum,
            title: epTitle,
            thumbnail: thumb ? resolveUrl(thumb) : null,
            videoSlug: videoSlug,
            _fromNumberedTitle: !!numMatch, // track origin for sorting
        });
    });

    // Post-process: any title that appears more than once is a section header, not a real title.
    // Replace those with slug-derived titles.
    const titleCounts = {};
    for (const ep of episodes) {
        titleCounts[ep.title] = (titleCounts[ep.title] || 0) + 1;
    }
    for (const ep of episodes) {
        if (titleCounts[ep.title] > 1) {
            const slugParts = ep.videoSlug.replace(/^\d+-/, '').split('-');
            ep.title = slugParts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }
    }

    // Separate properly numbered episodes from auto-numbered ones
    const numbered = episodes.filter(e => e._fromNumberedTitle);
    const unnumbered = episodes.filter(e => !e._fromNumberedTitle);

    // Sort numbered episodes by their extracted episode number
    numbered.sort((a, b) => a.episode - b.episode);

    // De-duplicate: remove unnumbered entries whose slug already appears in numbered
    const numberedSlugs = new Set(numbered.map(e => e.videoSlug));
    const uniqueUnnumbered = unnumbered.filter(e => !numberedSlugs.has(e.videoSlug));

    // Reverse unnumbered — they appear newest-first on the page but should be oldest-first
    uniqueUnnumbered.reverse();

    // Assign unnumbered episodes numbers after the last numbered episode
    const maxNum = numbered.length > 0 ? Math.max(...numbered.map(e => e.episode)) : 0;
    uniqueUnnumbered.forEach((ep, i) => {
        ep.episode = maxNum + i + 1;
    });

    // Combine: numbered first, then unnumbered at the end
    const allEpisodes = [...numbered, ...uniqueUnnumbered];

    // Fix any remaining duplicate episode numbers
    const epNums = new Set();
    let reassignCounter = 1;
    for (const ep of allEpisodes) {
        if (epNums.has(ep.episode) || ep.episode === 0) {
            while (epNums.has(reassignCounter)) reassignCounter++;
            ep.episode = reassignCounter;
        }
        epNums.add(ep.episode);
        reassignCounter = ep.episode + 1;
    }

    // Clean up internal tracking field
    allEpisodes.forEach(ep => delete ep._fromNumberedTitle);

    // Populate videoSlugMap for stream lookups
    allEpisodes.forEach(ep => {
        videoSlugMap.set(`${series.id}:1:${ep.episode}`, ep.videoSlug);
    });

    return setCache(cacheKey, allEpisodes);
}

/**
 * Scrape a video page to extract the direct stream URL.
 * Uses Puppeteer to intercept network requests for video files.
 * Resolves early as soon as a valid pkflx CDN URL is found,
 * then falls back to HTML parsing strategies.
 */
async function scrapeStreamUrl(videoSlug) {
    const cacheKey = `stream:${videoSlug}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const pageUrl = `${BASE_URL}/v/${videoSlug}`;
    await acquirePage();
    let page;

    try {
        page = await createPage();

        // Track intercepted video URLs and an early-resolve promise
        const videoUrls = [];
        let resolveEarly;
        const earlyFound = new Promise(r => { resolveEarly = r; });

        // Valid CDN domains for Pokéflix video content
        const CDN_PATTERN = /pkflx\.com/i;
        // Known ad domains to ignore
        const AD_DOMAINS = /2mdn\.net|doubleclick|googlesyndication|adservice|ads\.|pagead/i;

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            // Block images, media, fonts, stylesheets — we only need network interception
            if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        page.on('response', (res) => {
            const resUrl = res.url();
            // Skip ad domains
            if (AD_DOMAINS.test(resUrl)) return;

            if (/\.m3u8(\?|$)/i.test(resUrl) && CDN_PATTERN.test(resUrl)) {
                if (!videoUrls.includes(resUrl)) videoUrls.push(resUrl);
                console.log(`[Stream] Found HLS: ${resUrl}`);
                resolveEarly(resUrl); // we've got what we need
            } else if (/\.(mp4|webm)(\?|$)/i.test(resUrl) && CDN_PATTERN.test(resUrl)) {
                if (!videoUrls.includes(resUrl)) videoUrls.push(resUrl);
                console.log(`[Stream] Found video: ${resUrl}`);
            }
        });

        console.log(`[Stream] Loading ${pageUrl}`);

        // Race navigation against early HLS intercept — don't wait for full page load
        // if we already have the video URL from network interception
        const navigationDone = page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
            .then(() => waitForCloudflare(page))
            .then(() => null) // resolve with null so earlyFound wins the race
            .catch(() => null);

        // Wait for either: HLS URL intercepted OR page loaded + 6s grace period
        const pageTimeout = navigationDone.then(() => new Promise(r => setTimeout(() => r(null), 6000)));
        let earlyResult = await Promise.race([earlyFound, pageTimeout]);

        // If no early result, try clicking play and wait a bit more
        if (!earlyResult && videoUrls.length === 0) {
            try {
                await page.click('video, .play-btn, .vjs-big-play-button, [class*="play"], button[aria-label*="Play"]');
                const extraWait = new Promise(r => setTimeout(() => r(null), 3000));
                earlyResult = await Promise.race([earlyFound, extraWait]);
            } catch (_) {}
        }

        // Use intercepted URL if available
        if (earlyResult || videoUrls.length > 0) {
            const hlsUrl = videoUrls.find(u => u.includes('.m3u8'));
            const result = hlsUrl || videoUrls[0];
            console.log(`[Stream] Got via intercept: ${result}`);
            await page.close();
            releasePage();
            return setCache(cacheKey, result);
        }

        // Fall back to HTML parsing
        const html = await page.content();
        await page.close();
        releasePage();

        if (html.includes('Just a moment')) {
            console.error(`[Stream] Cloudflare blocked: ${pageUrl}`);
            return null;
        }

        const $ = cheerio.load(html);

        // Strategy 1: <video> or <source> tags
        let url = $('video source').attr('src') || $('video').attr('src');
        if (url) return setCache(cacheKey, resolveUrl(url));

        // Strategy 2: <iframe> embed (skip social/analytics iframes)
        $('iframe').each((i, el) => {
            const src = $(el).attr('src') || '';
            if (src && !/google|facebook|twitter|analytics/i.test(src)) {
                url = resolveUrl(src);
            }
        });
        if (url) return setCache(cacheKey, url);

        // Strategy 3: Search script contents for video URLs
        const scripts = [];
        $('script').each((i, el) => { const t = $(el).html(); if (t) scripts.push(t); });
        const allScripts = scripts.join('\n');

        // Look for HLS (.m3u8) streams
        for (const pattern of [
            /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*?)["']/,
            /(?:source|file|src|url)\s*[:=]\s*["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*?)["']/,
        ]) {
            const match = allScripts.match(pattern);
            if (match) return setCache(cacheKey, match[1]);
        }

        // Look for MP4 files
        for (const pattern of [
            /["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*?)["']/,
            /(?:source|file|src|url)\s*[:=]\s*["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*?)["']/,
        ]) {
            const match = allScripts.match(pattern);
            if (match) return setCache(cacheKey, match[1]);
        }

        // Strategy 4: data attributes
        const videoEl = $('[data-video-src], [data-src], [data-url], [data-file], [data-video]').first();
        if (videoEl.length) {
            url = videoEl.attr('data-video-src') || videoEl.attr('data-src') || videoEl.attr('data-url') || videoEl.attr('data-file') || videoEl.attr('data-video');
            if (url) return setCache(cacheKey, resolveUrl(url));
        }

        // Strategy 5: CDN-like video URLs in full HTML
        const cdnMatch = html.match(/["'](https?:\/\/[^"'\s]*(?:cdn|video|stream|media|pkflx)[^"'\s]*\.(?:mp4|m3u8|webm)[^"'\s]*?)["']/i);
        if (cdnMatch) return setCache(cacheKey, cdnMatch[1]);

        console.warn(`[Stream] No video URL found for ${videoSlug}`);
        return null;
    } catch (err) {
        console.error(`[Stream Error] ${videoSlug}: ${err.message}`);
        if (page) await page.close().catch(() => {});
        releasePage();
        return null;
    }
}

// ==================== STREMIO ADDON ====================

const builder = new addonBuilder({
    id: 'community.pokeflix',
    version: '1.0.0',
    name: 'Pokéflix',
    description: 'Watch Pokémon anime series, movies and specials from Pokéflix',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series', 'movie'],
    catalogs: [
        {
            type: 'series',
            id: 'pokeflix-series',
            name: 'Pokémon Series',
        },
        {
            type: 'movie',
            id: 'pokeflix-movies',
            name: 'Pokémon Movies',
        },
    ],
    idPrefixes: ['pokeflix-'],
    logo: 'https://www.pokeflix.tv/assets/images/logos/default_n.png',
});

// ----- CATALOG HANDLER -----
builder.defineCatalogHandler(async (args) => {
    console.log(`[Catalog] type=${args.type} id=${args.id}`);

    if (args.type === 'series' && args.id === 'pokeflix-series') {
        const metas = SERIES.map(s => ({
            id: s.id,
            type: 'series',
            name: s.name,
            poster: s.poster,
            description: s.desc,
            genres: [s.gen, 'Anime', 'Pokémon'],
        }));
        return { metas };
    }

    if (args.type === 'movie' && args.id === 'pokeflix-movies') {
        const metas = MOVIES.map(m => ({
            id: m.id,
            type: 'movie',
            name: m.name,
            poster: m.poster,
            description: m.desc,
            releaseInfo: m.year ? String(m.year) : undefined,
            genres: ['Anime', 'Pokémon', 'Movie'],
        }));
        return { metas };
    }

    return { metas: [] };
});

// ----- META HANDLER -----
builder.defineMetaHandler(async (args) => {
    console.log(`[Meta] type=${args.type} id=${args.id}`);

    // Series meta - scrape browse page for episodes
    const series = SERIES.find(s => s.id === args.id);
    if (series) {
        const episodes = await scrapeEpisodes(series);

        return {
            meta: {
                id: series.id,
                type: 'series',
                name: series.name,
                poster: series.poster,
                description: series.desc,
                genres: [series.gen, 'Anime', 'Pokémon'],
                videos: episodes.map(ep => ({
                    id: `${series.id}:1:${ep.episode}`,
                    title: ep.title,
                    season: 1,
                    episode: ep.episode,
                    thumbnail: ep.thumbnail,
                    released: new Date('2025-01-01').toISOString(),
                    overview: ep.title,
                })),
            },
        };
    }

    // Movie meta
    const movie = MOVIES.find(m => m.id === args.id);
    if (movie) {
        return {
            meta: {
                id: movie.id,
                type: 'movie',
                name: movie.name,
                poster: movie.poster,
                description: movie.desc,
                releaseInfo: movie.year ? String(movie.year) : undefined,
                genres: ['Anime', 'Pokémon', 'Movie'],
            },
        };
    }

    return { meta: {} };
});

// ----- STREAM HANDLER -----
builder.defineStreamHandler(async (args) => {
    console.log(`[Stream] type=${args.type} id=${args.id}`);

    let videoSlug = null;

    // Movie stream
    const movie = MOVIES.find(m => m.id === args.id);
    if (movie) {
        videoSlug = movie.slug;
    }

    // Series episode stream (format: seriesId:season:episode)
    if (!videoSlug && args.id.includes(':')) {
        const parts = args.id.split(':');
        const seriesId = parts[0];
        const episode = parseInt(parts[2]);

        // Check slug map first (populated by meta handler)
        videoSlug = videoSlugMap.get(args.id);

        // If not in map, scrape the browse page to populate it
        if (!videoSlug) {
            const series = SERIES.find(s => s.id === seriesId);
            if (series) {
                const episodes = await scrapeEpisodes(series);
                const ep = episodes.find(e => e.episode === episode);
                if (ep) videoSlug = ep.videoSlug;
            }
        }
    }

    const streams = [];

    if (videoSlug) {
        // Try to get direct video URL
        try {
            const directUrl = await scrapeStreamUrl(videoSlug);
            if (directUrl) {
                const isHls = directUrl.includes('.m3u8');
                if (isHls) {
                    // Primary: direct CDN URL — works with all native players (libVLC, AVPlayer, etc.)
                    // The pkflx CDN is publicly accessible, no Referer/auth needed
                    streams.push({
                        title: 'Pokéflix (HLS)',
                        url: directUrl,
                        behaviorHints: {
                            notWebReady: true,
                            bingeGroup: 'pokeflix',
                        },
                    });
                } else {
                    streams.push({
                        title: 'Pokéflix (Direct)',
                        url: directUrl,
                    });
                }
            }
        } catch (err) {
            console.error(`[Stream Error] ${videoSlug}: ${err.message}`);
        }

        // Always provide the website link as a fallback
        streams.push({
            title: 'Pokéflix (Open in Browser)',
            externalUrl: `${BASE_URL}/v/${videoSlug}`,
        });
    } else {
        console.warn(`[Stream] No video slug found for ${args.id}`);
    }

    return { streams };
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 7515;

const app = express();

// CORS headers
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Mount the Stremio addon routes
app.use(getRouter(builder.getInterface()));

app.listen(PORT, () => {
    console.log(`\n🎮 Pokéflix Stremio Addon running!\n📡 Server:   http://localhost:${PORT}\n📺 Manifest: http://localhost:${PORT}/manifest.json\n🔗 Install:  stremio://localhost:${PORT}/manifest.json\n`);
});

// Pre-launch browser so first request is faster
getBrowser().catch(err => console.error('[Browser] Failed to pre-launch:', err.message));

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[Shutdown] Closing browser...');
    if (browserInstance) await browserInstance.close().catch(() => {});
    process.exit(0);
});
process.on('SIGTERM', async () => {
    if (browserInstance) await browserInstance.close().catch(() => {});
    process.exit(0);
});