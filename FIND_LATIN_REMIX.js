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
        db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
            if (err || !tables) { db.close(); return; }

            const hasChannels = tables.some(t => t.name === 'youtube_channels');
            if (hasChannels) {
                db.all("SELECT channel_name FROM youtube_channels", (err, rows) => {
                    if (!err && rows) {
                        console.log(`DB: ${dbPath}`);
                        rows.forEach(r => console.log(`  Channel: ${r.channel_name}`));
                    }
                    db.close();
                });
            } else {
                db.close();
            }
        });
    });
});
