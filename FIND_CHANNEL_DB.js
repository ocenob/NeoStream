const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbs = [
    'j:/neostream/data/neostream.db',
    'j:/neostream/data/streamflow.db',
    'j:/neostream/data/database.db',
    'j:/neostream/db/database.db',
    'j:/neostreampro/data/neostream.db',
    'j:/neostreampro/data/streamflow.db',
    'j:/neostreampro/data/streamflow_pro.db'
];

dbs.forEach(dbPath => {
    if (!fs.existsSync(dbPath)) return;
    const db = new sqlite3.Database(dbPath);

    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='youtube_channels'", (err, table) => {
        if (err || !table) {
            db.close();
            return;
        }

        db.all("SELECT channel_name FROM youtube_channels WHERE channel_name LIKE '%LATIN REMIX%'", (err, rows) => {
            if (!err && rows && rows.length > 0) {
                console.log(`FOUND IN ${dbPath}: ${rows.map(r => r.channel_name).join(', ')}`);
            }
            db.close();
        });
    });
});
