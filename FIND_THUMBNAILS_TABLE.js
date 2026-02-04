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
            db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='thumbnails'", (err, rows) => {
                if (!err && rows && rows.length > 0) {
                    console.log(`[TABLE FOUND] Path: ${full}`);
                    db.all("SELECT * FROM thumbnails LIMIT 1", (err, dataRows) => {
                        if (!err && dataRows && dataRows.length > 0) {
                            console.log(`[DATA PREVIEW] Path: ${full}, Data: ${JSON.stringify(dataRows[0])}`);
                        }
                        db.close();
                    });
                } else {
                    db.close();
                }
            });
        }
    });
}

scan(root);
