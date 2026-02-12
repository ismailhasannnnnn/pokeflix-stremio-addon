const https = require('https');
const url = 'https://www.pokeflix.tv/browse/pokemon-indigo-league';
const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
};
https.get(url, { headers }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        if (data.includes('Just a moment')) {
            console.log('CLOUDFLARE BLOCKED');
        } else {
            const matches = data.match(/####\s+\d+\s+-\s+.+/g);
            if (matches) {
                console.log('SUCCESS! Found', matches.length, 'episodes');
                matches.slice(0, 3).forEach(m => console.log(' ', m.trim()));
            } else {
                console.log('Status:', res.statusCode);
                console.log('First 300:', data.slice(0, 300));
            }
        }
    });
}).on('error', e => console.log('Error:', e.message));
