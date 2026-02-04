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
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('channels', 'youtube_channels', 'channel_list')", (err, table) => {
            if (err || !table) { db.close(); return; }
            const tableName = table.name;
            db.all(`SELECT * FROM ${tableName}`, (err, rows) => {
                if (!err && rows) {
                    rows.forEach(r => {
                        const name = r.channel_name || r.name || r.title || "UNKNOWN";
                        if (name.toUpperCase().includes("LATIN")) {
                            console.log(`[LATIN MATCH] DB: ${dbPath}, Table: ${tableName}, Name: ${name}`);
                        }
                    });
                }
                db.close();
            });
        });
    });
}

scan(root);
