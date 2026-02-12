const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const https = require('https');

const BASE_URL = 'https://www.pokeflix.tv';
const CDN_BASE = 'https://v1.pkflx.com/hls';

// Detected from incoming requests (updated dynamically)
let serverUrl = `http://localhost:${process.env.PORT || 7515}`;

// ==================== CONTENT DATA ====================

// CDN slug, episode count, and metadata for each season
const SERIES = [
    // Generation I — TVMaze show 590, seasons match our numbering
    { id: 'pokeflix-s01', num: 1, name: 'Pokémon: Indigo League', cdn: '01-indigo-league', episodes: 82, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68364.jpg', gen: 'Generation I', desc: 'Follow Ash Ketchum, Misty and Brock on their adventure through the Kanto region. The classic series where it all began!' },
    { id: 'pokeflix-s02', num: 2, name: 'Pokémon: Orange Island Adventures', cdn: '02-orange-islands', episodes: 36, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68365.jpg', gen: 'Generation I', desc: 'Ash, Misty and Tracey explore the Orange Archipelago.' },
    // Generation II
    { id: 'pokeflix-s03', num: 3, name: 'Pokémon: The Johto Journeys', cdn: '03-johto-journeys', episodes: 41, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68366.jpg', gen: 'Generation II', desc: 'Ash, Misty and Brock journey through Johto from New Bark Town to Goldenrod City.' },
    { id: 'pokeflix-s04', num: 4, name: 'Pokémon: Johto League Champions', cdn: '04-johto-league', episodes: 52, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68367.jpg', gen: 'Generation II', desc: 'Adventures through Johto from Goldenrod City to Cianwood City.' },
    { id: 'pokeflix-s05', num: 5, name: 'Pokémon: Master Quest', cdn: '05-master-quest', episodes: 65, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68368.jpg', gen: 'Generation II', desc: 'Adventures through Johto from Cianwood City to Mt. Silver.' },
    // Generation III
    { id: 'pokeflix-s06', num: 6, name: 'Pokémon: Advanced', cdn: '06-advanced', episodes: 40, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68369.jpg', gen: 'Generation III', desc: 'Ash, May, Max and Brock begin their adventure through Hoenn.' },
    { id: 'pokeflix-s07', num: 7, name: 'Pokémon: Advanced Challenge', cdn: '07-advanced-challenge', episodes: 52, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68370.jpg', gen: 'Generation III', desc: 'Continuing adventures through Hoenn from Mauville City to Lilycove City.' },
    { id: 'pokeflix-s08', num: 8, name: 'Pokémon: Advanced Battle', cdn: '08-advanced-battle', episodes: 53, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68371.jpg', gen: 'Generation III', desc: 'Adventures through Hoenn to Ever Grande City and back to Kanto.' },
    { id: 'pokeflix-s09', num: 9, name: 'Pokémon: Battle Frontier', cdn: '09-battle-frontier', episodes: 47, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68373.jpg', gen: 'Generation III', desc: "Adventures through Kanto's Battle Frontier." },
    // Generation IV
    { id: 'pokeflix-s10', num: 10, name: 'Pokémon: Diamond and Pearl', cdn: '10-diamond-pearl', episodes: 51, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68374.jpg', gen: 'Generation IV', desc: 'Ash, Dawn and Brock begin their Sinnoh adventure.' },
    { id: 'pokeflix-s11', num: 11, name: 'Pokémon: DP Battle Dimension', cdn: '11-dp-battle-dimension', episodes: 52, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68375.jpg', gen: 'Generation IV', desc: 'Sinnoh adventures from Solaceon Town to Hearthome City.' },
    { id: 'pokeflix-s12', num: 12, name: 'Pokémon: DP Galactic Battles', cdn: '12-dp-galactic-battles', episodes: 53, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68376.jpg', gen: 'Generation IV', desc: 'Sinnoh adventures from Hearthome City to Sunyshore City.' },
    { id: 'pokeflix-s13', num: 13, name: 'Pokémon: DP Sinnoh League Victors', cdn: '13-dp-sinnoh-league', episodes: 34, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68377.jpg', gen: 'Generation IV', desc: 'The final stretch to the Sinnoh Pokémon League.' },
    // Generation V
    { id: 'pokeflix-s14', num: 14, name: 'Pokémon: Black & White', cdn: '14-black-white', episodes: 48, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68378.jpg', gen: 'Generation V', desc: 'Ash, Iris and Cilan explore the Unova region.' },
    { id: 'pokeflix-s15', num: 15, name: 'Pokémon: BW Rival Destinies', cdn: '15-bw-rival-destinies', episodes: 49, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/27/68380.jpg', gen: 'Generation V', desc: 'Continuing adventures through Unova.' },
    { id: 'pokeflix-s16', num: 16, name: 'Pokémon: BW Adventures in Unova', cdn: '16-bw-adventures-in-unova', episodes: 45, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/189/473990.jpg', gen: 'Generation V', desc: 'The final season of the Best Wishes series.' },
    // Generation VI
    { id: 'pokeflix-s17', num: 17, name: 'Pokémon: XY', cdn: '17-xy', episodes: 48, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/189/473991.jpg', gen: 'Generation VI', desc: 'Ash ventures into Kalos with Clemont, Bonnie and Serena.' },
    { id: 'pokeflix-s18', num: 18, name: 'Pokémon: XY Kalos Quest', cdn: '18-xy-kalos-quest', episodes: 45, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/418/1045274.jpg', gen: 'Generation VI', desc: 'More Kalos adventures and Mega Evolution mysteries.' },
    { id: 'pokeflix-s19', num: 19, name: 'Pokémon: XYZ', cdn: '19-xyz', episodes: 48, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/189/473994.jpg', gen: 'Generation VI', desc: 'The epic finale of the XY series.' },
    // Generation VII
    { id: 'pokeflix-s20', num: 20, name: 'Pokémon: Sun & Moon', cdn: '20-sun-moon', episodes: 43, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/174/436431.jpg', gen: 'Generation VII', desc: 'Ash attends a Pokémon school in the Alola region.' },
    { id: 'pokeflix-s21', num: 21, name: 'Pokémon: Sun & Moon Ultra Adventures', cdn: '21-sun-moon-ultra-adventures', episodes: 49, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/174/436432.jpg', gen: 'Generation VII', desc: 'Ultra Beast encounters in Alola.' },
    { id: 'pokeflix-s22', num: 22, name: 'Pokémon: Sun & Moon Ultra Legends', cdn: '22-sun-moon-ultra-legends', episodes: 54, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/334/836445.jpg', gen: 'Generation VII', desc: 'The final season of Sun & Moon.' },
    // Generation VIII
    { id: 'pokeflix-s23', num: 23, name: 'Pokémon Journeys', cdn: '23-journeys', episodes: 48, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/334/836446.jpg', gen: 'Generation VIII', desc: 'Ash and Goh travel the world researching Pokémon.' },
    { id: 'pokeflix-s24', num: 24, name: 'Pokémon Master Journeys', cdn: '24-master-journeys', episodes: 42, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/418/1045272.jpg', gen: 'Generation VIII', desc: 'The Pokémon World Coronation Series intensifies!' },
    { id: 'pokeflix-s25', num: 25, name: 'Pokémon Ultimate Journeys', cdn: '25-ultimate-journeys', episodes: 53, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/418/1045273.jpg', gen: 'Generation VIII', desc: "The grand finale of Ash's journey." },
    // Generation IX
    { id: 'pokeflix-s26', num: 26, name: 'Pokémon Horizons', cdn: '26-horizons', episodes: 45, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/459/1148947.jpg', gen: 'Generation IX', desc: 'Liko, Roy and the Rising Volt Tacklers begin a new Pokémon adventure!' },
    { id: 'pokeflix-s27', num: 27, name: 'Pokémon Horizons: The Search for Laqua', cdn: '27-horizons-search-for-laqua', episodes: 44, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/459/1148947.jpg', gen: 'Generation IX', desc: 'The search for the Six Hero Pokémon and the legendary land of Laqua continues.' },
    { id: 'pokeflix-s28', num: 28, name: 'Pokémon Horizons: Rising Hope', cdn: '28-horizons-rising-hope', episodes: 12, poster: 'https://static.tvmaze.com/uploads/images/original_untouched/459/1148947.jpg', gen: 'Generation IX', desc: 'A mysterious pink mist threatens Pokémon as the Rising Volt Tacklers return!' },
    // Specials - Mini-series (separate TVMaze shows)
    { id: 'pokeflix-sp-origins', num: 100, name: 'Pokémon Origins', cdn: '0-origins', episodes: 4, poster: `${BASE_URL}/static/thumbnails/0-origins/1.jpg`, gen: 'Specials', desc: 'Follow Trainer Red on his journey through Kanto in this retelling of the original games.' },
    { id: 'pokeflix-sp-generations', num: 101, name: 'Pokémon Generations', cdn: '0-generations', episodes: 18, poster: `${BASE_URL}/static/thumbnails/0-generations/1.jpg`, gen: 'Specials', desc: 'Short episodes revisiting iconic moments from across all Pokémon generations.' },
    { id: 'pokeflix-sp-twilight', num: 102, name: 'Pokémon: Twilight Wings', cdn: '0-twilight-wings', episodes: 8, poster: `${BASE_URL}/static/thumbnails/0-twilight-wings/1.jpg`, gen: 'Specials', desc: 'Short stories set in the Galar region.' },
    { id: 'pokeflix-sp-evolutions', num: 103, name: 'Pokémon Evolutions', cdn: '0-evolutions', episodes: 8, poster: `${BASE_URL}/static/thumbnails/0-evolutions/1.jpg`, gen: 'Specials', desc: 'Revisiting moments from across Pokémon history.' },
    { id: 'pokeflix-sp-hisuian', num: 104, name: 'Pokémon: Hisuian Snow', cdn: '0-hisuian-snow', episodes: 3, poster: `${BASE_URL}/static/thumbnails/0-hisuian-snow/1.jpg`, gen: 'Specials', desc: 'A story set in the ancient Hisui region.' },
    { id: 'pokeflix-sp-paldean', num: 105, name: 'Pokémon: Paldean Winds', cdn: '0-paldean-winds', episodes: 4, poster: `${BASE_URL}/static/thumbnails/0-paldean-winds/1.jpg`, gen: 'Specials', desc: 'Stories from students at a Paldean academy.' },
    { id: 'pokeflix-sp-mega', num: 106, name: 'Pokémon: Mega Evolution Specials', cdn: '0-mega-evolution', episodes: 4, poster: `${BASE_URL}/static/thumbnails/0-mega-evolution/1.jpg`, gen: 'Specials', desc: "Alain's journey to battle every Mega Evolution." },
    { id: 'pokeflix-sp-chronicles', num: 107, name: 'Pokémon Chronicles', cdn: '0-chronicles', episodes: 22, poster: `${BASE_URL}/static/thumbnails/0-chronicles/1.jpg`, gen: 'Specials', desc: 'Side stories featuring various Pokémon characters.' },
    { id: 'pokeflix-sp-mystery', num: 108, name: 'Pokémon Mystery Dungeon', cdn: '0-mystery-dungeon', episodes: 5, poster: `${BASE_URL}/static/thumbnails/0-mystery-dungeon/1.jpg`, gen: 'Specials', desc: 'Mystery Dungeon special episodes.' },
    { id: 'pokeflix-sp-pikachu', num: 109, name: 'Pikachu Shorts', cdn: '0-pikachu-shorts', episodes: 21, poster: `${BASE_URL}/static/thumbnails/0-pikachu-shorts/1.jpg`, gen: 'Specials', desc: 'Fun short adventures starring Pikachu and friends.' },
    { id: 'pokeflix-sp-specials', num: 110, name: 'Pokémon Specials', cdn: '0-specials', episodes: 23, poster: `${BASE_URL}/static/thumbnails/0-specials/1.jpg`, gen: 'Specials', desc: 'Standalone Pokémon specials including Mewtwo Returns and more.' },
];

// All Pokémon movies
const MOVIES = [
    { id: 'pokeflix-m01', name: 'Pokémon: The First Movie - Mewtwo Strikes Back', cdnPath: 'movies/01', poster: `${BASE_URL}/static/thumbnails/movies/1.jpg`, year: 1998, desc: 'When Mewtwo, a powerful clone of Mew, seeks revenge, Ash and friends must stop its rampage.' },
    { id: 'pokeflix-m02', name: 'Pokémon: The Movie 2000 - The Power of One', cdnPath: 'movies/02', poster: `${BASE_URL}/static/thumbnails/movies/2.jpg`, year: 1999, desc: 'Ash must save the world when a collector captures the Legendary birds.' },
    { id: 'pokeflix-m03', name: 'Pokémon 3: The Movie - Spell of the Unown', cdnPath: 'movies/03', poster: `${BASE_URL}/static/thumbnails/movies/3.jpg`, year: 2000, desc: 'Ash ventures into a crystal wasteland to rescue his mother from Entei and the Unown.' },
    { id: 'pokeflix-m04', name: 'Pokémon 4Ever: Celebi - Voice of the Forest', cdnPath: 'movies/04', poster: `${BASE_URL}/static/thumbnails/movies/4.jpg`, year: 2001, desc: 'Ash and friends protect the time-traveling Celebi from the Iron Masked Marauder.' },
    { id: 'pokeflix-m05', name: 'Pokémon Heroes: Latios & Latias', cdnPath: 'movies/05', poster: `${BASE_URL}/static/thumbnails/movies/5.jpg`, year: 2002, desc: 'Ash discovers the secret world of Latios and Latias in Alto Mare.' },
    { id: 'pokeflix-m06', name: 'Pokémon: Jirachi - Wish Maker', cdnPath: 'movies/06', poster: `${BASE_URL}/static/thumbnails/movies/6.jpg`, year: 2003, desc: 'Max befriends the Mythical Pokémon Jirachi during the Millennium Festival.' },
    { id: 'pokeflix-m07', name: 'Pokémon: Destiny Deoxys', cdnPath: 'movies/07', poster: `${BASE_URL}/static/thumbnails/movies/7.jpg`, year: 2004, desc: 'Deoxys and Rayquaza clash over Larousse City.' },
    { id: 'pokeflix-m08', name: 'Pokémon: Lucario and the Mystery of Mew', cdnPath: 'movies/08', poster: `${BASE_URL}/static/thumbnails/movies/8.jpg`, year: 2005, desc: 'Ash and Lucario journey to the Tree of Life to rescue Pikachu and Mew.' },
    { id: 'pokeflix-m09', name: 'Pokémon Ranger and the Temple of the Sea', cdnPath: 'movies/09', poster: `${BASE_URL}/static/thumbnails/movies/9.jpg`, year: 2006, desc: 'Ash and friends race to find the Sea Temple before the pirate Phantom.' },
    { id: 'pokeflix-m10', name: 'Pokémon: The Rise of Darkrai', cdnPath: 'movies/10', poster: `${BASE_URL}/static/thumbnails/movies/10.jpg`, year: 2007, desc: 'Darkrai appears as Dialga and Palkia battle over Alamos Town.' },
    { id: 'pokeflix-m11', name: 'Pokémon: Giratina and the Sky Warrior', cdnPath: 'movies/11', poster: `${BASE_URL}/static/thumbnails/movies/11.jpg`, year: 2008, desc: 'Ash helps Shaymin while Giratina battles in the Reverse World.' },
    { id: 'pokeflix-m12', name: 'Pokémon: Arceus and the Jewel of Life', cdnPath: 'movies/12', poster: `${BASE_URL}/static/thumbnails/movies/12.jpg`, year: 2009, desc: 'Ash travels through time to right an ancient wrong against Arceus.' },
    { id: 'pokeflix-m13', name: 'Pokémon: Zoroark - Master of Illusions', cdnPath: 'movies/13', poster: `${BASE_URL}/static/thumbnails/movies/13.jpg`, year: 2010, desc: "Ash uncovers the truth behind Zoroark's rampage in Crown City." },
    { id: 'pokeflix-m14a', name: 'Pokémon The Movie: Black - Victini and Reshiram', cdnPath: 'movies/14-black', poster: `${BASE_URL}/static/thumbnails/movies/14.jpg`, year: 2011, desc: 'Ash and Victini team up with Reshiram to save the Kingdom of the Vale.' },
    { id: 'pokeflix-m14b', name: 'Pokémon The Movie: White - Victini and Zekrom', cdnPath: 'movies/14-white', poster: `${BASE_URL}/static/thumbnails/movies/14.jpg`, year: 2011, desc: 'Ash and Victini team up with Zekrom to save the Kingdom of the Vale.' },
    { id: 'pokeflix-m15', name: 'Pokémon the Movie: Kyurem VS. The Sword of Justice', cdnPath: 'movies/15', poster: `${BASE_URL}/static/thumbnails/movies/15.jpg`, year: 2012, desc: 'Ash helps Keldeo rescue the Swords of Justice from Kyurem.' },
    { id: 'pokeflix-m16', name: 'Pokémon the Movie: Genesect and the Legend Awakened', cdnPath: 'movies/16', poster: `${BASE_URL}/static/thumbnails/movies/16.jpg`, year: 2013, desc: 'Mewtwo confronts a group of Genesect threatening the city.' },
    { id: 'pokeflix-m17', name: 'Pokémon the Movie: Diancie and the Cocoon of Destruction', cdnPath: 'movies/17', poster: `${BASE_URL}/static/thumbnails/movies/17.jpg`, year: 2014, desc: 'Ash helps Diancie discover its true power while Yveltal awakens.' },
    { id: 'pokeflix-m18', name: 'Pokémon the Movie: Hoopa and the Clash of Ages', cdnPath: 'movies/18', poster: `${BASE_URL}/static/thumbnails/movies/18.jpg`, year: 2015, desc: 'Ash helps Hoopa overcome the darkness within.' },
    { id: 'pokeflix-m19', name: 'Pokémon the Movie: Volcanion and the Mechanical Marvel', cdnPath: 'movies/19', poster: `${BASE_URL}/static/thumbnails/movies/19.jpg`, year: 2016, desc: 'Ash and Volcanion work together to rescue the Artificial Pokémon Magearna.' },
    { id: 'pokeflix-m20', name: 'Pokémon the Movie: I Choose You!', cdnPath: 'movies/20', poster: `${BASE_URL}/static/thumbnails/movies/20.jpg`, year: 2017, desc: 'A retelling of how Ash and Pikachu first met and began their journey.' },
    { id: 'pokeflix-m21', name: 'Pokémon the Movie: The Power of Us', cdnPath: 'movies/21', poster: `${BASE_URL}/static/thumbnails/movies/21.jpg`, year: 2018, desc: 'Ash and Pikachu journey to a seaside city and learn about teamwork.' },
    { id: 'pokeflix-m22', name: 'Pokémon: Mewtwo Strikes Back Evolution', cdnPath: 'movies/22', poster: `${BASE_URL}/static/thumbnails/movies/22.jpg`, year: 2019, desc: 'A CGI reimagining of the first Pokémon movie.' },
    { id: 'pokeflix-m23', name: 'Pokémon the Movie: Secrets of the Jungle', cdnPath: 'movies/23', poster: `${BASE_URL}/static/thumbnails/movies/23.jpg`, year: 2020, desc: 'Ash meets Koko, a boy raised by Zarude in the Forest of Okoya.' },
];

// ==================== URL CONSTRUCTION ====================

/**
 * Build the HLS playlist URL for a series episode.
 * Points to our local proxy which strips non-English tracks for faster startup.
 */
function buildEpisodeUrl(series, episodeNum) {
    const ep = String(episodeNum).padStart(2, '0');
    return `${serverUrl}/hls/series/${series.id}/${ep}/playlist.m3u8`;
}

/**
 * Build the HLS playlist URL for a movie.
 * Points to our local proxy which strips non-English tracks for faster startup.
 */
function buildMovieUrl(movie) {
    return `${serverUrl}/hls/movie/${movie.id}/playlist.m3u8`;
}

// ==================== MANIFEST PROXY ====================

// In-memory cache: key → { data, timestamp }
const manifestCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch a master HLS manifest from the CDN, strip all non-English audio/subtitle
 * tracks, remove I-frame streams, and absolutify all relative URIs so the player
 * goes directly to the CDN for variant playlists and segments.
 *
 * Newer seasons (S17+) have 40-57 tracks (23 audio dubs, 25+ subtitle languages).
 * The player fetches every track's sub-playlist before starting playback.
 * By stripping to English-only, we cut ~50 requests down to ~3.
 */
async function fetchFilteredManifest(cdnPath) {
    const cacheKey = cdnPath;
    const cached = manifestCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    const cdnUrl = `${CDN_BASE}/${cdnPath}`;
    const text = await httpsGet(`${cdnUrl}/playlist.m3u8`);
    if (!text) return null;

    const filtered = filterManifest(text, cdnUrl);
    manifestCache.set(cacheKey, { data: filtered, timestamp: Date.now() });
    return filtered;
}

/** Simple HTTPS GET that returns the response body as a string. */
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) return resolve(null);
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

/**
 * Parse an HLS master manifest and keep only:
 *  - English audio (+ Japanese for movies that have it)
 *  - English subtitles (regular + SDH + forced)
 *  - All video quality variants
 * Removes I-frame streams (trick play, not needed).
 * Converts all relative URIs to absolute CDN URLs.
 */
function filterManifest(manifest, cdnUrl) {
    const lines = manifest.split('\n');
    const output = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Always keep the header tags
        if (line.startsWith('#EXTM3U') || line.startsWith('#EXT-X-INDEPENDENT-SEGMENTS')) {
            output.push(line);
            continue;
        }

        // Filter AUDIO tracks: keep English + Japanese only
        if (line.includes('TYPE=AUDIO')) {
            if (line.includes('LANGUAGE="en"') || line.includes('LANGUAGE="ja"')) {
                output.push(absolutifyUri(line, cdnUrl));
            }
            continue;
        }

        // Filter SUBTITLE tracks: keep English variants only
        if (line.includes('TYPE=SUBTITLES')) {
            if (line.includes('LANGUAGE="en"')) {
                output.push(absolutifyUri(line, cdnUrl));
            }
            continue;
        }

        // Skip I-frame streams (trick play, not needed for normal playback)
        if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
            continue;
        }

        // Keep #EXT-X-STREAM-INF and the variant URI on the next line
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            output.push(line);
            // Next line is the variant playlist URI — absolutify it
            if (i + 1 < lines.length) {
                i++;
                output.push(`${cdnUrl}/${lines[i].trim()}`);
            }
            continue;
        }

        // Skip comment lines (like "## Generated with ...")
        if (line.startsWith('#')) {
            output.push(line);
            continue;
        }

        // Blank lines
        if (!line.trim()) {
            output.push(line);
            continue;
        }

        // Any other non-empty line — absolutify just in case
        output.push(`${cdnUrl}/${line.trim()}`);
    }

    return output.join('\n');
}

/** Replace URI="relative.m3u8" with URI="https://cdn.../relative.m3u8" */
function absolutifyUri(line, cdnUrl) {
    return line.replace(/URI="([^"]+)"/, (_, uri) => `URI="${cdnUrl}/${uri}"`);
}

// ==================== EPISODE TITLES (static from pokeflix) ====================

const episodeTitles = require('./episodes.json');

/** Get episode title, falling back to "Episode N" if not available. */
function getEpisodeTitle(seriesId, episodeNum) {
    const titles = episodeTitles[seriesId];
    if (titles && titles[episodeNum]) {
        return titles[episodeNum];
    }
    return `Episode ${episodeNum}`;
}

// ==================== STREMIO ADDON ====================

const builder = new addonBuilder({
    id: 'community.pokeflix',
    version: '2.1.0',
    name: 'Pokéflix',
    description: 'Watch Pokémon anime series, movies and specials — adaptive quality, subtitles, and multi-language audio',
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
        return {
            metas: SERIES.map(s => ({
                id: s.id,
                type: 'series',
                name: s.name,
                poster: s.poster,
                description: s.desc,
                genres: [s.gen, 'Anime', 'Pokémon'],
            })),
        };
    }

    if (args.type === 'movie' && args.id === 'pokeflix-movies') {
        return {
            metas: MOVIES.map(m => ({
                id: m.id,
                type: 'movie',
                name: m.name,
                poster: m.poster,
                description: m.desc,
                releaseInfo: m.year ? String(m.year) : undefined,
                genres: ['Anime', 'Pokémon', 'Movie'],
            })),
        };
    }

    return { metas: [] };
});

// ----- META HANDLER -----
builder.defineMetaHandler(async (args) => {
    console.log(`[Meta] type=${args.type} id=${args.id}`);

    // Series meta
    const series = SERIES.find(s => s.id === args.id);
    if (series) {
        const videos = [];
        for (let ep = 1; ep <= series.episodes; ep++) {
            const title = getEpisodeTitle(series.id, ep);
            videos.push({
                id: `${series.id}:1:${ep}`,
                title: title,
                season: 1,
                episode: ep,
                released: new Date('2025-01-01').toISOString(),
                thumbnail: `${BASE_URL}/static/thumbnails/${series.cdn}/${ep}.jpg`,
                overview: `${series.name} — ${title}`,
            });
        }

        return {
            meta: {
                id: series.id,
                type: 'series',
                name: series.name,
                poster: series.poster,
                description: series.desc,
                genres: [series.gen, 'Anime', 'Pokémon'],
                videos,
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

    const streams = [];

    // Movie stream
    const movie = MOVIES.find(m => m.id === args.id);
    if (movie) {
        streams.push({
            title: 'Pokéflix\n1080p · 720p · 360p · Adaptive',
            url: buildMovieUrl(movie),
            behaviorHints: {
                notWebReady: true,
                bingeGroup: 'pokeflix',
            },
        });
        return { streams };
    }

    // Series episode stream (format: seriesId:season:episode)
    if (args.id.includes(':')) {
        const parts = args.id.split(':');
        const seriesId = parts[0];
        const episode = parseInt(parts[2]);

        const series = SERIES.find(s => s.id === seriesId);
        if (series && episode >= 1 && episode <= series.episodes) {
            streams.push({
                title: 'Pokéflix\n1080p · 720p · 360p · Adaptive',
                url: buildEpisodeUrl(series, episode),
                behaviorHints: {
                    notWebReady: true,
                    bingeGroup: 'pokeflix',
                },
            });
        }
    }

    if (streams.length === 0) {
        console.warn(`[Stream] No stream found for ${args.id}`);
    }

    return { streams };
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 7515;

const app = express();

// CORS headers + detect server URL from incoming requests
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(200);

    // Auto-detect our public URL from incoming requests
    const host = req.get('x-forwarded-host') || req.get('host');
    const proto = req.get('x-forwarded-proto') || req.protocol;
    if (host) serverUrl = `${proto}://${host}`;

    next();
});

// ----- HLS manifest proxy routes -----
// Serves a stripped-down manifest (English audio/subs only) with absolute CDN URLs.
// The player then fetches variant playlists and segments directly from the CDN.

app.get('/hls/series/:seriesId/:episode/playlist.m3u8', async (req, res) => {
    const series = SERIES.find(s => s.id === req.params.seriesId);
    const ep = req.params.episode;
    if (!series) return res.sendStatus(404);

    try {
        const filtered = await fetchFilteredManifest(`${series.cdn}/${ep}`);
        if (!filtered) return res.sendStatus(502);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(filtered);
    } catch (err) {
        console.error(`[Proxy] Error for series ${series.cdn}/${ep}:`, err.message);
        // Fallback: redirect to original CDN manifest
        res.redirect(`${CDN_BASE}/${series.cdn}/${ep}/playlist.m3u8`);
    }
});

app.get('/hls/movie/:movieId/playlist.m3u8', async (req, res) => {
    const movie = MOVIES.find(m => m.id === req.params.movieId);
    if (!movie) return res.sendStatus(404);

    try {
        const filtered = await fetchFilteredManifest(movie.cdnPath);
        if (!filtered) return res.sendStatus(502);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(filtered);
    } catch (err) {
        console.error(`[Proxy] Error for movie ${movie.cdnPath}:`, err.message);
        res.redirect(`${CDN_BASE}/${movie.cdnPath}/playlist.m3u8`);
    }
});

// Cache stats endpoint (optional, for debugging)
app.get('/cache/stats', (req, res) => {
    res.json({
        entries: manifestCache.size,
        keys: [...manifestCache.keys()],
    });
});

// Mount the Stremio addon routes
app.use(getRouter(builder.getInterface()));

// Start server
app.listen(PORT, () => {
    const totalEps = SERIES.reduce((t, s) => t + s.episodes, 0);
    const titleCount = Object.values(episodeTitles).reduce((t, m) => t + Object.keys(m).length, 0);
    console.log(`\n🎮 Pokéflix Stremio Addon v2.1\n📡 Server:   http://localhost:${PORT}\n📺 Manifest: http://localhost:${PORT}/manifest.json\n🔗 Install:  stremio://localhost:${PORT}/manifest.json\n📊 ${SERIES.length} series (${totalEps} episodes) + ${MOVIES.length} movies\n📝 ${titleCount} episode titles loaded from episodes.json\n`);
});
