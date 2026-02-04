const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbs = [
    'j:/neostream/data/neostream.db',
    'j:/neostream/data/streamflow.db',
    'j:/neostream/data/database.db',
    'j:/neostream/db/database.db',
    'j:/neostream/db/streamflow.db',
    'j:/neostream/db/sessions.db',
    'j:/neostreampro/data/neostream.db',
    'j:/neostreampro/data/streamflow.db',
    'j:/neostreampro/db/database.db',
    'j:/neostreampro/db/sessions.db'
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

            db.get("SELECT COUNT(*) as count FROM thumbnails", (err, row) => {
                if (!err && row.count > 0) {
                    console.log(`FOUND ${row.count} thumbnails in ${dbPath}`);
                }
                db.close();
            });
        });
    });
});
