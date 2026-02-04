const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const root = 'j:/';

function scan(curr) {
    let items;
    try { items = fs.readdirSync(curr); } catch (e) { return; }
    items.forEach(item => {
        const fullPath = path.join(curr, item);
        let stat;
        try { stat = fs.statSync(fullPath); } catch (e) { return; }
        if (stat.isDirectory()) {
            if (item !== 'node_modules' && item !== '.git' && !item.startsWith('$')) scan(fullPath);
        } else if (item.endsWith('.db')) {
            checkDb(fullPath);
        }
    });
}

function checkDb(dbPath) {
    const db = new sqlite3.Database(dbPath);
    db.serialize(() => {
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='youtube_channels'", (err, table) => {
            if (err || !table) { db.close(); return; }
            db.all("SELECT id, channel_name FROM youtube_channels", (err, rows) => {
                if (!err && rows) {
                    rows.forEach(r => {
                        console.log(`[DB FOUND] Path: ${dbPath}, ID: ${r.id}, Name: ${r.channel_name}`);
                    });
                }
                db.close();
            });
        });
    });
}

scan(root);
