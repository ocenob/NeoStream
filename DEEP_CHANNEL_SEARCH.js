const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const searchDirs = [
    'j:/neostream',
    'j:/neostreampro',
    'j:/Streamingo-',
    'j:/bwstream-bluk-jadwal'
];

searchDirs.forEach(dir => {
    function walk(curr) {
        if (!fs.existsSync(curr)) return;
        const items = fs.readdirSync(curr);
        items.forEach(item => {
            const fullPath = path.join(curr, item);
            let stat;
            try { stat = fs.statSync(fullPath); } catch (e) { return; }
            if (stat.isDirectory()) {
                if (item !== 'node_modules' && item !== '.git') walk(fullPath);
            } else if (item.endsWith('.db')) {
                checkDb(fullPath);
            }
        });
    }
    walk(dir);
});

function checkDb(dbPath) {
    const db = new sqlite3.Database(dbPath);
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='youtube_channels'", (err, table) => {
        if (err || !table) { db.close(); return; }
        db.all("SELECT channel_name FROM youtube_channels", (err, rows) => {
            if (!err && rows) {
                rows.forEach(r => {
                    console.log(`[DB: ${dbPath}] Channel: ${r.channel_name}`);
                });
            }
            db.close();
        });
    });
}
