const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbs = [
    'j:/neostream/data/neostream.db',
    'j:/neostream/data/streamflow.db',
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

            db.all("SELECT id, title, filepath FROM thumbnails", (err, rows) => {
                if (err) {
                    db.close();
                    return;
                }
                console.log(`DB: ${dbPath} has ${rows.length} thumbnails`);
                rows.forEach(r => {
                    if (r.title && r.title.includes('ROMANTIC')) {
                        console.log(`  MATCH: ${r.title} (Path: ${r.filepath})`);
                    }
                });
                db.close();
            });
        });
    });
});
