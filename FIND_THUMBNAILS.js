const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbs = [
    'j:/neostream/data/neostream.db',
    'j:/neostream/data/streamflow.db',
    'j:/neostream/data/database.db',
    'j:/neostream/db/database.db',
    'j:/neostreampro/data/neostream.db',
    'j:/neostreampro/data/streamflow.db'
];

dbs.forEach(dbPath => {
    if (!fs.existsSync(dbPath)) return;
    const db = new sqlite3.Database(dbPath);

    db.serialize(() => {
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='thumbnails'", (err, table) => {
            if (err || !table) {
                db.close();
                return;
            }

            db.all("SELECT id, title, youtube_channel_id FROM thumbnails", (err, rows) => {
                if (err) {
                    console.error(`Error in ${dbPath}:`, err.message);
                } else if (rows.length > 0) {
                    console.log(`--- ${dbPath} (${rows.length} rows) ---`);
                    rows.slice(0, 5).forEach(r => console.log(`  ID: ${r.id}, Channel: ${r.youtube_channel_id}, Title: ${r.title}`));
                }
                db.close();
            });
        });
    });
});
