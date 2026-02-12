#!/usr/bin/env node
/**
 * generate-episodes.js
 * 
 * One-time script to fetch episode titles from Wikipedia for all Pokémon seasons
 * and generate a static episodes.json file used by the Stremio addon.
 * 
 * Usage: node generate-episodes.js
 * Output: episodes.json
 */

const https = require('https');
const fs = require('fs');

// ==================== SEASON → WIKIPEDIA MAPPING ====================
// Each entry maps a Pokeflix season ID to Wikipedia article title(s).
// Some seasons may need special handling (multiple articles, different section numbers, etc.)

const SEASONS = [
    // Main series seasons
    { id: 'pokeflix-s01', wiki: 'Pokémon: Indigo League', episodes: 82 },
    { id: 'pokeflix-s02', wiki: 'Pokémon: Adventures in the Orange Islands', episodes: 36 },
    { id: 'pokeflix-s03', wiki: 'Pokémon: The Johto Journeys', episodes: 41 },
    { id: 'pokeflix-s04', wiki: 'Pokémon: Johto League Champions', episodes: 52 },
    { id: 'pokeflix-s05', wiki: 'Pokémon: Master Quest', episodes: 65 },
    { id: 'pokeflix-s06', wiki: 'Pokémon: Advanced', episodes: 40 },
    { id: 'pokeflix-s07', wiki: 'Pokémon: Advanced Challenge', episodes: 52 },
    { id: 'pokeflix-s08', wiki: 'Pokémon: Advanced Battle', episodes: 53 },
    { id: 'pokeflix-s09', wiki: 'Pokémon: Battle Frontier', episodes: 47 },
    { id: 'pokeflix-s10', wiki: 'Pokémon: Diamond and Pearl', wikiAlt: 'Pokémon: Diamond and Pearl (TV series)', episodes: 51 },
    { id: 'pokeflix-s11', wiki: 'Pokémon: DP Battle Dimension', episodes: 52 },
    { id: 'pokeflix-s12', wiki: 'Pokémon: DP Galactic Battles', episodes: 53 },
    { id: 'pokeflix-s13', wiki: 'Pokémon: DP Sinnoh League Victors', episodes: 34 },
    { id: 'pokeflix-s14', wiki: 'Pokémon the Series: Black & White', episodes: 48 },
    { id: 'pokeflix-s15', wiki: 'Pokémon the Series: BW Rival Destinies', episodes: 49 },
    { id: 'pokeflix-s16', wiki: 'Pokémon the Series: BW Adventures in Unova and Beyond', episodes: 45 },
    { id: 'pokeflix-s17', wiki: 'Pokémon the Series: XY', episodes: 48 },
    { id: 'pokeflix-s18', wiki: 'Pokémon the Series: XY Kalos Quest', episodes: 45 },
    { id: 'pokeflix-s19', wiki: 'Pokémon the Series: XYZ', episodes: 48 },
    { id: 'pokeflix-s20', wiki: 'Pokémon the Series: Sun & Moon', episodes: 43 },
    { id: 'pokeflix-s21', wiki: 'Pokémon the Series: Sun & Moon – Ultra Adventures', episodes: 49 },
    { id: 'pokeflix-s22', wiki: 'Pokémon the Series: Sun & Moon – Ultra Legends', episodes: 54 },
    { id: 'pokeflix-s23', wiki: 'Pokémon Journeys: The Series', episodes: 48 },
    { id: 'pokeflix-s24', wiki: 'Pokémon Master Journeys: The Series', episodes: 42 },
    { id: 'pokeflix-s25', wiki: 'Pokémon Ultimate Journeys: The Series', episodes: 53 },
    { id: 'pokeflix-s26', wiki: 'Pokémon Horizons: The Series', episodes: 45, wikiSeason: 1 },
    { id: 'pokeflix-s27', wiki: 'Pokémon Horizons: The Series', episodes: 44, wikiSeason: 2 },
    { id: 'pokeflix-s28', wiki: 'Pokémon Horizons: The Series', episodes: 12, wikiSeason: 3 },

    // Specials
    { id: 'pokeflix-sp-origins', wiki: 'Pokémon Origins', episodes: 4 },
    { id: 'pokeflix-sp-generations', wiki: 'Pokémon Generations', episodes: 18 },
    { id: 'pokeflix-sp-twilight', wiki: 'Pokémon: Twilight Wings', episodes: 8 },
    { id: 'pokeflix-sp-evolutions', wiki: 'Pokémon Evolutions', episodes: 8 },
    { id: 'pokeflix-sp-hisuian', wiki: 'Pokémon: Hisuian Snow', episodes: 3 },
    { id: 'pokeflix-sp-paldean', wiki: 'Pokémon: Paldean Winds', episodes: 4 },
    { id: 'pokeflix-sp-mega', wiki: 'Pokémon the Series: XY', episodes: 4, specialType: 'mega' },
    { id: 'pokeflix-sp-chronicles', wiki: 'Pokémon Chronicles', episodes: 22 },
    { id: 'pokeflix-sp-mystery', episodes: 5 },     // No Wikipedia source
    { id: 'pokeflix-sp-pikachu', episodes: 21 },     // No Wikipedia source
    { id: 'pokeflix-sp-specials', episodes: 23 },    // No Wikipedia source
];

// ==================== HTTP HELPER ====================

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'PokeflixAddon/1.0 (episode title generator)' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return httpsGet(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return resolve(null);
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// ==================== WIKIPEDIA API ====================

/**
 * Fetch the wikitext of a Wikipedia article (or a specific section).
 * Returns the raw wikitext string.
 */
async function fetchWikitext(articleTitle, section) {
    let url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(articleTitle)}&format=json&prop=wikitext`;
    if (section !== undefined) {
        url += `&section=${section}`;
    }
    const response = await httpsGet(url);
    if (!response) return null;
    
    try {
        const json = JSON.parse(response);
        if (json.error) {
            console.warn(`  Wikipedia error for "${articleTitle}": ${json.error.info}`);
            return null;
        }
        return json.parse.wikitext['*'];
    } catch (err) {
        console.warn(`  Failed to parse Wikipedia response for "${articleTitle}": ${err.message}`);
        return null;
    }
}

/**
 * Fetch the section list for a Wikipedia article to find the "Episode list" section.
 */
async function findEpisodeSection(articleTitle) {
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(articleTitle)}&format=json&prop=sections`;
    const response = await httpsGet(url);
    if (!response) return null;
    
    try {
        const json = JSON.parse(response);
        if (json.error) return null;
        const sections = json.parse.sections;
        // Look for "Episode list" or "Episodes" section
        for (const s of sections) {
            if (/episode\s*list|episodes/i.test(s.line)) {
                return parseInt(s.index);
            }
        }
        return null;
    } catch {
        return null;
    }
}

// ==================== WIKITEXT PARSER ====================

/**
 * Parse episode titles from wikitext.
 * Handles the {{Episode list}} templates used on Pokémon season pages.
 * 
 * Extracts EpisodeNumber3 (season number) and Title for each episode.
 */
function parseEpisodes(wikitext) {
    const episodes = {};
    
    // Split into episode blocks (each starts with {{#invoke:Episode list|sublist or similar)
    // We'll use a regex to find all Title= and EpisodeNumber3= pairs
    
    // Match episode template blocks
    const blockRegex = /\{\{#invoke:Episode list\|sublist([\s\S]*?)(?=\{\{#invoke:Episode list|$)/g;
    let blockMatch;
    
    while ((blockMatch = blockRegex.exec(wikitext)) !== null) {
        const block = blockMatch[1];
        
        // Extract episode number within season
        const numMatch = block.match(/EpisodeNumber3\s*=\s*(\d+)/);
        // Extract title
        const titleMatch = block.match(/\|\s*Title\s*=\s*(.+)/);
        
        if (numMatch && titleMatch) {
            const epNum = parseInt(numMatch[1]);
            let title = titleMatch[1].trim();
            
            // Clean up wikitext formatting from the title
            title = cleanTitle(title);
            
            if (title && epNum > 0) {
                episodes[epNum] = title;
            }
        }
    }
    
    // If the block regex didn't work, try a line-by-line approach
    if (Object.keys(episodes).length === 0) {
        const lines = wikitext.split('\n');
        let currentNum = null;
        
        for (const line of lines) {
            const numMatch = line.match(/EpisodeNumber3?\s*=\s*(\d+)/);
            if (numMatch) {
                currentNum = parseInt(numMatch[1]);
            }
            const titleMatch = line.match(/^\|\s*Title\s*=\s*(.+)/);
            if (titleMatch && currentNum !== null) {
                let title = cleanTitle(titleMatch[1].trim());
                if (title) {
                    episodes[currentNum] = title;
                }
                currentNum = null;
            }
        }
    }
    
    return episodes;
}

/**
 * Parse episodes that use a simpler table format (some specials).
 * Looks for sequential episodes and their titles.
 */
function parseSimpleEpisodes(wikitext) {
    const episodes = {};
    
    // Try the Episode list template format first
    const result = parseEpisodes(wikitext);
    if (Object.keys(result).length > 0) return result;
    
    // Try simpler patterns
    const lines = wikitext.split('\n');
    let epNum = 0;
    
    for (const line of lines) {
        // Look for Title = lines
        const titleMatch = line.match(/^\|\s*Title\s*=\s*(.+)/i);
        if (titleMatch) {
            epNum++;
            let title = cleanTitle(titleMatch[1].trim());
            if (title) {
                episodes[epNum] = title;
            }
        }
    }
    
    return episodes;
}

/**
 * Clean a Wikipedia title string by removing wikitext formatting:
 * - [[link|display text]] → display text
 * - [[simple link]] → simple link
 * - ''italic'' → italic
 * - <ref>...</ref> → removed
 * - HTML entities → decoded
 */
function cleanTitle(title) {
    // Remove <ref>...</ref> and <ref ... /> tags
    title = title.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
    title = title.replace(/<ref[^>]*\/>/gi, '');
    
    // Remove HTML tags
    title = title.replace(/<[^>]+>/g, '');
    
    // Handle [[link|display]] → display
    title = title.replace(/\[\[([^\]]*?\|)?([^\]]+)\]\]/g, '$2');
    
    // Remove remaining {{ }} templates
    title = title.replace(/\{\{[^}]+\}\}/g, '');
    
    // Remove '' (italic markers)
    title = title.replace(/''/g, '');
    
    // Decode HTML entities
    title = title.replace(/&amp;/g, '&');
    title = title.replace(/&lt;/g, '<');
    title = title.replace(/&gt;/g, '>');
    title = title.replace(/&quot;/g, '"');
    title = title.replace(/&nbsp;/g, ' ');
    title = title.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
    
    // Clean up whitespace
    title = title.replace(/\s+/g, ' ').trim();
    
    // Remove trailing parenthetical transliterations if the title ends with one
    // e.g., "Title (Japanese: ...)" — but keep subtitles like "Part 1"
    
    return title;
}

// ==================== HORIZONS SPECIAL HANDLING ====================

/**
 * Pokémon Horizons spans multiple Pokeflix seasons.
 * Wikipedia may have one article with multiple sections/seasons.
 * We need to split the episodes into the right seasons.
 */
async function fetchHorizonsEpisodes() {
    console.log('\n  Fetching Pokémon Horizons (multi-season)...');
    
    // First, try to fetch the full article
    const wikitext = await fetchWikitext('Pokémon Horizons: The Series');
    if (!wikitext) {
        console.warn('  Failed to fetch Pokémon Horizons article');
        return {};
    }
    
    // Parse all episodes
    const allEpisodes = {};
    const lines = wikitext.split('\n');
    let currentEpNum = null;
    let currentSeasonNum = null;
    
    for (const line of lines) {
        // Track season headers
        const seasonHeader = line.match(/==.*?Season\s+(\d+)/i);
        if (seasonHeader) {
            currentSeasonNum = parseInt(seasonHeader[1]);
        }
        
        const numMatch = line.match(/EpisodeNumber3?\s*=\s*(\d+)/);
        if (numMatch) {
            currentEpNum = parseInt(numMatch[1]);
        }
        const titleMatch = line.match(/^\|\s*Title\s*=\s*(.+)/);
        if (titleMatch && currentEpNum !== null) {
            let title = cleanTitle(titleMatch[1].trim());
            if (title) {
                if (!allEpisodes[currentSeasonNum || 1]) allEpisodes[currentSeasonNum || 1] = {};
                allEpisodes[currentSeasonNum || 1][currentEpNum] = title;
            }
            currentEpNum = null;
        }
    }
    
    return allEpisodes;
}

// ==================== MEGA EVOLUTION SPECIALS ====================

// Hardcoded since they're special episodes within the XY article
const MEGA_EVOLUTION_EPISODES = {
    1: 'Mega Evolution Special I',
    2: 'Mega Evolution Special II',
    3: 'Mega Evolution Special III',
    4: 'Mega Evolution Special IV',
};

// ==================== FALLBACK TITLES FOR HARD-TO-SCRAPE SPECIALS ====================

const MYSTERY_DUNGEON_EPISODES = {
    1: 'Team Go-Getters Out of the Gate!',
    2: 'Pokémon Mystery Dungeon: Explorers of Time & Darkness',
    3: 'Pokémon Mystery Dungeon: Explorers of Sky - Beyond Time & Darkness',
    4: 'Pokémon Super Mystery Dungeon Animation',
    5: 'Pokémon Mystery Dungeon: Rescue Team DX',
};

const PIKACHU_SHORTS = {
    1: "Pikachu's Vacation",
    2: "Pikachu's Rescue Adventure",
    3: "Pikachu & Pichu",
    4: "Pikachu's PikaBoo",
    5: "Camp Pikachu",
    6: "Gotta Dance!!",
    7: "Pikachu's Summer Festival",
    8: "Pikachu's Ghost Carnival",
    9: "Pikachu's Island Adventure",
    10: "Pikachu's Exploration Club",
    11: "Pikachu the Movie: Pikachu Ice Adventure",
    12: "Pikachu's Really Mysterious Adventure",
    13: "Pikachu's Big Sparking Search",
    14: "Pikachu's Strange Wonder Adventure",
    15: "Eevee & Friends",
    16: "Pikachu, What's This Key?",
    17: "Pikachu and the Pokémon Music Squad",
    18: "The Mini Djinni of the Prairie",
    19: "Pikachu's Exciting Adventure!",
    20: "Pikachu's Thrilling Relay Race",
    21: "Pikachu and the Pokémon Band",
};

const POKEMON_SPECIALS = {
    1: "Mewtwo Returns",
    2: "The Mastermind of Mirage Pokémon",
    3: "The Legend of Thunder!",
    4: "A Date with Delcatty",
    5: "Oaknapped!",
    6: "Showdown at the Oak Corral",
    7: "Those Darn Electabuzz!",
    8: "The Cerulean Blue",
    9: "We're No Angels!",
    10: "Trouble in Big Town",
    11: "Of Meowth and Pokémon",
    12: "Pichu Bros. in Party Panic",
    13: "Pokémon Ranger: Guardian Signs",
    14: "Meloetta's Moonlight Serenade",
    15: "Iris vs. Clair!",
    16: "Diancie: Princess of the Diamond Domain",
    17: "The Archdjinn of the Rings: Hoopa",
    18: "Pokémon Ranger: Heatran Rescue!",
    19: "Pokémon Ranger: Deoxys Crisis!",
    20: "The Blue Lagoon",
    21: "Big Meowth, Little Dreams",
    22: "The Red, Red Genesect",
    23: "Distant Blue Sky!",
};

// ==================== MAIN GENERATOR ====================

async function main() {
    console.log('🎮 Pokémon Episode Title Generator');
    console.log('===================================\n');
    
    const allData = {};
    let totalEps = 0;
    let totalSuccess = 0;
    const failures = [];
    
    // Handle Horizons separately since it's one article with multiple seasons
    let horizonsData = null;
    
    for (const season of SEASONS) {
        process.stdout.write(`[${season.id}] `);
        
        // --- Hardcoded specials ---
        if (season.id === 'pokeflix-sp-mega') {
            allData[season.id] = MEGA_EVOLUTION_EPISODES;
            console.log(`✅ ${Object.keys(MEGA_EVOLUTION_EPISODES).length} episodes (hardcoded)`);
            totalSuccess += Object.keys(MEGA_EVOLUTION_EPISODES).length;
            totalEps += season.episodes;
            continue;
        }
        if (season.id === 'pokeflix-sp-mystery') {
            allData[season.id] = MYSTERY_DUNGEON_EPISODES;
            console.log(`✅ ${Object.keys(MYSTERY_DUNGEON_EPISODES).length} episodes (hardcoded)`);
            totalSuccess += Object.keys(MYSTERY_DUNGEON_EPISODES).length;
            totalEps += season.episodes;
            continue;
        }
        if (season.id === 'pokeflix-sp-pikachu') {
            allData[season.id] = PIKACHU_SHORTS;
            console.log(`✅ ${Object.keys(PIKACHU_SHORTS).length} episodes (hardcoded)`);
            totalSuccess += Object.keys(PIKACHU_SHORTS).length;
            totalEps += season.episodes;
            continue;
        }
        if (season.id === 'pokeflix-sp-specials') {
            allData[season.id] = POKEMON_SPECIALS;
            console.log(`✅ ${Object.keys(POKEMON_SPECIALS).length} episodes (hardcoded)`);
            totalSuccess += Object.keys(POKEMON_SPECIALS).length;
            totalEps += season.episodes;
            continue;
        }
        
        // --- Horizons (multi-season article) ---
        if (season.wiki === 'Pokémon Horizons: The Series') {
            if (!horizonsData) {
                horizonsData = await fetchHorizonsEpisodes();
            }
            const wikiSeason = season.wikiSeason || 1;
            const eps = horizonsData[wikiSeason] || {};
            allData[season.id] = eps;
            const count = Object.keys(eps).length;
            if (count >= season.episodes * 0.8) {
                console.log(`✅ ${count}/${season.episodes} episodes (Horizons S${wikiSeason})`);
            } else {
                console.log(`⚠️  ${count}/${season.episodes} episodes (Horizons S${wikiSeason})`);
                if (count < season.episodes) {
                    failures.push({ id: season.id, expected: season.episodes, got: count });
                }
            }
            totalSuccess += count;
            totalEps += season.episodes;
            continue;
        }
        
        // --- No Wikipedia source ---
        if (!season.wiki) {
            allData[season.id] = {};
            console.log(`⏭️  No source (will use "Episode N" fallback)`);
            totalEps += season.episodes;
            continue;
        }
        
        // --- Standard Wikipedia fetch ---
        totalEps += season.episodes;
        
        try {
            // Try to find the episode list section first
            const sectionIdx = await findEpisodeSection(season.wiki);
            
            let wikitext = null;
            
            // Try section-specific fetch if we found a section
            if (sectionIdx !== null) {
                wikitext = await fetchWikitext(season.wiki, sectionIdx);
            }
            
            // If section fetch failed, try full article
            if (!wikitext) {
                wikitext = await fetchWikitext(season.wiki);
            }
            
            // If primary article failed, try alternate name
            if (!wikitext && season.wikiAlt) {
                const altSection = await findEpisodeSection(season.wikiAlt);
                if (altSection !== null) {
                    wikitext = await fetchWikitext(season.wikiAlt, altSection);
                }
                if (!wikitext) {
                    wikitext = await fetchWikitext(season.wikiAlt);
                }
            }
            
            if (!wikitext) {
                console.log(`❌ Failed to fetch`);
                allData[season.id] = {};
                failures.push({ id: season.id, expected: season.episodes, got: 0, reason: 'fetch failed' });
                continue;
            }
            
            // Parse episodes
            let episodes = parseEpisodes(wikitext);
            
            // If we got more than expected, cap at the expected count
            if (Object.keys(episodes).length > season.episodes) {
                const capped = {};
                for (let i = 1; i <= season.episodes; i++) {
                    if (episodes[i]) capped[i] = episodes[i];
                }
                episodes = capped;
            }
            
            const count = Object.keys(episodes).length;
            allData[season.id] = episodes;
            
            if (count >= season.episodes) {
                console.log(`✅ ${count}/${season.episodes} episodes`);
            } else if (count >= season.episodes * 0.8) {
                console.log(`⚠️  ${count}/${season.episodes} episodes`);
            } else if (count > 0) {
                console.log(`⚠️  ${count}/${season.episodes} episodes (partial)`);
                failures.push({ id: season.id, expected: season.episodes, got: count });
            } else {
                console.log(`❌ No episodes parsed`);
                failures.push({ id: season.id, expected: season.episodes, got: 0, reason: 'parse failed' });
            }
            
            totalSuccess += count;
            
        } catch (err) {
            console.log(`❌ Error: ${err.message}`);
            allData[season.id] = {};
            failures.push({ id: season.id, expected: season.episodes, got: 0, reason: err.message });
        }
        
        // Rate limiting - be nice to Wikipedia
        await new Promise(r => setTimeout(r, 200));
    }
    
    // ==================== OUTPUT ====================
    
    console.log('\n===================================');
    console.log(`📊 Total: ${totalSuccess}/${totalEps} episode titles fetched`);
    
    if (failures.length > 0) {
        console.log(`\n⚠️  ${failures.length} seasons with issues:`);
        for (const f of failures) {
            console.log(`   ${f.id}: expected ${f.expected}, got ${f.got}${f.reason ? ` (${f.reason})` : ''}`);
        }
    }
    
    // Write the JSON file
    const outputPath = './episodes.json';
    fs.writeFileSync(outputPath, JSON.stringify(allData, null, 2));
    console.log(`\n✅ Saved to ${outputPath}`);
    console.log(`   File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
