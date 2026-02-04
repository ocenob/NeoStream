const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const scanDirs = ['j:/neostream', 'j:/neostreampro'];

scanDirs.forEach(root => {
    function walk(curr) {
        if (!fs.existsSync(curr)) return;
        fs.readdirSync(curr).forEach(item => {
            const p = path.join(curr, item);
            let stat;
            try { stat = fs.statSync(p); } catch (e) { return; }
            if (stat.isDirectory()) {
                if (item !== 'node_modules' && item !== '.git') walk(p);
            } else if (item.endsWith('.db')) {
                check(p);
            }
        });
    }
    walk(root);
});

function check(dbPath) {
    const db = new sqlite3.Database(dbPath);
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='youtube_channels'", (err, table) => {
        if (err || !table) { db.close(); return; }
        db.all("SELECT channel_name FROM youtube_channels", (err, rows) => {
            if (!err && rows) {
                const others = rows.filter(r => r.channel_name !== 'IQ Quest');
                if (others.length > 0) {
                    console.log(`FOUND OTHER CHANNELS In DB: ${dbPath}`);
                    others.forEach(o => console.log(`  - ${o.channel_name}`));
                } else if (rows.length > 0) {
                    console.log(`DB: ${dbPath} only has IQ Quest`);
                }
            }
            db.close();
        });
    });
}
