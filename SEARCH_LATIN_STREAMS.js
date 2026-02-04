const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const root = 'j:/';

function scan(curr) {
    let items;
    try { items = fs.readdirSync(curr); } catch (e) { return; }
    items.forEach(item => {
        const full = path.join(curr, item);
        let stat;
        try { stat = fs.statSync(full); } catch (e) { return; }
        if (stat.isDirectory()) {
            if (item !== 'node_modules' && item !== '.git') {
                scan(full);
            }
        } else if (item.endsWith('.db')) {
            const db = new sqlite3.Database(full);
            db.all("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('streams', 'stream_history', 'videos')", (err, rows) => {
                if (!err && rows && rows.length > 0) {
                    rows.forEach(table => {
                        db.all(`SELECT * FROM ${table.name} WHERE ` + (table.name === 'videos' ? 'title' : 'title') + " LIKE '%LATIN%' LIMIT 5", (err, latinRows) => {
                            if (!err && latinRows && latinRows.length > 0) {
                                console.log(`[LATIN FOUND] DB: ${full}, Table: ${table.name}`);
                                console.log(`Data: ${JSON.stringify(latinRows, null, 2)}`);
                            }
                        });
                    });
                }
                // We keep it open a bit to let the above finish before closing? 
                // Better close in callback if we can.
            });
        }
    });
}

scan(root);
