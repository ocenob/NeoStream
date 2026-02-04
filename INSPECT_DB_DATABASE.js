const sqlite3 = require('sqlite3').verbose();
const dbPath = 'j:/neostream/db/database.db';
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log("Tables:", tables.map(t => t.name).join(", "));

        db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='thumbnails'", (err, rows) => {
            if (!err && rows.length > 0) {
                db.all("SELECT * FROM thumbnails LIMIT 5", (err, data) => {
                    console.log("Thumbnail entries in database.db:", JSON.stringify(data, null, 2));
                    db.close();
                });
            } else {
                console.log("No thumbnails table in database.db");
                db.close();
            }
        });
    });
});
