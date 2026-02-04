const fs = require('fs');
const path = require('path');

const root = 'j:/';
const searchStr = 'LATIN REMIX';

function scan(curr) {
    let items;
    try { items = fs.readdirSync(curr); } catch (e) { return; }
    items.forEach(item => {
        const fullPath = path.join(curr, item);
        let stat;
        try { stat = fs.lstatSync(fullPath); } catch (e) { return; }
        if (stat.isDirectory()) {
            if (item !== 'node_modules' && item !== '.git' && !item.startsWith('$')) scan(fullPath);
        } else if (stat.isFile()) {
            const ext = path.extname(item).toLowerCase();
            if (['.js', '.ejs', '.json', '.db', '.env', '.txt', '.md'].includes(ext)) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    if (content.includes(searchStr)) {
                        console.log(`FOUND '${searchStr}' in: ${fullPath}`);
                    }
                } catch (e) { }
            }
        }
    });
}

scan(root);
console.log("Search finished.");
