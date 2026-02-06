
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const allDbPaths = [
    'j:/neostream/data/neostream.db',
    'j:/neostream/data/streamflow.db',
    'j:/neostream/db/database.db',
    'j:/neostream/db/streamflow.db',
    'j:/neostream/data/sqlite.db',
    'j:/neostream/data/database.db',
    'j:/neostreampro/data/streamflow.db',
    'j:/neostreampro/data/neostream.db',
    'j:/neostreampro/db/database.db'
];

async function searchTitle() {
    console.log("Searching for specific stream title...");
    const targetTitle = "LIVE: BACHATA REQUEST SHOW 2026";

    for (const dbPath of allDbPaths) {
        if (!fs.existsSync(dbPath)) continue;

        const db = new sqlite3.Database(dbPath);

        await new Promise((resolve) => {
            db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='streams'", (err, tables) => {
                if (err || !tables || tables.length === 0) {
                    db.close();
                    return resolve();
                }

                db.all("SELECT s.*, yc.channel_name FROM streams s LEFT JOIN youtube_channels yc ON s.youtube_channel_id = yc.id WHERE s.title LIKE ?", [`%${targetTitle}%`], (err, rows) => {
                    if (rows && rows.length > 0) {
                        console.log(`\n!!! FOUND MATCH IN DB: ${dbPath} !!!`);
                        console.log(JSON.stringify(rows, null, 2));
                    }
                    db.close();
                    resolve();
                });
            });
        });
    }
}

searchTitle();
