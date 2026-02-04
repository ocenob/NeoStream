const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbs = [
    'j:/bwstream-bluk-jadwal/db/sessions.db',
    'j:/bwstream-bluk-jadwal/db/streamflow.db',
    'j:/neostream/data/database.db',
    'j:/neostream/data/neostream.db',
    'j:/neostream/data/sqlite.db',
    'j:/neostream/data/streamflow.db',
    'j:/neostream/db/database.db',
    'j:/neostream/db/sessions.db',
    'j:/neostream/db/streamflow.db',
    'j:/neostreampro/data/neostream.db',
    'j:/neostreampro/data/streamflow.db',
    'j:/neostreampro/db/database.db',
    'j:/neostreampro/db/sessions.db'
];

dbs.forEach(dbPath => {
    if (!fs.existsSync(dbPath)) return;
    const db = new sqlite3.Database(dbPath);

    db.serialize(() => {
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='youtube_channels'", (err, table) => {
            if (err || !table) { db.close(); return; }
            db.all("SELECT id, channel_name FROM youtube_channels", (err, rows) => {
                if (!err && rows) {
                    console.log(`--- DB: ${dbPath} ---`);
                    rows.forEach(r => console.log(`  ${r.id}: ${r.channel_name}`));
                }
                db.close();
            });
        });
    });
});
